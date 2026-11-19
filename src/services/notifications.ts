import { supabase } from '@/lib/supabase';

/**
 * Notifications in-app (table `in_app_notifications`, voir la migration web
 * 20260623000004_create_in_app_notifications.sql). Lecture et marquage « lu » sous RLS
 * (recipient_id = auth.uid()). Les notifications sont créées côté backend uniquement.
 */
export type InAppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

const COLUMNS = 'id, type, title, message, data, action_url, read_at, created_at';

export async function listNotifications(userId: string, limit = 50): Promise<InAppNotification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('in_app_notifications')
    .select(COLUMNS)
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as InAppNotification[];
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from('in_app_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationRead(id: string, readAt: string = new Date().toISOString()): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('in_app_notifications').update({ read_at: readAt }).eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(userId: string, readAt: string = new Date().toISOString()): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('in_app_notifications')
    .update({ read_at: readAt })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

/** Flux temps réel des nouvelles notifications (comme le web). Renvoie la fonction d'arrêt. */
export function subscribeToNotifications(userId: string, onInsert: (n: InAppNotification) => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel(`notifications:${userId}:${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'in_app_notifications', filter: `recipient_id=eq.${userId}` },
      (payload: { new: unknown }) => onInsert(payload.new as InAppNotification),
    )
    .subscribe();
  return () => {
    client.removeChannel(channel);
  };
}

/**
 * Écran mobile correspondant au type de notification, ou null s'il n'existe pas.
 * Les `action_url` du web sont des chemins web : on route par `type`, pas par URL.
 * Types émis par le backend : consultation_started, consultation_reminder, prescription_issued,
 * provider_absent, cancellation_credit, subscription_expiry_reminder, avatar_review.
 */
export function notificationRoute(
  type: string,
  role: 'patient' | 'provider',
  actionUrl?: string | null,
): string | null {
  return routeByType(type, role) ?? routeByActionUrl(actionUrl, role);
}

/** Repli : traduit un lien web `/?view=...` quand le type n'est pas connu. */
function routeByActionUrl(url: string | null | undefined, role: 'patient' | 'provider'): string | null {
  const view = /^\/\?view=([a-z-]+)/.exec(url ?? '')?.[1];
  if (role === 'patient') {
    if (view === 'my-consultations') return '/(patient)/appointments';
    if (view === 'my-prescriptions') return '/records';
  }
  return null;
}

function routeByType(type: string, role: 'patient' | 'provider'): string | null {
  if (role === 'patient') {
    switch (type) {
      case 'consultation_started':
      case 'consultation_reminder':
        return '/(patient)/appointments';
      case 'prescription_issued':
        return '/records';
      case 'provider_absent':
      case 'cancellation_credit':
        return '/(patient)/wallet';
      default:
        return null;
    }
  }
  switch (type) {
    case 'consultation_reminder':
    case 'provider_absent':
      return '/(provider)/consultations';
    case 'subscription_expiry_reminder':
      return '/provider/subscription';
    case 'avatar_review':
      return '/(provider)/profile';
    default:
      return null;
  }
}
