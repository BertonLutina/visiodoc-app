import { fetchOtpDeliveryInfo, otpIntroText, parseOtpDeliveryInfo, sendCodeLabel } from './otpDelivery';
import { setCurrentLangCode } from '@/i18n/core';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabaseConfigured: true,
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));

describe('fetchOtpDeliveryInfo (MOB-1211-1 §3)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockFrom.mockReset();
    setCurrentLangCode('fr');
  });

  it('calls the public RPC without parameters and never reads app_config', async () => {
    mockRpc.mockResolvedValue({ data: { channel: 'labelflow_whatsapp', expiry_seconds: 300 }, error: null });
    await fetchOtpDeliveryInfo();
    expect(mockRpc).toHaveBeenCalledWith('get_public_otp_delivery_info');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('maps WhatsApp and 300 seconds to a WhatsApp label and 5 minutes', async () => {
    mockRpc.mockResolvedValue({ data: { channel: 'labelflow_whatsapp', expiry_seconds: 300 }, error: null });
    const info = await fetchOtpDeliveryInfo();
    expect(info).toEqual({ channel: 'whatsapp', validityMinutes: 5 });
    expect(sendCodeLabel(info)).toBe('Envoyer le code par WhatsApp');
    expect(otpIntroText(info)).toBe('Vous allez recevoir le code par WhatsApp ; il est valable 5 minutes.');
  });

  it('maps twilio_sms (also when returned as a one-row array) to an SMS label', async () => {
    mockRpc.mockResolvedValue({ data: [{ channel: 'twilio_sms', expiry_seconds: 600 }], error: null });
    const info = await fetchOtpDeliveryInfo();
    expect(info).toEqual({ channel: 'sms', validityMinutes: 10 });
    expect(sendCodeLabel(info)).toBe('Envoyer le code par SMS');
  });

  it('falls back to a neutral label when the RPC fails or throws', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(sendCodeLabel(await fetchOtpDeliveryInfo())).toBe('Recevoir le code');
    mockRpc.mockRejectedValue(new Error('network'));
    const info = await fetchOtpDeliveryInfo();
    expect(info).toBeNull();
    expect(otpIntroText(info)).toBe('On vous envoie un code de confirmation.');
  });

  it('ignores an unknown channel and defaults a missing duration to 5 minutes', () => {
    expect(parseOtpDeliveryInfo({ channel: 'carrier_pigeon', expiry_seconds: 300 })).toBeNull();
    expect(parseOtpDeliveryInfo({ channel: 'twilio_sms' })).toEqual({ channel: 'sms', validityMinutes: 5 });
  });
});
