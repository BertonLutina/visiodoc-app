import type { ConsultationStatus, ConsultationType } from '@/types';
import { activeCountry, COUNTRIES, type CountryConfig } from '@/config/countries';
import { appLocale, translate } from '@/i18n/core';

/** Montant dans la devise locale, ex: "25 000 FC". */
export function formatMoney(amount: number, country: CountryConfig = activeCountry): string {
  const { symbol, position } = country.currency;
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount).toLocaleString(appLocale());
  return position === 'prefix' ? `${sign}${symbol}${abs}` : `${sign}${abs} ${symbol}`;
}

/**
 * Tarif d'un médecin avec sa devise. La devise vient de `public_provider_listing.currency_code`
 * (pays du médecin) ; on la rattache à un pays connu pour garder le symbole habituel (« FC »),
 * sinon on affiche le code ISO. Renvoie `null` quand le tarif est masqué (jamais « null » / « NaN »).
 */
export function formatDoctorFee(
  fee: number | null | undefined,
  currencyCode: string | null | undefined,
  fallbackCountry: CountryConfig = activeCountry,
): string | null {
  if (fee === null || fee === undefined || !Number.isFinite(fee)) return null;
  if (!currencyCode) return formatMoney(fee, fallbackCountry);
  const known = Object.values(COUNTRIES).find((c) => c.currency.code === currencyCode);
  if (known) return formatMoney(fee, known);
  return `${fee.toLocaleString(appLocale())} ${currencyCode}`;
}

/**
 * Montant d'un revenu avec SA devise. Devise absente : le nombre seul, sans symbole — on ne lui
 * prête jamais la devise du pays actif (ce serait inventer une devise).
 */
export function formatAmountInCurrency(amount: number, currencyCode: string | null | undefined): string {
  if (!currencyCode) return amount.toLocaleString(appLocale());
  return formatDoctorFee(amount, currencyCode) ?? amount.toLocaleString(appLocale());
}

/** Équivalent USD arrondi d'un montant en devise locale, ex: "~$9". */
export function formatUsd(amountLocal: number, country: CountryConfig = activeCountry): string {
  const usd = amountLocal / country.currency.usdRate;
  const sign = usd < 0 ? '-' : '';
  return `${sign}~$${Math.abs(Math.round(usd)).toLocaleString('en-US')}`;
}

/** Devise locale + équivalent USD, ex: "25 000 FC · ~$9". */
export function formatMoneyDual(amount: number, country: CountryConfig = activeCountry): string {
  return `${formatMoney(amount, country)} · ${formatUsd(amount, country)}`;
}

/** La table `consultations` utilise des statuts DB (`pending_payment`, `scheduled`, ...)
 *  distincts du vocabulaire `ConsultationStatus` affiché côté app. */
export function normalizeConsultationStatus(status: string): ConsultationStatus {
  switch (status) {
    case 'pending_payment':
      return 'pending';
    case 'scheduled':
      return 'confirmed';
    case 'in_progress':
    case 'completed':
    case 'cancelled':
      return status;
    default:
      return 'pending';
  }
}

/** `consultations.cancel_reason` posé par le serveur quand le médecin n'a pas lancé l'appel dans les 15 minutes. */
export const PROVIDER_ABSENT_REASON = 'provider_absent';

/** Consultation annulée pour médecin absent ([MOB-1611-1]) : `cancelled` + `cancel_reason = 'provider_absent'`. */
export function isProviderAbsent(status: string | null | undefined, cancelReason: string | null | undefined): boolean {
  return status === 'cancelled' && cancelReason === PROVIDER_ABSENT_REASON;
}

/** Libellé du guide pour une annulation pour médecin absent (le patient retrouve la totalité en avoir). */
export function providerAbsentLabel(): string {
  return translate('Médecin absent : remboursé en avoir');
}

/** Valeurs autorisées par le CHECK `consultations.consultation_type`. */
export type DbConsultationType = 'video' | 'audio' | 'chat';

/** UI → base : le choix « Tél. » (`phone`) est stocké `audio`. */
export function toDbConsultationType(type: ConsultationType): DbConsultationType {
  return type === 'phone' ? 'audio' : type;
}

/** Base → UI : `audio` s'affiche comme « Téléphone » ; absent ou inconnu → `video`. */
export function fromDbConsultationType(value: string | null | undefined): ConsultationType {
  switch (value) {
    case 'audio':
    case 'phone':
      return 'phone';
    case 'chat':
      return 'chat';
    default:
      return 'video';
  }
}

/** Libellé total : accepte aussi une valeur brute de la base (`audio`) ; jamais `undefined`. */
export function typeLabel(type: string | null | undefined): string {
  switch (fromDbConsultationType(type)) {
    case 'chat':
      return translate('Chat');
    case 'phone':
      return translate('Téléphone');
    default:
      return translate('Vidéo');
  }
}

export function typeIcon(type: string | null | undefined): 'video' | 'message-circle' | 'phone' {
  switch (fromDbConsultationType(type)) {
    case 'chat':
      return 'message-circle';
    case 'phone':
      return 'phone';
    default:
      return 'video';
  }
}
