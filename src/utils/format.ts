import type { ConsultationStatus, ConsultationType } from '@/types';
import { activeCountry, type CountryConfig } from '@/config/countries';
import { appLocale, translate } from '@/i18n/core';

/** Montant dans la devise locale, ex: "25 000 FC". */
export function formatMoney(amount: number, country: CountryConfig = activeCountry): string {
  const { symbol, position } = country.currency;
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount).toLocaleString(appLocale());
  return position === 'prefix' ? `${sign}${symbol}${abs}` : `${sign}${abs} ${symbol}`;
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

export function typeLabel(type: ConsultationType): string {
  switch (type) {
    case 'video':
      return translate('Vidéo');
    case 'chat':
      return translate('Chat');
    case 'phone':
      return translate('Téléphone');
  }
}

export function typeIcon(type: ConsultationType): 'video' | 'message-circle' | 'phone' {
  switch (type) {
    case 'video':
      return 'video';
    case 'chat':
      return 'message-circle';
    case 'phone':
      return 'phone';
  }
}
