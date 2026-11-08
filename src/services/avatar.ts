import { supabase, supabaseConfigured } from '@/lib/supabase';

const BUCKET = 'avatars';

export type AvatarFile = { uri: string; mimeType: string };

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Extension de fichier pour un type MIME image ; retombe sur jpg (sortie par défaut du picker). */
export function avatarExtension(mimeType: string): string {
  return EXT_BY_MIME[mimeType.toLowerCase()] ?? 'jpg';
}

/** Clé Storage : `{userId}/avatar-{timestamp}.{ext}` — le 1er segment est vérifié par les policies RLS. */
export function avatarPath(userId: string, mimeType: string, now: number = Date.now()): string {
  return `${userId}/avatar-${now}.${avatarExtension(mimeType)}`;
}

/** Retrouve la clé Storage d'une URL publique du bucket, ou null si l'URL n'en vient pas. */
export function avatarPathFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  return path || null;
}

/**
 * Envoie la photo dans le bucket `avatars` et renvoie son URL publique.
 * Sans Supabase (mode démo), renvoie l'URI locale pour que la photo s'affiche quand même.
 */
export async function uploadAvatar(userId: string, file: AvatarFile): Promise<string> {
  if (!supabaseConfigured || !supabase) return file.uri;
  const path = avatarPath(userId, file.mimeType);
  // ArrayBuffer (et non Blob) : sur React Native, `fetch(uri).blob()` a le type `text/plain`
  // et storage-js ignore alors `contentType` — le bucket (jpeg/png/webp seulement) refuserait.
  const response = await fetch(file.uri);
  const body = await response.arrayBuffer();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType: file.mimeType });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Supprime l'ancienne photo (au mieux : un échec n'empêche pas de changer d'avatar). */
export async function removeAvatarFile(url?: string | null): Promise<void> {
  const path = avatarPathFromUrl(url);
  if (!path || !supabaseConfigured || !supabase) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* fichier orphelin sans conséquence */
  }
}
