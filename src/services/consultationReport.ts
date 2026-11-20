import { supabase, supabaseConfigured } from '@/lib/supabase';
import { translate } from '@/i18n/core';
import { calculateAge } from './providerApi';

/* ------------------------------------------------------------------------------------------------
 * Rapport de consultation du prestataire (palier 1) : texte libre dans `consultations.notes`,
 * `diagnosis` et `prescription` (même contrat que le web, `saveConsultationNotes`). Aucune ordonnance
 * structurée (table `prescriptions`) : ce service n'y touche pas. La saisie a posteriori n'a pas de limite
 * de temps côté serveur (RLS UPDATE : `doctor_id = auth.uid()`, sans condition de statut).
 * Les contenus (données de santé) ne sont jamais journalisés.
 * ---------------------------------------------------------------------------------------------- */

export type ReportErrorKind = 'conflict' | 'not_found' | 'never_started' | 'no_show_too_early' | 'patient_joined' | 'unavailable';

/** Erreur dont le message est déjà traduit et affichable tel quel. */
export class ConsultationReportError extends Error {
  kind: ReportErrorKind;
  constructor(kind: ReportErrorKind, message: string) {
    super(message);
    this.name = 'ConsultationReportError';
    this.kind = kind;
  }
}

const err = {
  conflict: () =>
    new ConsultationReportError('conflict', translate("Ce rapport a été modifié ailleurs, recharge avant d'enregistrer")),
  notFound: () => new ConsultationReportError('not_found', translate('Consultation introuvable ou accès refusé.')),
  neverStarted: () =>
    new ConsultationReportError(
      'never_started',
      translate("Impossible de terminer : l'appel de cette consultation n'a jamais été lancé."),
    ),
  noShowTooEarly: () =>
    new ConsultationReportError(
      'no_show_too_early',
      translate(
        "Tu pourras déclarer le patient absent 15 minutes après le lancement de l'appel, et pas avant l'heure du rendez-vous.",
      ),
    ),
  patientJoined: () =>
    new ConsultationReportError(
      'patient_joined',
      translate('Le patient a rejoint la consultation : tu ne peux pas le déclarer absent.'),
    ),
  unavailable: () =>
    new ConsultationReportError(
      'unavailable',
      translate('Opération impossible pour le moment. Vérifie ta connexion et réessaie.'),
    ),
};

export type ReportFields = { notes: string; diagnosis: string; prescription: string };

export type ReportPerson = { firstName: string; lastName: string; age: number | null };

export type ConsultationReport = ReportFields & {
  id: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Valeur de `consultations.updated_at` à l'ouverture : sert à détecter une modification ailleurs. */
  updatedAt: string | null;
  patient: ReportPerson;
  /** Consultation pour un enfant : `child` renseigné si lisible, sinon seulement `isChild`. */
  isChild: boolean;
  child: ReportPerson | null;
};

const REPORT_BASE = 'id, status, started_at, ended_at, updated_at, notes, diagnosis, prescription, child_id';
const PATIENT_EMBED = 'patient:users!consultations_patient_id_fkey ( first_name, last_name, date_of_birth )';
const CHILD_EMBED = 'child:patient_children!child_id ( first_name, last_name, date_of_birth )';

const asOne = (v: any) => (Array.isArray(v) ? v[0] : v) ?? null;

const person = (p: any): ReportPerson => ({
  firstName: p?.first_name ?? '',
  lastName: p?.last_name ?? '',
  age: calculateAge(p?.date_of_birth),
});

export function mapReportRow(row: any): ConsultationReport {
  const child = asOne(row.child);
  return {
    id: row.id,
    status: row.status ?? '',
    startedAt: row.started_at ?? null,
    endedAt: row.ended_at ?? null,
    updatedAt: row.updated_at ?? null,
    notes: row.notes ?? '',
    diagnosis: row.diagnosis ?? '',
    prescription: row.prescription ?? '',
    patient: person(asOne(row.patient)),
    isChild: Boolean(row.child_id || child),
    child: child ? person(child) : null,
  };
}

/** Lecture du rapport d'une consultation du prestataire connecté. Lève `not_found` si absente / non autorisée. */
export async function getConsultationReport(consultationId: string, doctorId: string): Promise<ConsultationReport> {
  if (!supabaseConfigured || !supabase) throw err.unavailable();
  const run = (select: string) =>
    supabase!.from('consultations').select(select).eq('id', consultationId).eq('doctor_id', doctorId).maybeSingle();
  let res = await run(`${REPORT_BASE}, ${PATIENT_EMBED}, ${CHILD_EMBED}`);
  // Données de l'enfant illisibles (relation ou droit) : on relit sans elles, sans rien inventer.
  if (res.error) res = await run(`${REPORT_BASE}, ${PATIENT_EMBED}`);
  if (res.error) throw err.unavailable();
  if (!res.data) throw err.notFound();
  return mapReportRow(res.data);
}

