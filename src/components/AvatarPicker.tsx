import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Image as ImageIcon, Trash2 } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { avatarErrorMessage, removeAvatar, uploadAvatar } from '@/services/avatar';
import { useAvatarUri } from '@/hooks/useAvatarUri';
import { supabaseConfigured } from '@/lib/supabase';
import { useT } from '@/i18n';

type Tone = 'primary' | 'clay';

/**
 * Pastille de profil : toucher ouvre un choix (caméra / galerie / supprimer).
 * La photo est convertie en JPEG, envoyée dans `avatars-private/<id>/incoming/` puis validée par
 * `finalize-avatar` : le client n'écrit jamais `users.avatar_url` (MOB-1611-2).
 * Prestataire : l'état « en attente de validation » / « refusée » (avec le motif) s'affiche sous la pastille.
 */
export function AvatarPicker({
  initials,
  size = 76,
  tone = 'primary',
}: {
  initials: string;
  size?: number;
  tone?: Tone;
}) {
  const { user, reloadProfile } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Mode démo (sans Supabase) uniquement : aperçu local de la photo choisie.
  const [demoUri, setDemoUri] = useState<string | null>(null);
  const remoteUri = useAvatarUri(user);
  const t = useT();
  const badgeBg = tone === 'clay' ? colors.accent : colors.primary;
  const isProvider = user?.role === 'provider';
  const hasPhoto = !!(demoUri || user?.avatarUrl || user?.avatarPath || user?.avatarPendingPath);

  const apply = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user) return;
    setBusy(true);
    try {
      await uploadAvatar(user.id, { uri: asset.uri, width: asset.width, height: asset.height });
      if (!supabaseConfigured) setDemoUri(asset.uri);
      else await reloadProfile();
    } catch (e: unknown) {
      Alert.alert(t('Photo non enregistrée'), avatarErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
  };

  const fromLibrary = async () => {
    setSheetOpen(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('Accès refusé'), t("Autorisez l'accès à la photothèque dans les réglages du téléphone."));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets[0]) await apply(result.assets[0]);
  };

  const fromCamera = async () => {
    setSheetOpen(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('Accès refusé'), t("Autorisez l'accès à la caméra dans les réglages du téléphone."));
      return;
    }
    const result = await ImagePicker.launchCameraAsync(options);
    if (!result.canceled && result.assets[0]) await apply(result.assets[0]);
  };

  const remove = async () => {
    setSheetOpen(false);
    if (!hasPhoto) return;
    setBusy(true);
    try {
      await removeAvatar();
      setDemoUri(null);
      if (supabaseConfigured) await reloadProfile();
    } catch (e: unknown) {
      Alert.alert(t('Photo non supprimée'), avatarErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ icon: Icon, label, onPress, danger }: { icon: typeof Camera; label: string; onPress: () => void; danger?: boolean }) => (
    <Pressable onPress={onPress} className="flex-row items-center px-5 py-4 border-b border-line">
      <Icon color={danger ? colors.danger : colors.ink} size={20} />
      <Text className={`ml-3 font-sans-semibold text-base ${danger ? 'text-danger' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );

  const review = isProvider ? user?.avatarReviewStatus : undefined;

  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('Changer la photo de profil')}
      >
        <Avatar initials={initials} size={size} tone={tone} uri={demoUri ?? remoteUri} />
        <View
          className="absolute items-center justify-center rounded-full border-2 border-white"
          style={{ width: 28, height: 28, right: -2, bottom: -2, backgroundColor: badgeBg }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Camera color={colors.white} size={14} />}
        </View>
      </Pressable>

      {review === 'pending' ? (
        <Text className="font-sans-semibold text-xs text-center mt-2" style={{ color: colors.accent }}>
          {t('Photo en attente de validation')}
        </Text>
      ) : null}
      {review === 'rejected' ? (
        <View className="mt-2 items-center">
          <Text className="font-sans-semibold text-xs text-center text-danger">{t('Photo refusée')}</Text>
          {user?.avatarReviewNote ? (
            <Text className="font-sans text-xs text-muted text-center mt-0.5">
              {t('Motif : {note}', { note: user.avatarReviewNote })}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setSheetOpen(false)}>
          <View className="bg-surface rounded-t-3xl pb-6">
            <Text className="font-serif-bold text-xl text-ink px-5 pt-5 pb-2">{t('Photo de profil')}</Text>
            <Row icon={Camera} label={t('Prendre une photo')} onPress={fromCamera} />
            <Row icon={ImageIcon} label={t('Choisir dans la galerie')} onPress={fromLibrary} />
            {hasPhoto ? <Row icon={Trash2} label={t('Supprimer la photo')} onPress={remove} danger /> : null}
            <Pressable onPress={() => setSheetOpen(false)} className="px-5 pt-4">
              <Text className="font-sans-bold text-base text-muted text-center">{t('Annuler')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
