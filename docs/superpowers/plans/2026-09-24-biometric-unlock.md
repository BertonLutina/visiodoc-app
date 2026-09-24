# Déverrouillage biométrique au lancement — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** au lancement à froid, si l'utilisateur a activé la biométrie, l'app exige Face ID / Touch ID / empreinte avant d'ouvrir la session restaurée.

**Architecture :** un service `biometrics.ts` isole `expo-local-authentication` et les préférences (SecureStore). `AuthContext` retient le profil restauré dans `pendingUser` et expose `locked` / `unlock()` ; `app/_layout.tsx` affiche `BiometricLock` à la place du `Stack` tant que `locked` est vrai. Un hook propose l'activation après une connexion active ; un interrupteur dans les deux profils permet de la changer.

**Tech Stack :** Expo SDK 57, Expo Router, TypeScript, NativeWind, Supabase JS, `expo-local-authentication`, `expo-secure-store`.

**Spec :** `docs/superpowers/specs/2026-09-24-biometric-unlock-design.md`

## Global Constraints

- Toutes les commandes se lancent depuis `visiodoc-app/`.
- Verrou **uniquement au lancement à froid** avec session restaurée ; jamais au retour d'arrière-plan ; jamais après une connexion active.
- Mode mock (Supabase non configuré) : aucun verrou, aucune proposition, pas d'interrupteur.
- Clés SecureStore : `vd_bio_enabled_<userId>` et `vd_bio_offered_<userId>`.
- Texte Face ID (iOS) : « VisioDoc utilise Face ID pour sécuriser l'accès à votre dossier médical. »
- Libellés : `Face ID`, `Touch ID`, `Empreinte digitale`, `Biométrie`.
- Textes UI en français, style existant (classes NativeWind, `colors` de `@/theme/colors`, `Button` de `@/components/ui`).
- Pas de framework de test dans l'app : la vérification automatique est `npm run typecheck` (doit sortir sans erreur) ; la vérification fonctionnelle est la checklist manuelle de la Task 6 sur dev build.
- Git : le dossier `visiodoc-app/` n'est pas encore suivi par Git dans ce dépôt. Les étapes « Commit » s'appliquent une fois le dossier versionné ; sinon les sauter.

---

### Task 1 : Dépendance + service `biometrics`

**Files :**
- Modify: `package.json` (via `npx expo install`)
- Modify: `app.json` (tableau `expo.plugins`)
- Create: `src/services/biometrics.ts`

**Interfaces :**
- Produces (exports de `@/services/biometrics`) :
  - `isAvailable(): Promise<boolean>`
  - `getLabel(): Promise<string>`
  - `authenticate(promptMessage: string): Promise<boolean>`
  - `isEnabled(userId: string): Promise<boolean>`
  - `setEnabled(userId: string, enabled: boolean): Promise<void>` (activer marque aussi « proposé »)
  - `wasOffered(userId: string): Promise<boolean>`
  - `markOffered(userId: string): Promise<void>`
  - `shouldLockAtLaunch(userId: string): Promise<boolean>`

- [ ] **Step 1 : Installer le module**

Run: `npx expo install expo-local-authentication`
Expected : `expo-local-authentication` ajouté à `dependencies` avec une version `~57.x`.

- [ ] **Step 2 : Ajouter le plugin dans `app.json`**

