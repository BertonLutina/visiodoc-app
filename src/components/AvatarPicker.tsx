import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera, Image as ImageIcon, Trash2 } from 'lucide-react-native';
import { Avatar } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { removeAvatarFile, uploadAvatar } from '@/services/avatar';
import { useT } from '@/i18n';

type Tone = 'primary' | 'clay';

/**
 * Pastille de profil : toucher ouvre un choix (caméra / galerie / supprimer).
 * Envoie la photo dans le bucket `avatars` puis enregistre l'URL dans `users.avatar_url`.
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
  const { user, updateProfile } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const badgeBg = tone === 'clay' ? colors.accent : colors.primary;

  const apply = async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user) return;
    setBusy(true);
    try {
      const previous = user.avatarUrl;
      const url = await uploadAvatar(user.id, { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
      await updateProfile({ avatarUrl: url });
      if (previous && previous !== url) void removeAvatarFile(previous);
    } catch (e: any) {
      Alert.alert(t('Photo non enregistrée'), e?.message ?? t('Réessayez dans un instant.'));
    } finally {
      setBusy(false);
    }
  };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
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
    if (!user?.avatarUrl) return;
    setBusy(true);
    try {
      const previous = user.avatarUrl;
      await updateProfile({ avatarUrl: '' });
      void removeAvatarFile(previous);
    } catch (e: any) {
      Alert.alert(t('Photo non supprimée'), e?.message ?? t('Réessayez dans un instant.'));
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

  return (
    <>
      <Pressable
        onPress={() => setSheetOpen(true)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('Changer la photo de profil')}
      >
        <Avatar initials={initials} size={size} tone={tone} uri={user?.avatarUrl} />
        <View
          className="absolute items-center justify-center rounded-full border-2 border-white"
          style={{ width: 28, height: 28, right: -2, bottom: -2, backgroundColor: badgeBg }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Camera color={colors.white} size={14} />}
        </View>
      </Pressable>

      <Modal visible={sheetOpen} transparent animationType="fade" onRequestClose={() => setSheetOpen(false)}>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={() => setSheetOpen(false)}>
          <View className="bg-surface rounded-t-3xl pb-6">
            <Text className="font-serif-bold text-xl text-ink px-5 pt-5 pb-2">{t('Photo de profil')}</Text>
            <Row icon={Camera} label={t('Prendre une photo')} onPress={fromCamera} />
            <Row icon={ImageIcon} label={t('Choisir dans la galerie')} onPress={fromLibrary} />
            {user?.avatarUrl ? <Row icon={Trash2} label={t('Supprimer la photo')} onPress={remove} danger /> : null}
            <Pressable onPress={() => setSheetOpen(false)} className="px-5 pt-4">
              <Text className="font-sans-bold text-base text-muted text-center">{t('Annuler')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