const orNull = (s: string) => (s.trim() ? s : null);

/**
 * Enregistre les trois champs. Relit d'abord la valeur serveur : si `updated_at` a changé depuis l'ouverture
 * (`loadedUpdatedAt`), lève `conflict` au lieu d'écraser ; l'UPDATE est de plus conditionné à cet `updated_at`
 * (une modification entre la relecture et l'écriture donne 0 ligne, donc `conflict`). Retourne le nouvel `updated_at`.
 */
export async function saveConsultationReport(
  consultationId: string,
  doctorId: string,
  fields: ReportFields,
  loadedUpdatedAt: string | null,
): Promise<{ updatedAt: string | null }> {
  if (!supabaseConfigured || !supabase) throw err.unavailable();
  const current = await supabase
    .from('consultations')
    .select('id, updated_at')
    .eq('id', consultationId)
    .eq('doctor_id', doctorId)
    .maybeSingle();
  if (current.error) throw err.unavailable();
  if (!current.data) throw err.notFound();
  if (loadedUpdatedAt && (current.data as any).updated_at !== loadedUpdatedAt) throw err.conflict();

  let q = supabase
    .from('consultations')
    .update({
      notes: orNull(fields.notes),
      diagnosis: orNull(fields.diagnosis),
      prescription: orNull(fields.prescription),
    })
    .eq('id', consultationId)
    .eq('doctor_id', doctorId);
  if (loadedUpdatedAt) q = q.eq('updated_at', loadedUpdatedAt);
  const { data, error } = await q.select('id, updated_at');
  if (error) throw err.unavailable();
  if (!data || data.length === 0) throw loadedUpdatedAt ? err.conflict() : err.notFound();
  return { updatedAt: (data[0] as any).updated_at ?? null };
}

function mapEndError(e: { code?: string } | null): ConsultationReportError {
  if (e?.code === '42501') return err.neverStarted();
  return err.unavailable();
}

/**
 * Fin de consultation, comme le web : `ended_at = now()` (si nul) puis `status = 'completed'`.
 * Le serveur refuse `completed` pour une consultation jamais démarrée (42501, migration 20261116410000) :
 * message clair `never_started`. Retourne le nouvel `updated_at` (le trigger le modifie : l'écran doit l'adopter).
 */
export async function endConsultation(consultationId: string, doctorId: string): Promise<{ updatedAt: string | null }> {
  if (!supabaseConfigured || !supabase) throw err.unavailable();
  const first = await supabase
    .from('consultations')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', consultationId)
    .eq('doctor_id', doctorId)
    .is('ended_at', null)
    .select('id');
  if (first.error) throw mapEndError(first.error);

  const { data, error } = await supabase
    .from('consultations')
    .update({ status: 'completed' })
    .eq('id', consultationId)
    .eq('doctor_id', doctorId)
    .select('id, updated_at');
  if (error) throw mapEndError(error);
  if (!data || data.length === 0) throw err.notFound();
  return { updatedAt: (data[0] as any).updated_at ?? null };
}

/**
 * Le serveur n'enregistre pas la présence du patient : c'est le prestataire qui déclare l'absence (comme le web,
 * `status = 'no_show'`). Refusé par la base avant 15 min d'attente depuis le lancement de l'appel ou avant l'heure.
 */
export async function markPatientAbsent(consultationId: string, doctorId: string): Promise<void> {
  if (!supabaseConfigured || !supabase) throw err.unavailable();
  const { data, error } = await supabase
    .from('consultations')
    .update({ status: 'no_show' })
    .eq('id', consultationId)
    .eq('doctor_id', doctorId)
    .select('id');
  if (error) {
    if (typeof error.message === 'string' && error.message.toLowerCase().includes('le patient a rejoint')) throw err.patientJoined();
    if (typeof error.message === 'string' && error.message.includes('no_show impossible avant')) throw err.noShowTooEarly();
    throw err.unavailable();
  }
  if (!data || data.length === 0) throw err.notFound();
}

/**
 * Prévient le patient (notification in-app + WhatsApp) que le prestataire a démarré l'appel
 * (Edge Function `notify-consultation-started`, corps `{ consultationId }`). Best effort : ne lève jamais.
 */
