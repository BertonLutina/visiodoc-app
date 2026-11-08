import type { DashboardAlert, DashboardOverview } from '@/types/provider';
import { translate } from '@/i18n/core';

/** Ligne `consultations` telle que lue par le dashboard (colonnes réellement présentes en prod). */
export interface DashboardRow {
  id: string;
  patient_id: string;
  scheduled_at: string;
  duration: number | null;
  status: string;
  payment_status: string | null;
  payment_amount: number | null;
}

export interface DashboardInput {
  now: Date;
  /** Taux de commission plateforme (0.04 = 4 %). */
  feeRate: number;
  /** Nombre de créneaux réservables par semaine (0 = aucune disponibilité configurée). */
  weeklyCapacity: number;
}

// `pending_payment` (réservée, non payée) n'est PAS active : ni « prochaine consultation », ni rendez-vous à venir.
const ACTIVE = new Set(['pending', 'scheduled', 'confirmed', 'in_progress']);
const BOOKED = new Set(['scheduled', 'confirmed', 'in_progress', 'completed', 'pending']);
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Créneaux hebdomadaires réservables, d'après les plages de disponibilité et la durée de rendez-vous. */
export function weeklyCapacity(
  rules: { startTime: string; endTime: string }[],
  slotMinutes: number,
): number {
  if (slotMinutes <= 0) return 0;
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  return rules.reduce((sum, r) => {
    const span = toMin(r.endTime) - toMin(r.startTime);
    return span > 0 ? sum + Math.floor(span / slotMinutes) : sum;
  }, 0);
}

export function computeDashboardOverview(
  rows: DashboardRow[],
  { now, feeRate, weeklyCapacity: capacity }: DashboardInput,
): Omit<DashboardOverview, 'next'> & { nextRowId: string | null } {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const at = (r: DashboardRow) => new Date(r.scheduled_at);

  const nonCancelled = rows.filter((r) => r.status !== 'cancelled');

  // Patients : distincts, hors consultations annulées.
  const firstSeen = new Map<string, Date>();
  for (const r of nonCancelled) {
    const t = at(r);
    const prev = firstSeen.get(r.patient_id);
    if (!prev || t < prev) firstSeen.set(r.patient_id, t);
  }
  const patientsNew = [...firstSeen.values()].filter((d) => d >= monthStart && d < nextMonthStart).length;

  // Consultations du mois et tendance.
  const inRange = (r: DashboardRow, from: Date, to: Date) => at(r) >= from && at(r) < to;
  const monthCount = nonCancelled.filter((r) => inRange(r, monthStart, nextMonthStart)).length;
  const prevCount = nonCancelled.filter((r) => inRange(r, prevMonthStart, monthStart)).length;
  let consultationsTrend = '';
  if (prevCount > 0) {
    const pct = Math.round(((monthCount - prevCount) / prevCount) * 100);
    consultationsTrend = translate('{pct} vs mois préc.', { pct: `${pct >= 0 ? '+' : ''}${pct}%` });
  }

  // Revenu net : consultations terminées et payées, commission déduite. 6 derniers mois.
  const net = (r: DashboardRow) =>
    r.status === 'completed' && r.payment_status === 'paid' ? (r.payment_amount ?? 0) * (1 - feeRate) : 0;
  const revenueSeries = Array.from({ length: 6 }, (_, i) => {
    const from = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    const amount = rows.filter((r) => inRange(r, from, to)).reduce((s, r) => s + net(r), 0);
    return { label: MONTHS[from.getMonth()], amount: Math.round(amount) };
  });
  const netRevenue = revenueSeries[5].amount;

  // Qualité : 90 derniers jours, rendez-vous déjà passés.
  const since = new Date(now.getTime() - 90 * DAY_MS);
  const recentPast = rows.filter((r) => at(r) >= since && at(r) <= now);
  const rate = (status: string) =>
    recentPast.length ? Math.round((recentPast.filter((r) => r.status === status).length / recentPast.length) * 100) : null;

  // Semaine : aujourd'hui + 6 jours.
  const today = startOfDay(now);
  const weekAgenda = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const key = dayKey(d);
    const count = rows.filter((r) => BOOKED.has(r.status) && dayKey(at(r)) === key).length;
    return { date: key, label: DAYS[d.getDay()], dayNumber: d.getDate(), count, isToday: i === 0 };
  });
  const weekBooked = weekAgenda.reduce((s, d) => s + d.count, 0);
  const fillRate = capacity > 0 ? Math.min(100, Math.round((weekBooked / capacity) * 100)) : null;

  // Patients à relancer : dernière consultation terminée il y a > 90 jours, rien de prévu.
  const lastDone = new Map<string, Date>();
  const hasUpcoming = new Set<string>();
  for (const r of rows) {
    if (r.status === 'completed') {
      const prev = lastDone.get(r.patient_id);
      if (!prev || at(r) > prev) lastDone.set(r.patient_id, at(r));
    }
    if (ACTIVE.has(r.status) && at(r) >= now) hasUpcoming.add(r.patient_id);
  }
  const patientsToRecall = [...lastDone.entries()].filter(
    ([pid, d]) => d < since && !hasUpcoming.has(pid),
  ).length;

  const pendingPayment = rows.filter((r) => r.status === 'pending_payment' && at(r) >= now).length;

  // Prochaine consultation : première non terminée dont la fin n'est pas passée.
  const next = rows
    .filter((r) => ACTIVE.has(r.status) && at(r).getTime() + (r.duration ?? 30) * 60_000 >= now.getTime())
    .sort((a, b) => at(a).getTime() - at(b).getTime())[0];

  return {
    patientsTotal: firstSeen.size,
    patientsNew,
    consultationsThisMonth: monthCount,
    consultationsTrend,
    netRevenue,
    revenueSeries,
    cancellationRate: rate('cancelled'),
    noShowRate: rate('no_show'),
    weekAgenda,
    weekBooked,
    weekCapacity: capacity,
    fillRate,
    patientsToRecall,
    pendingPayment,
    nextRowId: next?.id ?? null,
  };
}

