import { MAX_SPECIALIZATIONS } from '@/config/specializations';

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Accepte un text[] ou une chaîne (« A · B », « A, B », « A; B »). */
export function parseSpecializations(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.map(String)
    : String(raw ?? '').split(/\s*[·;,|]\s*/);
  return dedupeSpecializations(parts);
}

export function dedupeSpecializations(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const v = item.trim();
    const k = norm(v);
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.slice(0, MAX_SPECIALIZATIONS);
}

export const joinSpecializations = (list: string[]) => list.join(' · ');
