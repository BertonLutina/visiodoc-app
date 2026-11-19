/**
 * Horloge serveur estimée : le serveur fait foi pour la fenêtre de démarrage (guide [MOB-1611-1]). Le guide ne
 * fournit pas d'heure serveur dédiée ; on déduit le décalage de l'horloge de l'appareil de l'en-tête HTTP `Date`
 * des réponses Supabase (précision d'environ 1 s, suffisante pour une fenêtre de 15 minutes). Sans mesure, le
 * décalage vaut 0 (horloge de l'appareil). Dans tous les cas, le serveur re-vérifie (`get-video-token`, 42501).
 */
let offsetMs = 0;

/** Décalage mesuré (serveur moins appareil), en ms. */
export function serverClockOffsetMs(): number {
  return offsetMs;
}

/** Enregistre le décalage à partir d'un en-tête `Date` HTTP ; ignore une valeur absente, invalide ou aberrante. */
export function syncServerClock(dateHeader: string | null | undefined, deviceNowMs: number = Date.now()): boolean {
  if (typeof dateHeader !== 'string' || !dateHeader) return false;
  const serverMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverMs)) return false;
  const delta = serverMs - deviceNowMs;
  // Au-delà de 24 h d'écart, l'en-tête est jugé non fiable (proxy, cache) : on garde la mesure précédente.
  if (Math.abs(delta) > 24 * 60 * 60 * 1000) return false;
  offsetMs = delta;
  return true;
}

/** Instant courant côté serveur (ms), estimé. */
export function serverNowMs(deviceNowMs: number = Date.now()): number {
  return deviceNowMs + offsetMs;
}

/** Remet le décalage à zéro (tests, déconnexion). */
export function resetServerClock(): void {
  offsetMs = 0;
}
