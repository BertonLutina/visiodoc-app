# Déverrouillage biométrique au lancement — Design

Date : 2026-09-24
App : `visiodoc-app` (Expo / Expo Router / Supabase)

## Objectif

Après une première connexion, l'utilisateur (patient ou médecin) peut déverrouiller l'app
avec la biométrie du téléphone (Face ID, Touch ID, empreinte) au lieu de n'avoir aucune
protection à la réouverture.

## Décisions

| Sujet | Décision |
|---|---|
| Quand demander la biométrie | Uniquement au **lancement à froid** de l'app, si une session persistée est restaurée. Pas de re-verrouillage au retour d'arrière-plan. |
| Activation | **Proposée** une seule fois par compte après une connexion réussie + **interrupteur dans le Profil** (patient et médecin). |
| Déconnexion | Reste une vraie déconnexion : la connexion suivante passe par le mot de passe / OTP / OAuth. Pas de « connexion rapide » biométrique depuis l'écran de login. |
| Secours en cas d'échec | Le code du téléphone (fallback OS) est autorisé ; l'écran de verrou propose aussi « Se déconnecter ». |
| Approche | La session est restaurée mais le **profil est retenu** (`user` reste `null`) tant que la biométrie n'est pas validée : aucun écran ni donnée médicale n'est chargé derrière le verrou. |

Approches écartées : overlay posé au-dessus de l'app déjà chargée (les données se chargent
derrière) ; stockage de la session dans SecureStore avec `requireAuthentication` (surdimensionné
pour un verrou au lancement, session perdue si les empreintes changent).

## Composants

### Dépendance
- `expo-local-authentication` (version compatible SDK 57 via `npx expo install`).
- Plugin dans `app.json` avec `faceIDPermission` :
  « VisioDoc utilise Face ID pour sécuriser l'accès à votre dossier médical. »
- Face ID n'est pas disponible dans Expo Go sur iOS → tester sur un dev build (déjà requis pour Jitsi).

### `src/services/biometrics.ts` (nouveau)
Une seule responsabilité : parler au matériel biométrique et stocker les préférences.
- `isAvailable(): Promise<boolean>` → `hasHardwareAsync() && isEnrolledAsync()`.
- `getLabel(): Promise<string>` → iOS : « Face ID » (reconnaissance faciale) sinon « Touch ID » ;
  Android : « Empreinte digitale » (empreinte) sinon « Biométrie ».
- `authenticate(promptMessage): Promise<boolean>` → `authenticateAsync` avec
  `disableDeviceFallback: false`, `cancelLabel: 'Annuler'`. Renvoie `true` seulement si `success`.
- Préférences par utilisateur dans `expo-secure-store` :
  - `isEnabled(userId)` / `setEnabled(userId, bool)` — clé `vd_bio_enabled_<userId>`
  - `wasOffered(userId)` / `markOffered(userId)` — clé `vd_bio_offered_<userId>`
  - Les clés SecureStore n'acceptent que `[A-Za-z0-9._-]` : les UUID Supabase conviennent.
- Toute erreur native est absorbée (renvoie `false`) : la biométrie ne doit jamais bloquer
  l'app à cause d'un bug de module.

### `src/contexts/AuthContext.tsx` (modifié)
Nouveaux champs du contexte :
- `locked: boolean` — vrai au démarrage si session restaurée + biométrie activée pour ce user
  + biométrie disponible. Le profil chargé est gardé dans un état interne `pendingUser`,
  `user` reste `null`.
- `unlock(): Promise<boolean>` — lance `authenticate`, puis en cas de succès : passe
  `pendingUser` dans `user` (après `guardProvider`), `locked = false`.
- `biometricEnabled: boolean` — préférence du user courant (chargée quand `user` change).
- `setBiometricEnabled(enabled): Promise<boolean>` — pour activer, exige un `authenticate` réussi
  (sinon ne change rien, renvoie `false`) ; pour désactiver, écrit directement.
