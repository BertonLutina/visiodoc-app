import { supabase, supabaseConfigured } from '@/lib/supabase';
import { appLocale, translate } from '@/i18n/core';
import { formatAmountInCurrency } from '@/utils/format';

/** Aperçu serveur ([MOB-1811-7]) : la règle (24 h / rétractation 72 h) est appliquée par la base, jamais ici. */
export interface CancellationCreditPreview {
  eligible: boolean;
  rule: '24h' | 'withdrawal_72h' | 'none';
  /** Unité principale (NUMERIC), pas ×100. */
  amount: number;
  currency: string;
  deadline: string | null;
}

export class CancelConsultationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CancelConsultationError';
  }
}

const available = () => supabaseConfigured && !!supabase;

/**
 * Aperçu du crédit avant de confirmer. Renvoie `null` si indisponible (réseau, RLS, consultation non trouvée) :
 * l'écran affiche alors un message prudent, sans promesse de montant. Ne lève jamais.
 */
export async function getCancellationCreditPreview(consultationId: string): Promise<CancellationCreditPreview | null> {
  if (!available() || !consultationId) return null;
  try {
    const { data, error } = await supabase!.rpc('cancellation_credit_preview', { p_consultation_id: consultationId });
    if (error) {
      console.warn('cancellation_credit_preview failed', (error as { code?: unknown }).code ?? 'unknown');
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    const rule = d.rule === '24h' || d.rule === 'withdrawal_72h' ? d.rule : 'none';
    return {
      eligible: d.eligible === true,
      rule,
      amount: Number(d.amount) || 0,
      currency: typeof d.currency === 'string' ? d.currency : '',
      deadline: typeof d.deadline === 'string' ? d.deadline : null,
    };
  } catch {
    console.warn('cancellation_credit_preview failed', 'exception');
    return null;
  }
}

/**
 * Annule une consultation `scheduled`. La base applique la règle de crédit (déclencheur) ; ici seulement l'update.
 * Zéro ligne mise à jour (déjà annulée, commencée, hors RLS) = erreur traduite, jamais un succès silencieux.
 */
export async function cancelScheduledConsultation(consultationId: string): Promise<void> {
  if (!available() || !consultationId) {
    throw new CancelConsultationError(translate("L'annulation n'est pas disponible pour le moment. Réessaie plus tard."));
  }
  let result;
  try {
    result = await supabase!
      .from('consultations')
      .update({ status: 'cancelled' })
      .eq('id', consultationId)
      .eq('status', 'scheduled')
      .select('id');
  } catch {
    console.warn('cancel consultation failed', 'exception');
    throw new CancelConsultationError(translate("L'annulation a échoué. Réessaie plus tard."));
  }
  if (result.error) {
    console.warn('cancel consultation failed', (result.error as { code?: unknown }).code ?? 'unknown');
    throw new CancelConsultationError(translate("L'annulation a échoué. Réessaie plus tard."));
  }
  if (!result.data || result.data.length === 0) {
    throw new CancelConsultationError(
      translate('Cette consultation ne peut plus être annulée (déjà annulée ou commencée). Actualise la liste.'),
    );
  }
}

/**
 * Texte de confirmation avant l'annulation, composé à partir de l'aperçu serveur (jamais d'une règle locale).
 * Aperçu indisponible : message prudent, sans promesse de montant.
 */
export function buildCancellationMessage(preview: CancellationCreditPreview | null): string {
  if (!preview) return translate("Le crédit éventuel sera calculé par le serveur au moment de l'annulation.");
  const parts: string[] = [];
  if (preview.eligible) {
    parts.push(
      translate(
        'Si vous annulez maintenant, vous serez crédité de {amount} dans votre portefeuille (avoir réutilisable pour une prochaine consultation).',
        { amount: formatAmountInCurrency(preview.amount, preview.currency) },
      ),
    );
    if (preview.rule === 'withdrawal_72h') {
      parts.push(translate('Vous êtes dans le délai de rétractation de 72 heures après votre paiement.'));
    }
    const when = preview.deadline ? new Date(preview.deadline) : null;
    if (when && Number.isFinite(when.getTime())) {
      parts.push(
        translate("Annulation avec crédit possible jusqu'au {deadline}", {
          deadline: when.toLocaleString(appLocale(), {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
        }),
      );
    }
  } else {
    parts.push(
      translate(
        'Moins de 24 heures avant la consultation et hors délai de rétractation : aucun crédit ne sera accordé.',
      ),
    );
  }
  return parts.join(' ');
}