Dans `expo.plugins`, juste après `"expo-secure-store",`, ajouter (si `expo install` l'a déjà ajouté sous forme de simple chaîne, remplacer cette chaîne par ce tableau) :

```json
      [
        "expo-local-authentication",
        {
          "faceIDPermission": "VisioDoc utilise Face ID pour sécuriser l'accès à votre dossier médical."
        }
      ],
```

- [ ] **Step 3 : Créer `src/services/biometrics.ts`**

```ts
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Biométrie du téléphone (Face ID, Touch ID, empreinte) + préférences par utilisateur.
 * Toute erreur native est absorbée : la biométrie ne doit jamais bloquer l'app.
 */

const enabledKey = (userId: string) => `vd_bio_enabled_${userId}`;
const offeredKey = (userId: string) => `vd_bio_offered_${userId}`;

/** Capteur présent ET au moins une empreinte / un visage enregistré. */
export async function isAvailable(): Promise<boolean> {
  try {
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  } catch {
    return false;
  }
}

/** Nom affiché de la méthode : « Face ID », « Touch ID », « Empreinte digitale »… */
export async function getLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
    if (Platform.OS === 'ios') return face ? 'Face ID' : 'Touch ID';
    return finger ? 'Empreinte digitale' : 'Biométrie';
  } catch {
    return 'Biométrie';
  }
}

/** Lance la demande biométrique ; le code du téléphone est accepté en secours. */
export async function authenticate(promptMessage: string): Promise<boolean> {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: 'Annuler',
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  }
}

export async function isEnabled(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(enabledKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function setEnabled(userId: string, enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await SecureStore.setItemAsync(enabledKey(userId), '1');
      await markOffered(userId);
    } else {
      await SecureStore.deleteItemAsync(enabledKey(userId));
    }
  } catch {
    /* ignore */
  }
}

export async function wasOffered(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(offeredKey(userId))) === '1';
  } catch {
    return false;
  }
}

export async function markOffered(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(offeredKey(userId), '1');
  } catch {
    /* ignore */
  }
}

/** Verrouiller au lancement : préférence activée ET biométrie encore disponible. */
export async function shouldLockAtLaunch(userId: string): Promise<boolean> {
  return (await isEnabled(userId)) && (await isAvailable());
}
```

- [ ] **Step 4 : Vérifier les types**

Run: `npm run typecheck`
Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add package.json package-lock.json app.json src/services/biometrics.ts
git commit -m "feat(mobile): service biométrie (expo-local-authentication)"
```

---

### Task 2 : `AuthContext` — verrou, déverrouillage, préférence

**Files :**
- Modify: `src/contexts/AuthContext.tsx`

**Interfaces :**
- Consumes : `isAvailable`, `getLabel`, `authenticate`, `isEnabled`, `setEnabled`, `shouldLockAtLaunch` de `@/services/biometrics`.
- Produces (nouveaux champs de `useAuth()`) :
  - `locked: boolean`
  - `lockedFirstName: string` — prénom du profil en attente (pour l'écran de verrou)
  - `unlock(): Promise<boolean>` — peut lever `Error(PROVIDER_NOT_VALIDATED)`
  - `biometricAvailable: boolean` — biométrie disponible ET Supabase configuré
  - `biometricLabel: string`
  - `biometricEnabled: boolean`
  - `setBiometricEnabled(enabled: boolean): Promise<boolean>` — `true` si la préférence a changé
  - `justSignedIn: boolean`
  - `consumeJustSignedIn(): void`
  - `initializing` reste vrai tant que `locked` est vrai.

- [ ] **Step 1 : Import**

Après la ligne `import { currentProvider } from '@/data/mockProvider';`, ajouter :

```ts
import * as biometrics from '@/services/biometrics';
```

- [ ] **Step 2 : Étendre `AuthContextType`**

Juste avant `  logout: () => Promise<void>;` dans l'interface `AuthContextType`, ajouter :

```ts
  /** Vrai au lancement si la session restaurée attend la biométrie. */
  locked: boolean;
  /** Prénom du compte verrouillé (écran de verrou). */
  lockedFirstName: string;
  /** Demande la biométrie et ouvre la session en attente. */
  unlock: () => Promise<boolean>;
  /** Biométrie utilisable sur ce téléphone (et backend configuré). */
  biometricAvailable: boolean;
  /** « Face ID », « Touch ID », « Empreinte digitale »… */
  biometricLabel: string;
  /** Préférence du compte connecté. */
  biometricEnabled: boolean;
  /** Active (après vérification biométrique) ou désactive. Renvoie vrai si changé. */
  setBiometricEnabled: (enabled: boolean) => Promise<boolean>;
  /** Vrai juste après une connexion active (pas une restauration de session). */
  justSignedIn: boolean;
  consumeJustSignedIn: () => void;
```

- [ ] **Step 3 : Nouveaux états**

Juste après la ligne `const [initializing, setInitializing] = useState<boolean>(!!supabase);`, ajouter :

```ts
  // Déverrouillage biométrique au lancement : le profil restauré attend dans pendingUser.
  const [locked, setLocked] = useState(false);
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Biométrie');
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    biometrics.isAvailable().then(setBiometricAvailable);
    biometrics.getLabel().then(setBiometricLabel);
  }, []);

  // Préférence du compte connecté.
  useEffect(() => {
    if (!user) {
      setBiometricEnabledState(false);
      return;
    }
    let active = true;
    biometrics.isEnabled(user.id).then((v) => active && setBiometricEnabledState(v));
    return () => {
      active = false;
    };
  }, [user?.id]);
