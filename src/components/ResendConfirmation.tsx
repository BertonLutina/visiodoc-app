import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { registerPatientErrorMessage, resendCooldownRemaining, resendEmailConfirmation } from '@/services/registration';
import { useT } from '@/i18n';

/**
 * Bouton « Renvoyer l'e-mail » de confirmation (`resend-email-confirmation`), bloqué 60 secondes
 * entre deux envois. `initialSentAt` : l'instant où un e-mail vient déjà de partir (inscription),
 * pour démarrer le décompte tout de suite.
 */
export function ResendConfirmation({
  email,
  initialSentAt = null,
  variant = 'outline',
}: {
  email: string;
  initialSentAt?: number | null;
  variant?: 'primary' | 'accent' | 'outline';
}) {
  const t = useT();
  const [lastSentAt, setLastSentAt] = useState<number | null>(initialSentAt);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const remaining = resendCooldownRemaining(lastSentAt, now);

  // Tic chaque seconde tant que le décompte court.
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [remaining > 0]);

  const onResend = async () => {
    setFeedback(null);
    setSending(true);
    try {
      await resendEmailConfirmation(email);
      const sentAt = Date.now();
      setNow(sentAt);
      setLastSentAt(sentAt);
      setFeedback({
        ok: true,
        text: t("Si cette adresse est associée à un compte non confirmé, un nouveau lien de confirmation a été envoyé."),
      });
    } catch (e: any) {
      setFeedback({ ok: false, text: registerPatientErrorMessage(e) });
    } finally {
      setSending(false);
    }
  };

  return (
    <View>
      <Button
        label={remaining > 0 ? t("Renvoyer l'e-mail ({seconds} s)", { seconds: remaining }) : t("Renvoyer l'e-mail")}
        variant={variant}
        loading={sending}
        disabled={remaining > 0 || !email.trim()}
        onPress={onResend}
      />
      {feedback ? (
        <Text
          className={`font-sans-medium text-sm text-center mt-3 ${feedback.ok ? 'text-muted' : 'text-danger'}`}
        >
          {feedback.text}
        </Text>
      ) : null}
    </View>
  );
}
