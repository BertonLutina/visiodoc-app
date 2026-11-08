import React from 'react';
import { Field } from '@/components/ui';
import { passwordIssue, passwordIssueMessage, passwordStrength } from '@/services/passwordPolicy';
import { useT } from '@/i18n';

type Props = {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
};

/** Champ mot de passe avec la règle des 10 caractères et l'indicateur de force (Faible / Correct / Fort). */
export function PasswordField({ label, value, onChangeText }: Props) {
  const t = useT();
  const issue = passwordIssue(value);
  const level = { weak: t('Faible'), ok: t('Correct'), strong: t('Fort') }[passwordStrength(value)];
  const typed = value.length > 0;
  return (
    <Field
      label={label}
      placeholder="••••••••"
      secureTextEntry
      value={value}
      onChangeText={onChangeText}
      error={typed && issue ? `${level} · ${passwordIssueMessage(issue)}` : undefined}
      hint={typed ? t('Force : {level}', { level }) : t('10 caractères minimum, avec au moins une lettre et un chiffre.')}
    />
  );
}