```

- [ ] **Step 4 : Verrouiller à la restauration de session**

Dans le `useEffect` de restauration, remplacer :

```ts
          const profile = await loadProfile(data.session.user.id);
          if (active && profile) setUser(profile);
```

par :

```ts
          const profile = await loadProfile(data.session.user.id);
          if (active && profile) {
            if (await biometrics.shouldLockAtLaunch(profile.id)) {
              // Le profil reste en attente : aucun écran ne se charge avant la biométrie.
              setPendingUser(profile);
              setLocked(true);
            } else {
              setUser(profile);
            }
          }
```

Et dans le même `useEffect`, remplacer :

```ts
      if (active && event === 'SIGNED_OUT') setUser(null);
```

par :

```ts
      if (active && event === 'SIGNED_OUT') {
        setUser(null);
        setPendingUser(null);
        setLocked(false);
      }
```

- [ ] **Step 5 : Marquer les connexions actives**

Juste avant `  const signIn = async (email: string, password: string, mockUser: User) => {`, ajouter :

```ts
  // Connexion active (mot de passe, OTP, OAuth, inscription) → jamais verrouillée,
  // et déclenche la proposition d'activer la biométrie.
  const signedIn = (profile: User) => {
    setUser(profile);
    setJustSignedIn(true);
  };
```

Puis remplacer `setUser(...)` par `signedIn(...)` **uniquement** aux endroits suivants (ne pas toucher `updateProfile`, `logout`, ni la restauration) :
- dans `signIn` : `setUser(profile);` → `signedIn(profile);` et `setUser(mockUser);` → `signedIn(mockUser);`
- dans `finishOtp` : `setUser(profile);` → `signedIn(profile);`
- dans `verifyEmailOtp` (mode mock) : `setUser(u);` → `signedIn(u);`
- dans `verifyPhoneOtp` (mode mock) : `setUser(u);` → `signedIn(u);`
- dans `registerPatient` : `setUser(profile);` → `signedIn(profile);` et
  `setUser({ ...currentPatient, firstName: input.firstName, lastName: input.lastName, email: input.email });`
  → `signedIn({ ...currentPatient, firstName: input.firstName, lastName: input.lastName, email: input.email });`

Vérification : `grep -n "setUser(" src/contexts/AuthContext.tsx` ne doit plus lister que la restauration, `SIGNED_OUT`, `signedIn`, `unlock` (Step 6), `updateProfile` et `logout`.

- [ ] **Step 6 : `unlock`, `setBiometricEnabled`, `consumeJustSignedIn`**

Juste avant `  const logout = async () => {`, ajouter :

```ts
  /* ---------- Biométrie ---------- */
  const unlock = async (): Promise<boolean> => {
    if (!pendingUser) return false;
    const ok = await biometrics.authenticate('Déverrouiller VisioDoc');
    if (!ok) return false;
    const profile = pendingUser;
    setPendingUser(null);
    setLocked(false);
    // Un médecin dont le compte n'est plus validé est déconnecté (lève PROVIDER_NOT_VALIDATED).
    await guardProvider(profile);
    setUser(profile);
    return true;
  };

  const setBiometricEnabled = async (enabled: boolean): Promise<boolean> => {
    if (!user) return false;
    if (enabled) {
      if (!(await biometrics.isAvailable())) return false;
      const ok = await biometrics.authenticate(`Activer ${biometricLabel}`);
      if (!ok) return false;
    }
    await biometrics.setEnabled(user.id, enabled);
    setBiometricEnabledState(enabled);
    return true;
  };

  const consumeJustSignedIn = () => setJustSignedIn(false);
```

- [ ] **Step 7 : Nettoyer à la déconnexion**

Dans `logout`, remplacer :

```ts
    setUser(null);
```

par :

```ts
    setUser(null);
    setPendingUser(null);
    setLocked(false);
    setJustSignedIn(false);
```

(La préférence biométrique reste stockée pour ce compte.)

- [ ] **Step 8 : Exposer dans `value`**

Remplacer le bloc `const value = useMemo(...)` entier par :

```ts
  const value = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      loading,
      // Tant que le verrou est actif, on considère la session comme non restaurée.
      initializing: initializing || locked,
      loginPatient,
      loginProvider,
      sendEmailOtp,
      verifyEmailOtp,
      sendPhoneOtp,
      verifyPhoneOtp,
      signInWithProvider,
      sendPasswordReset,
      registerPatient,
      registerProvider,
      updateProfile,
      locked,
      lockedFirstName: pendingUser?.firstName ?? '',
      unlock,
      biometricAvailable,
      biometricLabel,
      biometricEnabled,
      setBiometricEnabled,
      justSignedIn,
      consumeJustSignedIn,
      logout,
    }),
    [user, loading, initializing, locked, pendingUser, biometricAvailable, biometricLabel, biometricEnabled, justSignedIn],
  );