- `biometricAvailable` / `biometricLabel` — calculés une fois au démarrage (faux en mode mock),
  `lockedFirstName` — prénom du profil en attente pour l'écran de verrou.
- `logout()` : remet `locked = false` et `pendingUser = null`. La préférence reste stockée.

Règles :
- Seule la restauration de session au démarrage (`getSession` dans le `useEffect` initial)
  peut verrouiller. Les connexions actives (mot de passe, OTP, OAuth, inscription) ne verrouillent jamais.
- Mode mock (Supabase non configuré) : jamais de verrou.
- Si la biométrie est activée mais plus disponible (empreintes supprimées) → pas de verrou.
- Un médecin plus validé : `guardProvider` s'applique au moment de `unlock()` (déconnexion + erreur).
- `initializing` reste vrai tant que `locked` est vrai pour que `app/index.tsx` n'effectue
  aucune redirection derrière le verrou.

### `src/components/BiometricLock.tsx` (nouveau)
Écran plein écran rendu par `app/_layout.tsx` à la place du `Stack` quand `locked` est vrai.
- Logo « visiodoc », « Bonjour {prénom} », icône (lucide `ScanFace` / `Fingerprint`).
- Au montage : appelle `unlock()` automatiquement une fois.
- Bouton primaire « Déverrouiller avec {label} » → `unlock()`.
- Lien « Se déconnecter » → `logout()` → l'app revient à l'accueil public / login.
- Style cohérent avec le thème existant (`colors`, classes NativeWind).

### Proposition après connexion — `src/hooks/useBiometricOffer.ts` (nouveau)
Monté dans `app/_layout.tsx`. Quand `user` devient non nul **suite à une connexion active**
(pas un déverrouillage) et que `isAvailable()` && `!wasOffered(user.id)` && `!isEnabled(user.id)` :
- `Alert.alert('Activer {label} ?', 'Déverrouillez VisioDoc avec {label} à la prochaine ouverture.', [Plus tard, Activer])`.
- Dans les deux cas : `markOffered(user.id)`. « Activer » → `setBiometricEnabled(true)`.
- Pour distinguer connexion active vs restauration : l'`AuthContext` expose
  `justSignedIn: boolean` (mis à vrai par les fonctions de connexion/inscription, remis à faux
  après consommation via `consumeJustSignedIn()`).

### Profil — `app/(patient)/profile.tsx` et `app/(provider)/profile.tsx` (modifiés)
Ligne « Déverrouillage par {label} » avec un `Switch` React Native, affichée seulement si
`isAvailable()`. Valeur = `biometricEnabled`, changement = `setBiometricEnabled`.

## Flux

1. **Première connexion** : login → `setUser` + `justSignedIn` → alerte de proposition → Activer
   → vérification biométrique → préférence enregistrée.
2. **Réouverture à froid** : session restaurée → préférence activée + dispo → `locked` →
   `BiometricLock` → demande automatique → succès → `user` défini → `index.tsx` redirige vers l'espace.
3. **Échec / annulation** : reste sur `BiometricLock` ; « Déverrouiller » pour réessayer
   ou « Se déconnecter ».
4. **Désactivation** : Profil → interrupteur off → prochaine ouverture sans verrou.

## Vérification

Pas de framework de test dans l'app mobile : `npm run typecheck` + checklist manuelle sur
dev build (iOS Face ID et Android empreinte) :
- [ ] Proposition affichée une seule fois par compte après la première connexion.
- [ ] Refus (« Plus tard ») → plus jamais proposé ; activable depuis le Profil.
- [ ] App tuée puis rouverte → écran de verrou, demande auto, succès → espace correct (patient / médecin).
- [ ] Annulation → reste verrouillé ; « Se déconnecter » → écran de connexion.
- [ ] Passage en arrière-plan puis retour → pas de verrou.
- [ ] Interrupteur Profil off → plus de verrou au lancement suivant.
- [ ] Téléphone sans biométrie → aucune proposition, pas de ligne Profil, comportement actuel inchangé.
- [ ] Mode mock (sans `.env`) → comportement actuel inchangé.