/** Libellé de compte à rebours : « dans 12 min », « dans 2 h 05 », « en cours », « dans 3 j ». */
export function countdownLabel(startsAt: Date, now: Date): string {
  const min = Math.round((startsAt.getTime() - now.getTime()) / 60_000);
  if (min <= 0) return translate('En cours ou imminente');
  if (min < 60) return translate('dans {min} min', { min });
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return translate('dans {time}', { time: `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''}` });
  }
  return translate('dans {n} j', { n: Math.floor(min / (24 * 60)) });
}

export interface AlertContext {
  validationStatus: string | null;
  overview: Pick<DashboardOverview, 'weekCapacity' | 'pendingPayment' | 'patientsToRecall'>;
}

/** Alertes à traiter, ordonnées par urgence. Chaque alerte pointe vers l'écran qui la résout. */
export function buildAlerts({ validationStatus, overview }: AlertContext): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  if (validationStatus && validationStatus !== 'VALIDATED') {
    const label: Record<string, string> = {
      PENDING_VALIDATION: translate('Votre compte est en cours de validation.'),
      REQUIRES_CHANGES: translate('Votre dossier nécessite des modifications.'),
      REJECTED: translate('Votre dossier a été refusé.'),
      SUSPENDED: translate('Votre compte est suspendu.'),
    };
    alerts.push({
      id: 'validation',
      tone: validationStatus === 'PENDING_VALIDATION' ? 'info' : 'danger',
      message: label[validationStatus] ?? translate('Votre compte n’est pas encore validé.'),
      href: '/(provider)/profile',
    });
  }
  if (overview.weekCapacity === 0) {
    alerts.push({
      id: 'availability',
      tone: 'warning',
      message: translate('Aucune disponibilité configurée : les patients ne peuvent pas réserver.'),
      href: '/provider/availability',
    });
  }
  if (overview.pendingPayment > 0) {
    alerts.push({
      id: 'pending-payment',
      tone: 'info',
      message:
        overview.pendingPayment > 1
          ? translate('{n} consultations en attente de paiement.', { n: overview.pendingPayment })
          : translate('1 consultation en attente de paiement.'),
      href: '/(provider)/consultations',
    });
  }
  if (overview.patientsToRecall > 0) {
    alerts.push({
      id: 'recall',
      tone: 'info',
      message:
        overview.patientsToRecall > 1
          ? translate('{n} patients à relancer (pas revus depuis 3 mois).', { n: overview.patientsToRecall })
          : translate('1 patient à relancer (pas revu depuis 3 mois).'),
      href: '/(provider)/patients',
    });
  }
  return alerts;
}