```

- [ ] **Step 9 : Vérifier les types**

Run: `npm run typecheck`
Expected : aucune erreur.

- [ ] **Step 10 : Commit**

```bash
git add src/contexts/AuthContext.tsx
git commit -m "feat(mobile): verrou biométrique au lancement dans AuthContext"
```

---

### Task 3 : Écran de verrou + branchement dans le layout racine

**Files :**
- Create: `src/components/BiometricLock.tsx`
- Modify: `app/_layout.tsx`

**Interfaces :**
- Consumes : `useAuth()` → `locked`, `lockedFirstName`, `unlock`, `logout`, `biometricLabel` (Task 2) ; `authErrorMessage` de `@/utils/authError` ; `Button` de `@/components/ui`.
- Produces : `export function BiometricLock(): JSX.Element` ; composant `AppShell` interne à `app/_layout.tsx` (Task 4 y ajoute un hook).

- [ ] **Step 1 : Créer `src/components/BiometricLock.tsx`**

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Fingerprint, ScanFace } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { authErrorMessage } from '@/utils/authError';

/** Écran affiché au lancement tant que la biométrie n'a pas été validée. */
export function BiometricLock() {
  const { lockedFirstName, unlock, logout, biometricLabel } = useAuth();
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);
  const Icon = biometricLabel === 'Face ID' ? ScanFace : Fingerprint;

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    try {
      await unlock();
    } catch (e) {
      Alert.alert('Connexion impossible', authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [unlock]);

  // Demande automatique une seule fois à l'ouverture.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    tryUnlock();
  }, [tryUnlock]);

  return (
    <SafeAreaView className="flex-1 bg-bg px-6">
      <View className="flex-1 items-center justify-center">
        <Text className="font-serif-bold text-3xl text-primary mb-10">visiodoc</Text>
        <View className="w-20 h-20 rounded-3xl bg-primary-50 items-center justify-center mb-6">
          <Icon color={colors.primary} size={40} />
        </View>
        <Text className="font-serif-bold text-2xl text-ink text-center">
          {lockedFirstName ? `Bonjour ${lockedFirstName}` : 'Bon retour'}
        </Text>
        <Text className="font-sans text-muted text-center mt-2">
          Déverrouillez VisioDoc pour accéder à votre espace.
        </Text>
      </View>
      <View className="pb-6">
        <Button label={`Déverrouiller avec ${biometricLabel}`} onPress={tryUnlock} loading={busy} />
        <Pressable onPress={logout} className="py-4 items-center">
          <Text className="font-sans-bold text-muted">Se déconnecter</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2 : Brancher dans `app/_layout.tsx`**

Ajouter les imports (après `import { AuthProvider } from '@/contexts/AuthContext';`, qui devient) :

```tsx
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { BiometricLock } from '@/components/BiometricLock';
```

Ajouter ce composant au-dessus de `export default function RootLayout()` :

```tsx
/** Contenu de l'app, sous AuthProvider : écran de verrou tant que la biométrie n'est pas validée. */
function AppShell() {
  const { locked } = useAuth();

  if (locked) return <BiometricLock />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(patient)" />
      <Stack.Screen name="(provider)" />
      <Stack.Screen name="doctor/[id]" options={{ presentation: 'card' }} />
      <Stack.Screen name="records" />
      <Stack.Screen name="provider/availability" />
      <Stack.Screen name="provider/fee" />
      <Stack.Screen name="provider/subscription" />
      <Stack.Screen name="call/[room]" options={{ presentation: 'fullScreenModal' }} />
    </Stack>
  );
}
```

Dans `RootLayout`, remplacer tout le bloc `<Stack ...>...</Stack>` par `<AppShell />`, ce qui donne :

```tsx
        <AuthProvider>
          <StatusBar style="dark" />
          <AppShell />
        </AuthProvider>
