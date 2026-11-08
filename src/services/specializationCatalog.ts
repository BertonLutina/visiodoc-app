import { supabase, supabaseConfigured } from '@/lib/supabase';
import { SPECIALIZATIONS } from '@/config/specializations';

/** Normalisation commune (sans accents, minuscules) pour comparer les libellés. */
export const specKey = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const useMock = () => !supabaseConfigured || !supabase;

export type SpecializationStatus = 'pending' | 'approved' | 'rejected';
export type SpecializationRow = { id: string; label: string; status: SpecializationStatus };

/** Catalogue = table `service_types` : `is_active = true` ⇒ officiel, `false` ⇒ en attente. */
const TABLE = 'service_types';

/** `code` stable dérivé du libellé (ex. « Médecine du sport » → MEDECINE_DU_SPORT). */
export const specCode = (s: string) =>
  specKey(s).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();

/**
 * Liste officielle (`service_types` actifs). Retombe sur la liste embarquée si la table est
 * illisible ou en mode hors-ligne/mock ; la liste embarquée est toujours fusionnée.
 */
export async function getApprovedSpecializations(): Promise<string[]> {
  if (useMock()) return SPECIALIZATIONS;
  const { data, error } = await supabase!
    .from(TABLE)
    .select('label')
    .eq('is_active', true)
    .order('label');
  if (error || !data?.length) return SPECIALIZATIONS;
  return mergeCatalog(SPECIALIZATIONS, data.map((r: any) => r.label as string));
}

/**
 * Spécialités officielles avec leur `id` (UUID `service_types`) — utile pour `serviceTypeId` à
 * l'inscription. Liste vide si la table est illisible ou en mode mock (jamais d'id inventé).
 */
export async function getServiceTypeCatalog(): Promise<{ id: string; label: string }[]> {
  if (useMock()) return [];
  const { data, error } = await supabase!.from(TABLE).select('id, label').eq('is_active', true);
  if (error || !data) return [];
  return data.map((r: any) => ({ id: String(r.id), label: String(r.label) }));
}

export function mergeCatalog(base: string[], extra: string[]): string[] {
  const seen = new Map<string, string>();
  for (const l of [...base, ...extra]) if (!seen.has(specKey(l))) seen.set(specKey(l), l);
  return Array.from(seen.values()).sort((a, b) => specKey(a).localeCompare(specKey(b), 'fr'));
}

/** Suggestions du prestataire connecté encore en attente de validation. */
export async function getMyPendingSpecializations(userId: string): Promise<string[]> {
  if (useMock() || !userId) return [];
  const { data } = await supabase!
    .from(TABLE)
    .select('label')
    .eq('created_by', userId)
    .eq('is_active', false);
  return (data ?? []).map((r: any) => r.label as string);
}

/**
 * Enregistre en « pending » les libellés absents de la liste officielle. Ils restent visibles
 * du prestataire mais n'entrent dans la liste qu'une fois acceptés par l'administrateur.
 */
export async function suggestSpecializations(
  userId: string,
  labels: string[],
  catalog: string[],
): Promise<string[]> {
  const known = new Set(catalog.map(specKey));
  const unknown = labels.filter((l) => l.trim() && !known.has(specKey(l)));
  if (useMock() || !userId || unknown.length === 0) return unknown;
  const rows = unknown.map((label) => ({
    code: specCode(label),
    label: label.trim(),
    is_active: false,
    created_by: userId,
  }));
  // Doublon (`code` déjà proposé) : on ignore, la validation admin couvre tout le monde.
  await supabase!.from(TABLE).upsert(rows, { onConflict: 'code', ignoreDuplicates: true });
  return unknown;
}

/* ---------- Administrateur ---------- */
export async function listPendingSpecializations(): Promise<SpecializationRow[]> {
  if (useMock()) return [];
  const { data, error } = await supabase!
    .from(TABLE)
    .select('id, label')
    .eq('is_active', false)
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, status: 'pending' as const }));
}

export async function reviewSpecialization(
  id: string,
  status: 'approved' | 'rejected',
  label?: string,
): Promise<void> {
  if (useMock()) return;
  const q = supabase!.from(TABLE);
  const { error } =
    status === 'approved'
      ? await q.update({ is_active: true, ...(label?.trim() ? { label: label.trim() } : {}) }).eq('id', id)
      : await q.delete().eq('id', id);
  if (error) throw error;
}
