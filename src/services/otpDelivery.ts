import { supabase } from '@/lib/supabase';
import { translate } from '@/i18n/core';

export type OtpChannel = 'whatsapp' | 'sms';

export interface OtpDeliveryInfo {
  channel: OtpChannel;
  /** Durée de validité du code en minutes (au moins 1). */
  validityMinutes: number;
}

/**
 * Canal et durée de validité du code de connexion (MOB-1211-1, §3).
 * RPC publique `get_public_otp_delivery_info()` : appelable sans être connecté, renvoie
 * `{ channel: 'labelflow_whatsapp' | 'twilio_sms', expiry_seconds }`. On ne lit jamais `app_config`
 * (illisible hors connexion). En cas d'échec ou de réponse inexploitable : `null`, et l'écran
 * affiche un libellé neutre (aucun canal annoncé).
 */
export async function fetchOtpDeliveryInfo(): Promise<OtpDeliveryInfo | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('get_public_otp_delivery_info');
    if (error) return null;
    return parseOtpDeliveryInfo(Array.isArray(data) ? data[0] : data);
  } catch {
    return null;
  }
}

export function parseOtpDeliveryInfo(row: any): OtpDeliveryInfo | null {
  if (!row || typeof row.channel !== 'string') return null;
  const raw = row.channel.trim().toLowerCase();
  let channel: OtpChannel;
  if (raw === 'twilio_sms' || raw.includes('sms')) channel = 'sms';
  else if (raw === 'labelflow_whatsapp' || raw.includes('whatsapp')) channel = 'whatsapp';
  else return null;
  const seconds = Number(row.expiry_seconds);
  const validityMinutes = Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 5;
  return { channel, validityMinutes };
}

const channelName = (c: OtpChannel) => (c === 'whatsapp' ? 'WhatsApp' : 'SMS');

/** Libellé du bouton d'envoi ; neutre si le canal est inconnu. */
export function sendCodeLabel(info: OtpDeliveryInfo | null): string {
  if (!info) return translate('Recevoir le code');
  return info.channel === 'whatsapp'
    ? translate('Envoyer le code par WhatsApp')
    : translate('Envoyer le code par SMS');
}

/** Texte d'information sous le titre, avec la durée de validité ; neutre si le canal est inconnu. */
export function otpIntroText(info: OtpDeliveryInfo | null): string {
  if (!info) return translate('On vous envoie un code de confirmation.');
  return info.validityMinutes === 1
    ? translate('Vous allez recevoir le code par {channel} ; il est valable 1 minute.', { channel: channelName(info.channel) })
    : translate('Vous allez recevoir le code par {channel} ; il est valable {minutes} minutes.', {
        channel: channelName(info.channel),
        minutes: info.validityMinutes,
      });
}

/** Texte de l'étape « Entrez le code » ; neutre si le canal est inconnu. */
export function otpSentText(info: OtpDeliveryInfo | null): string {
  if (!info) return translate('Votre code de confirmation vous a été envoyé');
  return translate('Votre code de confirmation vous a été envoyé par {channel}', { channel: channelName(info.channel) });
}