```

- [ ] **Step 3 : Vérifier les types**

Run: `npm run typecheck`
Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add src/components/BiometricLock.tsx app/_layout.tsx
git commit -m "feat(mobile): écran de verrou biométrique au lancement"
```

---

### Task 4 : Proposition d'activation après connexion

**Files :**
- Create: `src/hooks/useBiometricOffer.ts`
- Modify: `app/_layout.tsx` (composant `AppShell` de la Task 3)

**Interfaces :**
- Consumes : `useAuth()` → `user`, `justSignedIn`, `consumeJustSignedIn`, `biometricAvailable`, `biometricLabel`, `setBiometricEnabled` ; `wasOffered`, `markOffered` de `@/services/biometrics`.
- Produces : `export function useBiometricOffer(): void`

- [ ] **Step 1 : Créer `src/hooks/useBiometricOffer.ts`**

```ts
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import * as biometrics from '@/services/biometrics';

/**
 * Après une connexion active, propose une seule fois par compte
 * d'activer le déverrouillage biométrique.
 */
export function useBiometricOffer() {
  const { user, justSignedIn, consumeJustSignedIn, biometricAvailable, biometricLabel, setBiometricEnabled } =
    useAuth();

  useEffect(() => {
    if (!justSignedIn || !user) return;
    consumeJustSignedIn();
    if (!biometricAvailable) return;

    const userId = user.id;
    (async () => {
      if (await biometrics.wasOffered(userId)) return;
      await biometrics.markOffered(userId);
      Alert.alert(
        'Déverrouillage rapide',
        `Utiliser ${biometricLabel} pour ouvrir VisioDoc la prochaine fois ?`,
        [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Activer', onPress: () => void setBiometricEnabled(true) },
        ],
      );
    })();
    // Déclenché uniquement par une nouvelle connexion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justSignedIn, user?.id]);
}
```

- [ ] **Step 2 : Appeler le hook dans `AppShell`**

Dans `app/_layout.tsx`, ajouter l'import :

```tsx
import { useBiometricOffer } from '@/hooks/useBiometricOffer';
```

et dans `AppShell`, juste après `const { locked } = useAuth();` :

```tsx
  useBiometricOffer();
```

- [ ] **Step 3 : Vérifier les types**

Run: `npm run typecheck`
Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add src/hooks/useBiometricOffer.ts app/_layout.tsx
git commit -m "feat(mobile): proposer la biométrie après la première connexion"
```

---

### Task 5 : Interrupteur dans les profils patient et médecin

**Files :**
- Create: `src/components/BiometricToggleRow.tsx`
- Modify: `app/(patient)/profile.tsx`
- Modify: `app/(provider)/profile.tsx`

**Interfaces :**
- Consumes : `useAuth()` → `biometricAvailable`, `biometricLabel`, `biometricEnabled`, `setBiometricEnabled`.
- Produces : `export function BiometricToggleRow({ tone }: { tone?: 'primary' | 'accent' }): JSX.Element | null`

- [ ] **Step 1 : Créer `src/components/BiometricToggleRow.tsx`**

```tsx
import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Fingerprint, ScanFace } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';

