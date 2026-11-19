import React, { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Baby, Check } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import {
  getAcceptsChildrenSettings,
  hideAcceptsChildrenPrompt,
  setAcceptsChildren,
  shouldShowAcceptsChildrenPrompt,
} from '@/services/providerApi';
import { useT } from '@/i18n';

/**
 * Invitation (MOB-1311-1 §4, MOB-1711-1) : « Acceptez-vous les consultations pour des enfants ? », posée seulement
 * si `accepts_children` est vide ET `hide_accepts_children_prompt` est faux. La case « Ne plus afficher » est
 * mémorisée côté serveur.
 */
export function AcceptsChildrenPrompt({ userId }: { userId: string }) {
  const t = useT();
  const req = useAsync(() => getAcceptsChildrenSettings(userId), [userId]);
  const [dontShow, setDontShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (dismissed || !shouldShowAcceptsChildrenPrompt(req.data)) return null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await fn();
      setDismissed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mx-5 mb-5 bg-surface border border-line rounded-3xl p-4">
      <View className="flex-row items-center mb-2">
        <Baby color={colors.accent} size={20} />
        <Text className="font-sans-bold text-ink ml-2 flex-1">{t('Acceptez-vous les consultations pour des enfants ?')}</Text>
      </View>
      <Text className="font-sans text-xs text-muted mb-3">
        {t('Vous pourrez modifier ce réglage à tout moment dans votre profil.')}
      </Text>
      <View className="flex-row">
        <View className="flex-1 mr-2">
          <Button label={t('Oui')} variant="accent" disabled={busy} onPress={() => run(() => setAcceptsChildren(userId, true))} />
        </View>
        <View className="flex-1">
          <Button label={t('Non')} variant="outline" disabled={busy} onPress={() => run(() => setAcceptsChildren(userId, false))} />
        </View>
      </View>
      <Pressable
        onPress={() => setDontShow((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: dontShow }}
        className="flex-row items-center mt-3"
      >
        <View className={`w-5 h-5 rounded border items-center justify-center mr-2 ${dontShow ? 'bg-accent border-accent' : 'bg-surface border-line'}`}>
          {dontShow ? <Check color={colors.white} size={14} strokeWidth={3} /> : null}
        </View>
        <Text className="font-sans text-xs text-ink">{t('Ne plus afficher ce message')}</Text>
      </Pressable>
      <Pressable
        onPress={() => (dontShow ? run(() => hideAcceptsChildrenPrompt(userId)) : setDismissed(true))}
        className="self-start mt-2"
      >
        <Text className="font-sans-semibold text-xs text-muted underline">{t('Plus tard')}</Text>
      </Pressable>
      {failed ? <Text className="font-sans text-xs text-danger mt-2">{t('Une erreur est survenue. Réessayez plus tard.')}</Text> : null}
    </View>
  );
}

/** Réglage modifiable « J'accepte les consultations pour des enfants » (profil du prestataire). */
export function AcceptsChildrenSwitch({ userId }: { userId: string }) {
  const t = useT();
  const req = useAsync(() => getAcceptsChildrenSettings(userId), [userId]);
  const [override, setOverride] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const value = override ?? req.data?.acceptsChildren ?? false;

  const onChange = async (next: boolean) => {
    setFailed(false);
    const previous = override;
    setOverride(next);
    try {
      await setAcceptsChildren(userId, next);
    } catch {
      setOverride(previous);
      setFailed(true);
    }
  };

  return (
    <View className="bg-surface rounded-3xl border border-line px-4 py-4 mt-4">
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-2xl bg-accent-50 items-center justify-center mr-3">
          <Baby color={colors.accent} size={18} />
        </View>
        <View className="flex-1 mr-3">
          <Text className="text-ink font-sans-semibold">{t("J'accepte les consultations pour des enfants")}</Text>
          {req.data && req.data.acceptsChildren === null && override === null ? (
            <Text className="font-sans text-xs text-muted mt-0.5">{t('Non précisé')}</Text>
          ) : null}
        </View>
        <Switch value={value} onValueChange={onChange} disabled={req.loading || !!req.error} />
      </View>
      {failed ? <Text className="font-sans text-xs text-danger mt-2">{t('Une erreur est survenue. Réessayez plus tard.')}</Text> : null}
    </View>
  );
}
