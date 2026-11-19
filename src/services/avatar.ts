import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { readHttpError } from '@/utils/authError';
import { translate } from '@/i18n/core';

/**
 * Photo de profil (MOB-1611-2). Le client n'écrit JAMAIS `users.avatar_url` ni aucune colonne `avatar_*` :
 * il convertit la photo en JPEG, l'envoie dans le bucket privé `avatars-private` (dossier `incoming/`,
 * sans `upsert`), puis appelle la fonction `finalize-avatar` qui valide, nettoie et enregistre.
 */
export const PRIVATE_BUCKET = 'avatars-private';
export const FINALIZE_FUNCTION = 'finalize-avatar';
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MAX_DIMENSION = 1024;

/** Codes de refus de `finalize-avatar` (HTTP 400 `{ ok:false, code }`, 429 `rate_limited`). */
export type AvatarErrorCode = 'invalid_image' | 'too_large' | 'too_big_dimensions' | 'rate_limited' | 'unknown';

export class AvatarError extends Error {
  code: AvatarErrorCode;
  constructor(code: AvatarErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AvatarError';
    this.code = code;
  }
}

const KNOWN_CODES: AvatarErrorCode[] = ['invalid_image', 'too_large', 'too_big_dimensions', 'rate_limited'];

export function avatarErrorCode(raw: unknown): AvatarErrorCode {
  return typeof raw === 'string' && (KNOWN_CODES as string[]).includes(raw) ? (raw as AvatarErrorCode) : 'unknown';
}

/** Message affiché à l'utilisateur ; jamais le texte brut d'une erreur inconnue. */
export function avatarErrorMessage(error: unknown): string {
  const code = error instanceof AvatarError ? error.code : 'unknown';
  switch (code) {
    case 'invalid_image':
      return translate("Cette image n'est pas valide. Choisissez une photo au format JPEG ou PNG.");
    case 'too_large':
      return translate('Cette photo est trop lourde (2 Mo au maximum).');
    case 'too_big_dimensions':
      return translate('Cette photo est trop grande (1024 x 1024 pixels au maximum).');
    case 'rate_limited':
      return translate('Trop de changements de photo. Réessayez dans une heure.');
    default:
      return translate('Réessayez dans un instant.');
  }
}

/** UUID v4 : `crypto.randomUUID` quand il existe, sinon octets aléatoires mis au format v4. */
export function uuidV4(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Chemin exact exigé par la politique Storage : `<id en minuscules>/incoming/<uuid v4>.jpg`. */
export function incomingAvatarPath(userId: string, uuid: string = uuidV4()): string {
  return `${userId.toLowerCase()}/incoming/${uuid}.jpg`;
}

export type AvatarFile = { uri: string; width?: number; height?: number };

/** Dimensions cibles pour tenir dans 1024 x 1024 sans jamais agrandir ; `null` = déjà conforme. */
export function targetSize(width?: number, height?: number): { width: number; height: number } | null {
  if (!width || !height) return null;
  const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(width, height));
  if (scale >= 1) return null;
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

/** Qualités JPEG essayées tant que le fichier dépasse 2 Mo. */
const QUALITIES = [0.85, 0.7, 0.5, 0.3];

/**
 * Convertit TOUJOURS la photo en JPEG de 1024 x 1024 maximum et 2 Mo maximum (expo-image-manipulator).
 * Renvoie les octets à envoyer ; lève `too_large` si même la plus basse qualité dépasse 2 Mo.
 */
export async function prepareAvatarJpeg(file: AvatarFile): Promise<ArrayBuffer> {
  const size = targetSize(file.width, file.height);
  for (const compress of QUALITIES) {
    const context = ImageManipulator.manipulate(file.uri);
    if (size) context.resize(size);
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
    // ArrayBuffer (et non Blob) : sur React Native, `fetch(uri).blob()` a le type `text/plain`.
    const body = await (await fetch(saved.uri)).arrayBuffer();
    if (body.byteLength <= AVATAR_MAX_BYTES) return body;
  }
  throw new AvatarError('too_large');
}

/** Convertit l'erreur de `functions.invoke` (statut HTTP + `code` du corps) en `AvatarError`. */
async function toAvatarError(error: any): Promise<AvatarError> {
  const { status, body } = await readHttpError(error);
  if (status === 429) return new AvatarError('rate_limited');
  return new AvatarError(avatarErrorCode(body?.code));
}

async function callFinalize(body: Record<string, unknown>): Promise<{ path?: string }> {
  if (!supabase) throw new AvatarError('unknown');
  const { data, error } = await supabase.functions.invoke(FINALIZE_FUNCTION, { body });
  if (error) throw await toAvatarError(error);
  if (data?.ok === false) throw new AvatarError(avatarErrorCode(data.code));
  return { path: typeof data?.path === 'string' ? data.path : undefined };
}

/**
 * Envoie la photo : conversion JPEG, upload sans `upsert` dans `avatars-private/<id>/incoming/<uuid>.jpg`,
 * puis `finalize-avatar { path }`. Renvoie le chemin `validated` retourné par le serveur.
 * Sans Supabase (mode démo) : ne fait rien et renvoie `null`.
 */
export async function uploadAvatar(userId: string, file: AvatarFile): Promise<string | null> {
  if (!supabaseConfigured || !supabase) return null;
  const body = await prepareAvatarJpeg(file);
  const path = incomingAvatarPath(userId);
  const { error } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  const result = await callFinalize({ path });
  return result.path ?? null;
}

/** Supprime la photo : uniquement `finalize-avatar { action: 'remove' }` (aucune RPC `*_my_avatar`, réservées au serveur). */
export async function removeAvatar(): Promise<void> {
  if (!supabaseConfigured || !supabase) return;
  await callFinalize({ action: 'remove' });
}

/** URL signée (1 h) d'une photo privée `<id>/validated/*` ; `null` si elle ne peut pas être créée. */
export async function signedAvatarUrl(path?: string | null, expiresInSeconds = 3600): Promise<string | null> {
  if (!path || !supabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.storage.from(PRIVATE_BUCKET).createSignedUrl(path, expiresInSeconds);
    return error ? null : (data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

export type AvatarReviewStatus = 'pending' | 'approved' | 'rejected';

export const isReviewStatus = (v: unknown): v is AvatarReviewStatus =>
  v === 'pending' || v === 'approved' || v === 'rejected';