/** Section « Sécurité » : active / désactive le déverrouillage biométrique. */
export function BiometricToggleRow({ tone = 'primary' }: { tone?: 'primary' | 'accent' }) {
  const { biometricAvailable, biometricLabel, biometricEnabled, setBiometricEnabled } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!biometricAvailable) return null;

  const Icon = biometricLabel === 'Face ID' ? ScanFace : Fingerprint;
  const tint = tone === 'accent' ? colors.accent : colors.primary;
  const bg = tone === 'accent' ? 'bg-accent-50' : 'bg-primary-50';

  const onChange = async (next: boolean) => {
    setBusy(true);
    try {
      await setBiometricEnabled(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text className="font-sans-bold text-ink text-lg mb-3 mt-4 ml-1">Sécurité</Text>
      <View className="bg-surface rounded-3xl border border-line overflow-hidden">
        <View className="flex-row items-center px-4 py-4">
          <View className={`w-10 h-10 rounded-2xl ${bg} items-center justify-center mr-3`}>
            <Icon color={tint} size={18} />
          </View>
          <View className="flex-1">
            <Text className="text-ink font-sans-semibold">Déverrouillage par {biometricLabel}</Text>
            <Text className="font-sans text-xs text-muted mt-0.5">Demandé à chaque ouverture de l'app</Text>
          </View>
          <Switch
            value={biometricEnabled}
            onValueChange={onChange}
            disabled={busy}
            trackColor={{ true: tint, false: colors.line }}
          />
        </View>
      </View>
    </>
  );
}
```

- [ ] **Step 2 : Profil patient**

Dans `app/(patient)/profile.tsx`, ajouter l'import après `import { useAuth } from '@/contexts/AuthContext';` :

```tsx
import { BiometricToggleRow } from '@/components/BiometricToggleRow';
```

Puis, juste avant le `<Pressable onPress={onLogout} ...>` du bouton « Se déconnecter », ajouter :

```tsx
        <BiometricToggleRow />
```

- [ ] **Step 3 : Profil médecin**

Dans `app/(provider)/profile.tsx`, ajouter l'import après `import { useAuth } from '@/contexts/AuthContext';` :

```tsx
import { BiometricToggleRow } from '@/components/BiometricToggleRow';
```

Puis, juste avant le `<Pressable onPress={onLogout} ...>` du bouton « Se déconnecter », ajouter :

```tsx
        <BiometricToggleRow tone="accent" />
```

- [ ] **Step 4 : Vérifier les types**

Run: `npm run typecheck`
Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add src/components/BiometricToggleRow.tsx "app/(patient)/profile.tsx" "app/(provider)/profile.tsx"
git commit -m "feat(mobile): interrupteur biométrie dans les profils"
```

---

### Task 6 : Vérification sur appareil

**Files :** aucun (sauf correctifs trouvés).

- [ ] **Step 1 : Construire un dev build** (module natif ajouté ; Face ID indisponible dans Expo Go iOS)

Run: `npx expo run:ios --device` (ou `npx expo run:android --device`), ou un build EAS `development`.
Expected : l'app démarre sur le téléphone.

- [ ] **Step 2 : Checklist manuelle** (iOS Face ID **et** Android empreinte si possible)

- [ ] Première connexion patient (mot de passe) → alerte « Déverrouillage rapide » une seule fois ; « Activer » → demande biométrique → interrupteur Profil activé.
- [ ] Se déconnecter / se reconnecter avec le même compte → pas de nouvelle alerte.
- [ ] « Plus tard » sur un autre compte → plus jamais proposé ; activable depuis le Profil.
- [ ] Tuer l'app puis la rouvrir → écran de verrou « Bonjour {prénom} », demande automatique ; succès → bon espace (patient / médecin).
- [ ] Annuler la demande → reste sur le verrou ; bouton « Déverrouiller avec … » relance ; « Se déconnecter » → accueil public.
- [ ] App en arrière-plan puis retour → pas de verrou.
- [ ] Interrupteur off → rouvrir à froid → pas de verrou.
- [ ] Connexion OTP email / SMS et Google → alerte proposée (si pas déjà proposée).
- [ ] Téléphone / simulateur sans biométrie enregistrée → pas d'alerte, pas de section « Sécurité », comportement actuel inchangé.
- [ ] Sans `.env` (mode mock) → comportement actuel inchangé.

- [ ] **Step 3 : Typecheck final**

Run: `npm run typecheck`
Expected : aucune erreur.