export async function notifyConsultationStarted(consultationId: string): Promise<void> {
  if (!supabaseConfigured || !supabase) return;
  try {
    await supabase.functions.invoke('notify-consultation-started', { body: { consultationId } });
  } catch {
    /* ne bloque jamais l'appel */
  }
}

/* ---------- Trace des appels vidéo (table video_sessions, RLS : initiated_by = auth.uid()) ---------- */

/**
 * Consultation du prestataire connecté pour la salle `room` (id de consultation ou `video_room_id`).
 * `null` si l'utilisateur n'en est pas le prestataire (patient, salle inconnue, erreur) : l'écran d'appel
 * n'agit alors pas côté prestataire. Ne lève jamais.
 */
export async function getProviderCallContext(
  room: string,
  doctorId: string,
): Promise<{ consultationId: string; scheduledAt: string | null; startedAt: string | null } | null> {
  if (!supabaseConfigured || !supabase || !room || !doctorId || !/^[A-Za-z0-9_-]+$/.test(room)) return null;
  try {
    const { data, error } = await supabase
      .from('consultations')
      .select('id, scheduled_at, started_at')
      .or(`id.eq.${room},video_room_id.eq.${room}`)
      .eq('doctor_id', doctorId)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const d = data as any;
    return { consultationId: d.id, scheduledAt: d.scheduled_at ?? null, startedAt: d.started_at ?? null };
  } catch {
    return null;
  }
}

/**
 * Instant où le patient a rejoint la consultation (`consultations.patient_joined_at`), lecture séparée et best effort :
 * null si absent, et sur toute erreur (colonne pas encore migrée comprise), pour ne pas casser la requête principale.
 */
export async function getPatientJoinedAt(consultationId: string): Promise<string | null> {
  if (!supabaseConfigured || !supabase || !consultationId) return null;
  try {
    const { data, error } = await supabase
      .from('consultations')
      .select('patient_joined_at')
      .eq('id', consultationId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as any).patient_joined_at ?? null;
  } catch {
    return null;
  }
}

/** Début d'appel (comme le web `logVideoSessionStart`). Retourne l'id de trace, ou null. Ne lève jamais. */
export async function logVideoSessionStart(entry: {
  consultationId: string;
  roomName: string;
  initiatedBy: string;
}): Promise<string | null> {
  if (!supabaseConfigured || !supabase) return null;
  try {
    const { data } = await supabase
      .from('video_sessions')
      .insert({
        consultation_id: entry.consultationId,
        video_provider: 'jitsi',
        video_mode: 'mobile_webview',
        room_name: entry.roomName,
        country_code: null,
        initiated_by: entry.initiatedBy,
      })
      .select('id')
      .single();
    return (data as any)?.id ?? null;
  } catch {
    return null;
  }
}

/** Fin d'appel (comme le web `logVideoSessionEnd`). Ne lève jamais. */
export async function logVideoSessionEnd(sessionId: string, durationSeconds: number): Promise<void> {
  if (!supabaseConfigured || !supabase) return;
  try {
    await supabase
      .from('video_sessions')
      .update({ ended_at: new Date().toISOString(), duration_seconds: Math.max(0, Math.round(durationSeconds)) })
      .eq('id', sessionId);
  } catch {
    /* trace best effort */
  }
}

/* ------------------------------------------------------------------------------------------------
 * Fin de consultation vue du patient : pendant l'appel, l'écran relit le statut de la consultation.
 * ---------------------------------------------------------------------------------------------- */

/** Statuts qui signifient que la consultation est finie pour le patient (le prestataire a terminé, ou elle est annulée). */
const CALL_ENDED_STATUSES = ['completed', 'cancelled', 'no_show'];

export function isConsultationEnded(status: string | null | undefined): boolean {
  return !!status && CALL_ENDED_STATUSES.includes(status);
}

/**
 * Statut brut (`consultations.status`) de la consultation d'une salle (`id` ou `video_room_id`).
 * Retourne null si indisponible : une erreur réseau ne doit jamais fermer l'appel, l'appelant réessaie.
 */
export async function getConsultationStatusByRoom(room: string): Promise<string | null> {
  if (!supabaseConfigured || !supabase || !room || !/^[A-Za-z0-9_-]+$/.test(room)) return null;
  try {
    const { data, error } = await supabase
      .from('consultations')
      .select('status')
      .or(`id.eq.${room},video_room_id.eq.${room}`)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const status = (data as { status?: unknown }).status;
    return typeof status === 'string' ? status : null;
  } catch {
    return null;
  }
}
