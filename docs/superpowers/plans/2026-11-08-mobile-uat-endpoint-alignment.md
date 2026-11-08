# Alignement mobile sur le contrat backend UAT

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire fonctionner l'application mobile Expo avec les mêmes tables, vues, RPC et Edge Functions que le web, selon le guide Notion du 07/11/2026.

**Architecture:** Le mobile ne crée pas d'endpoints. Chaque écran passe par une fonction de service déjà testée (`src/services`, `src/contexts/AuthContext.tsx`) qui appelle le contrat serveur. Les règles pures (mot de passe, rôle, statut médecin, fenêtre vidéo, masquage tarif) vivent dans des modules sans Supabase, testés par Jest. Les écritures de paiement, d'inscription et de jeton vidéo ne sont jamais calculées ou confirmées par le client.

**Tech Stack:** Expo Router, React Native, Supabase JS, Jest. Edge Functions sur le projet UAT `pslypdfjmjetjhtpzwip` et Production `cftqxuxhsellvquidpxr`.

**Spec:** Guide Notion « Guide d'intégration mobile (UAT) », page `40e758ac117381dd892afbc1307da354`, mis à jour le 07/11/2026 (MOB-0612-1, MOB-0612-3) et le 08/11/2026 pour les verrous `subscription_payment_lock` et `wallet_payment_lock`. Les valeurs ci-dessous sont copiées de ce guide.

## Global Constraints

- Rôles mobiles autorisés : `patient`, `provider`, `doctor`. Tout autre rôle (`super_admin`, `admin`, `country_admin`, `provider_validator`, et leurs variantes en majuscules) est déconnecté avec le texte exact : « Vous n'êtes pas autorisé ici, utilisez la version web. »
- `users.gender` : uniquement `'male'` ou `'female'`. Libellés « Masculin » et « Féminin ». `'other'` est interdit.
- Inscription patient : `POST /functions/v1/register-patient` avec le jeton anonyme. Plus de `supabase.auth.signUp` ni d'`insert` dans `users` pour un patient.
- Pays patient : envoyer l'UUID du pays choisi, ou omettre `countryId`. Ne jamais envoyer le premier pays de la liste. Défaut serveur : RDC (`CD`).
- Mot de passe : 10 à 72 caractères, au moins une lettre et un chiffre. Regex client : `/^(?=.*[a-zA-Z])(?=.*[0-9]).{10,72}$/`.
- HTTP 422 `error_code: weak_password` et `reasons` contenant `pwned` : « Ce mot de passe a déjà fuité sur Internet, choisis-en un autre. »
- Session expirée (`session_expired`, `refresh_token_not_found`, « Invalid Refresh Token: Session Expired », « JWT expired ») : purger la session et afficher « Ta session a expiré, reconnecte-toi. » Ne jamais stocker le mot de passe.
- Catalogue : vue `public_provider_listing`. Visiteur ou `consultation_fee === null` : masquer tarif et créneaux, texte « Connectez-vous pour voir le tarif et les disponibilités ».
- Créneaux occupés : RPC `doctor_busy_slots(p_doctor_id, p_from, p_to)`, session obligatoire, plage maximale 62 jours. Plus de lecture de `consultation_busy_times`.
- Identité médecin vue par un patient : vue `provider_identity` (`id, first_name, last_name, post_nom, avatar_url, specialization, country_id`). Jamais `email` ni `phone` d'un prestataire.
- Consultation : insert `status: 'pending_payment'`, `payment_status: 'pending'`. Le client n'écrit plus `payment_status`, `payment_amount`, `currency`, `payment_reference`, ni un passage à `scheduled`.
- Paiement consultation : `register-payment-attempt` puis widget puis `confirm-consultation-payment`. `payment-initiate` et `payment-initiate-v2` ne sont plus appelés.
- Erreur SQL `23P01` : « Ce créneau vient d'être réservé par un autre utilisateur ».
- Visio : `POST /functions/v1/get-video-token` avec `{ roomId }` et `Authorization: Bearer <session>`. `roomId` = `consultations.video_room_id` si présent, sinon `consultations.id`. Plus de `get-jitsi-token` ni de `meet.jit.si` sans jeton.
- Fenêtre visio : ouverture 15 min avant `scheduled_at`, fermeture 30 min après la fin. 403 `room_not_open_yet` / `room_closed` / `consultation_cancelled` avec les messages du guide.
- `users.doctor_status` comparé tel quel, sans passage en majuscules : `VALIDE_ABO_ACTIF`, `VALIDE_SANS_ABO`, `EN_ATTENTE_VALIDATION`, `en_attente_de_validation`, `profil_incomplet`, `profil_valide`, `profil_rejete`. Suspension = `users.is_active = false`.
- Abonnement et recharge d'avoir prestataire : `register-provider-payment-attempt` avant le widget. Le client n'envoie pas de montant. Une erreur réseau, 429 ou 503 n'arrête pas le paiement. `409 NOT_PAYABLE` et `404` l'arrêtent. Ne pas appeler en simulation locale.
- UAT = `https://pslypdfjmjetjhtpzwip.supabase.co`. Production = `https://cftqxuxhsellvquidpxr.supabase.co`. Aucune clé en dur dans `eas.json`. Aucun test, compte factice ou paiement d'essai sur Production.
- Jetons de session dans `expo-secure-store`. `AsyncStorage` reste autorisé pour la langue, les notifications et les brouillons non secrets.
- `npm test` et `npm run typecheck` passent à la fin de chaque tâche.

## Review Focus

- Une réservation qui insère encore `status: 'scheduled'` est refusée par `consultation_payment_lock` (`42501`, `payment_fields_locked`) ou, si le montant s'écarte de plus de 10 % du tarif, par `insert_amount_out_of_range`. Le patient doit voir un message de tarif, pas une erreur SQL brute.
- `register-patient` appelé avec le premier pays de la liste rattache un patient de la RDC au Niger. Le corps n'envoie `countryId` que si l'utilisateur a choisi un pays.
- Une jointure patient `doctor:users(...)` renvoie un médecin vide depuis la suppression de la RLS « Patients can view active providers ». L'écran rendez-vous doit lire `provider_identity`.
- `mapUserRow` transforme aujourd'hui tout rôle inconnu en `patient`. Un `country_admin` ne doit jamais ouvrir l'espace patient.
- Un refresh token déjà utilisé invalide la session. L'app ne doit pas boucler sur `refreshSession`, ni réécrire le mot de passe en local pour se reconnecter.

---

## Écart constaté dans ce dépôt

| Règle | Aujourd'hui | Cible |
| --- | --- | --- |
| Inscription patient | `signUp` puis `insert` dans `users`, connexion immédiate, pas de `gender` (`AuthContext.registerPatient`) | `register-patient`, écran « Vérifie ta boîte e-mail », pas de session avant confirmation |
| Inscription prestataire | `register-presta` sans `gender`, champs `specialization` au lieu de `serviceTypeId` | `gender: 'male' \| 'female'` et le corps du guide |
| Rôle | `mapUserRow` : tout sauf `provider` et `admin` devient `patient` | Refus + `signOut` |
| Statut médecin | `isProviderValidated` met le statut en majuscules et connaît `PENDING`, `REJECTED`, `SUSPENDED` | Les 7 valeurs exactes, écrans distincts |
| Catalogue | `supabasePublic.from('users')` | `public_provider_listing`, tarifs masqués hors session |
| Créneaux | `consultation_busy_times` dans `availabilityApi.ts` | `doctor_busy_slots`, max 62 jours |
| Identité médecin | `doctor:users!consultations_doctor_id_fkey` | `doctor:provider_identity!doctor_id` |
| Paiement consultation | insert `scheduled` + `payment-initiate-v2` | `pending_payment` + `register-payment-attempt` + `confirm-consultation-payment` |
| Visio | `app/call/[room].tsx` est une maquette ; `EXPO_PUBLIC_JITSI_DOMAIN=meet.jit.si` | `get-video-token` puis WebView `8x8.vc` |
| Sessions | `AsyncStorage` dans `src/lib/supabase.ts` | `expo-secure-store` + message d'expiration |
| Environnements | `eas.json` : development, preview et production pointent tous vers le projet Production, avec une clé anon écrite dans le fichier | UAT pour development/preview, Production seulement pour production, clés hors dépôt |
| Abonnement | `app/provider/subscription.tsx` est une maquette qui fait `router.back()` | Aucun widget tant que `register-provider-payment-attempt` n'est pas appelé avant |
| Ordonnances | dossier médical local `record_type: 'prescription'` | table `prescriptions` + QR `https://visiodoc.cd/?verify_rx=<qr_token_hash>` |

Les entrées MOB-0612-1 (inscription) et le paiement consultation sont bloquants : le guide dit que l'inscription mobile actuelle est cassée dès que la confirmation d'e-mail est obligatoire, et que `payment-initiate` répond 404.

## Fichiers

- Créer : `src/services/passwordPolicy.ts` — règles 10–72, lettre + chiffre, message 422.
- Créer : `src/services/accessPolicy.ts` — rôle mobile et les 7 `doctor_status`.
- Créer : `src/services/videoToken.ts` — corps `{ roomId }`, lecture des 403.
- Créer : `src/services/paymentAttempt.ts` — ordre consultation et ordre prestataire.
- Modifier : `src/contexts/AuthContext.tsx` — inscription, rôle, session.
- Modifier : `src/lib/supabase.ts` — stockage sécurisé des jetons.
- Modifier : `src/services/patientApi.ts` — catalogue, rendez-vous, paiement.
- Modifier : `src/services/availabilityApi.ts` — `doctor_busy_slots`.
- Modifier : `src/services/providerApi.ts` — identité patient inchangée (le médecin lit ses patients), revenus sans montant fixe à 0.
- Modifier : `app/(auth)/register.tsx`, `app/(auth)/register-provider.tsx`, `app/(auth)/password-login.tsx`, `app/(auth)/password-login-provider.tsx`, `app/(auth)/forgot-password.tsx`, `app/(auth)/phone-login.tsx`.
- Modifier : `app/(patient)/doctors.tsx`, `app/doctor/[id].tsx`, `app/call/[room].tsx`, `app/payment.tsx`.
- Modifier : `eas.json` — URLs seulement, aucune clé.
- Tests à côté de chaque module : `*.test.ts`.

---

### Task 1: Politique de mot de passe et refus 422

**Files:**
- Create: `src/services/passwordPolicy.ts`
- Test: `src/services/passwordPolicy.test.ts`
- Modify: `app/(auth)/register.tsx`, `app/(auth)/register-provider.tsx`, `app/(auth)/forgot-password.tsx`
- Modify: `src/utils/authError.ts`

**Interfaces:**
- Produces: `passwordIssue(password: string): 'too_short' | 'too_long' | 'needs_letter_and_digit' | null`
- Produces: `pwnedPasswordMessage(error: unknown): string | null` — retourne le texte français du guide seulement si le corps ou le message contient `weak_password` ou `pwned`.

- [ ] **Step 1: Write the failing test**

```ts
expect(passwordIssue('short1')).toBe('too_short');
expect(passwordIssue('abcdefghij')).toBe('needs_letter_and_digit');
expect(passwordIssue('VisioDoc2026')).toBeNull();
expect(pwnedPasswordMessage({ error_code: 'weak_password', reasons: ['pwned'] }))
  .toBe('Ce mot de passe a déjà fuité sur Internet, choisis-en un autre.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/passwordPolicy.test.ts --watchman=false`
Expected: FAIL, module absent.

- [ ] **Step 3: Implement `passwordIssue` and `pwnedPasswordMessage`**

La regex du guide est la seule règle de forme. Ne pas exiger de symbole. Brancher le message sur l'inscription, le mot de passe oublié et le changement de mot de passe. Le bouton reste désactivé tant que `passwordIssue` n'est pas `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/passwordPolicy.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/passwordPolicy.ts src/services/passwordPolicy.test.ts src/utils/authError.ts app/(auth)/register.tsx app/(auth)/register-provider.tsx app/(auth)/forgot-password.tsx
git commit -m "fix: align mobile password rules with the shared 10-character policy"
```

---

### Task 2: Genre obligatoire à l'inscription

**Files:**
- Modify: `src/contexts/AuthContext.tsx` (`RegisterPatientInput`, `RegisterProviderInput`, `registerProvider`)
- Modify: `app/(auth)/register.tsx`, `app/(auth)/register-provider.tsx`
- Test: `src/contexts/registerPayload.test.ts` si le corps est extrait ; sinon tester une fonction `buildRegisterPrestaBody` créée dans `src/services/registration.ts`

**Interfaces:**
- Produces: `buildRegisterPrestaBody(input): { email, password, firstName, lastName, gender: 'male' | 'female', phone, serviceTypeId, proposedSpecialtyLabel, countryId, city, licenseNumber }`
- `gender` absent ou égal à `'other'` : la fonction de construction lève avant l'appel réseau.

- [ ] **Step 1: Write the failing test**

Le corps prestataire contient `gender: 'female'` et `serviceTypeId`. Il ne contient pas `specialization` ni `'other'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/registration.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Add the two-choice selector and pass `gender` to `register-presta`**

Libellés « Masculin » / « Féminin », valeurs `'male'` / `'female'`. Même sélecteur sur l'inscription patient. Un profil déjà en base avec une autre valeur affiche « Non renseigné » et oblige un nouveau choix avant enregistrement (`app/profile-edit.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/registration.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: require male or female on patient and provider registration"
```

---

### Task 3: Inscription patient par `register-patient`

**Files:**
- Create: `src/services/registration.ts`
- Modify: `src/contexts/AuthContext.tsx` (`registerPatient`)
- Modify: `app/(auth)/register.tsx`
- Modify: `app/(auth)/password-login.tsx`, `app/(auth)/password-login-provider.tsx`
- Test: `src/services/registration.test.ts`

**Interfaces:**
- Consumes: `passwordIssue` de la tâche 1, `gender` de la tâche 2.
- Produces: `registerPatientAccount(input) -> Promise<{ requiresEmailConfirmation: true }>`
- Produces: `resendEmailConfirmation(email: string, language?: string) -> Promise<void>`
- `countryId` est omis quand l'utilisateur n'a pas choisi de pays. Il n'est jamais `COUNTRIES` trié puis `[0]`.

- [ ] **Step 1: Write the failing test**

L'appel est `functions.invoke('register-patient', { body })` avec `gender`, `firstName`, `lastName`, `phone`, `language`. Pas d'appel à `auth.signUp`. Pas d'`insert` sur `users`. Une réponse 200 ne connecte pas l'utilisateur. Une erreur dont le message contient `Email not confirmed` expose le bouton de renvoi.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/registration.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Replace `registerPatient`**

`POST /functions/v1/register-patient`, en-têtes anonyme gérés par `functions.invoke`. Après 200 et `requiresEmailConfirmation: true`, écran « Vérifie ta boîte e-mail » avec l'adresse saisie et « Renvoyer l'e-mail » bloqué 60 secondes (`resend-email-confirmation`). Erreurs affichées telles quelles : 400 validation, 409 e-mail ou téléphone déjà utilisé, 429 avec `Retry-After`, 502 « Impossible d'envoyer l'e-mail de confirmation ». Sur les deux écrans de mot de passe, `email_not_confirmed` affiche « Ton adresse e-mail n'est pas encore confirmée. Clique sur le lien reçu par e-mail. » Le lien de confirmation s'ouvre dans le navigateur ; l'app demande ensuite de revenir se connecter.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/registration.test.ts src/contexts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: register patients through register-patient and wait for email confirmation"
```

---

### Task 4: Refus des rôles non mobiles

**Files:**
- Create: `src/services/accessPolicy.ts`
- Modify: `src/contexts/AuthContext.tsx` (`mapUserRow`, `signIn`, `finishOtp`)
- Test: `src/services/accessPolicy.test.ts`

**Interfaces:**
- Produces: `mobileRole(role: string | null): 'patient' | 'provider' | null`
- `patient` → patient. `provider` et `doctor`, quelle que soit la casse → provider. Tout le reste, y compris chaîne vide → `null`.

- [ ] **Step 1: Write the failing test**

```ts
expect(mobileRole('country_admin')).toBeNull();
expect(mobileRole('PROVIDER_VALIDATOR')).toBeNull();
expect(mobileRole('doctor')).toBe('provider');
expect(mobileRole('patient')).toBe('patient');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/accessPolicy.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Stop mapping unknown roles to patient**

Après `loadProfile`, si `mobileRole` est `null` : `supabase.auth.signOut({ scope: 'local' })`, alerte avec le texte exact du guide, pas de `setUser`. Supprimer le repli `role: 'patient'` de `mapUserRow` et de `minimalUser` quand le profil n'a pas un rôle mobile. Ne plus lire `roles` ni `user_roles`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/accessPolicy.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: refuse admin roles on the mobile app"
```

---

### Task 5: Les 7 statuts prestataire

**Files:**
- Modify: `src/services/accessPolicy.ts`
- Modify: `src/contexts/AuthContext.tsx` (`isProviderValidated`, `guardProvider`)
- Test: `src/services/accessPolicy.test.ts`

**Interfaces:**
- Produces: `providerGate(status: string | null, isActive: boolean | undefined): 'full' | 'subscribe' | 'pending' | 'rejected' | 'incomplete' | 'suspended'`
- `VALIDE_ABO_ACTIF` → `full`. `VALIDE_SANS_ABO` et `profil_valide` → `subscribe`. `en_attente_de_validation` et `EN_ATTENTE_VALIDATION` → `pending`. `profil_rejete` → `rejected`. `is_active === false` → `suspended`. Le reste, y compris `profil_incomplet` et une chaîne inconnue → `incomplete`.
- La comparaison ne passe pas par `toUpperCase()`.

- [ ] **Step 1: Write the failing test**

`en_attente_de_validation` ne devient pas un accès complet. `VALIDE_SANS_ABO` ne déconnecte pas : il demande l'abonnement. `profil_rejete` a son propre état.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/accessPolicy.test.ts --watchman=false`
Expected: FAIL on the lowercase status, because the current helper uppercases it and does not list it.

- [ ] **Step 3: Replace `isProviderValidated`**

`guardProvider` ne déconnecte plus tous les non-validés de la même façon. `full` entre dans l'espace prestataire. `subscribe` ouvre `app/provider/subscription.tsx`. `pending`, `rejected` et `incomplete` ouvrent un écran d'explication et n'ouvrent pas l'agenda. `suspended` déconnecte.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/accessPolicy.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: gate providers on the seven database doctor_status values"
```

---

### Task 6: Expiration de session et trousseau

**Files:**
- Modify: `src/lib/supabase.ts`
- Modify: `src/contexts/AuthContext.tsx`
- Test: `src/services/sessionExpiry.test.ts`

**Interfaces:**
- Produces: `isSessionExpiry(error: unknown): boolean`
- Vrai pour `session_expired`, `refresh_token_not_found`, `Invalid Refresh Token: Session Expired`, `JWT expired`.

- [ ] **Step 1: Write the failing test**

Chaque message ci-dessus renvoie vrai. Un mauvais mot de passe renvoie faux.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/sessionExpiry.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Store the session in SecureStore and surface expiry**

Adapter `getItem` / `setItem` / `removeItem` via `expo-secure-store` pour le client auth seulement. Sur échec de refresh : `signOut({ scope: 'local' })`, écran de connexion, texte « Ta session a expiré, reconnecte-toi. » Aucun mot de passe n'est écrit en stockage. La langue, les notifications et les brouillons de disponibilité restent dans AsyncStorage.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/sessionExpiry.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: keep auth tokens in the keychain and explain expired sessions"
```

---

### Task 7: Catalogue `public_provider_listing`

**Files:**
- Modify: `src/services/patientApi.ts` (`getDoctors`, `getDoctor`)
- Modify: `app/(patient)/doctors.tsx`, `app/doctor/[id].tsx`
- Test: `src/services/patientApi.test.ts`

**Interfaces:**
- Consumes: session présente ou non, décidée par l'appelant.
- Produces: `getDoctors()` lit `public_provider_listing` et sélectionne `id, first_name, last_name, avatar_url, specialty_labels, consultation_fee, currency_code, city, rating`.
- Produces: `shouldHideCommercialInfo(fee: number | null, signedIn: boolean): boolean` — vrai si `!signedIn` ou `fee === null`.

- [ ] **Step 1: Write the failing test**

`getDoctors` n'appelle plus `.from('users')`. `shouldHideCommercialInfo(null, true)` est vrai. `shouldHideCommercialInfo(15000, false)` est vrai. `shouldHideCommercialInfo(15000, true)` est faux.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/patientApi.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Switch the catalog and hide price plus slots for visitors**

Texte exact : « Connectez-vous pour voir le tarif et les disponibilités », bouton vers la connexion. Un visiteur ne charge pas les créneaux. Le client public anonyme reste utilisé pour la liste ; le client de session est utilisé dès qu'un utilisateur est connecté, afin que le tarif ne soit plus `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/patientApi.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: load doctors from public_provider_listing and hide fees from visitors"
```

---

### Task 8: Créneaux occupés via `doctor_busy_slots`

**Files:**
- Modify: `src/services/availabilityApi.ts` (`fetchBookedRanges`)
- Test: `src/services/availabilityApi.test.ts`

**Interfaces:**
- Produces: appel `supabase.rpc('doctor_busy_slots', { p_doctor_id, p_from, p_to })`.
- Si `p_to - p_from` dépasse 62 jours, la fonction découpe la plage en fenêtres de 62 jours avant d'appeler la RPC. Elle n'envoie jamais une seule plage plus longue.
- Sans session, elle ne appelle pas la RPC et renvoie une liste vide (le visiteur ne voit pas les créneaux, tâche 7).

- [ ] **Step 1: Write the failing test**

Une plage de 90 jours produit deux appels, chacun d'au plus 62 jours. Le nom `consultation_busy_times` n'apparaît plus.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/availabilityApi.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Replace the view read with the RPC**

Le retour `{ scheduled_at, duration }` alimente le même `BookedRange` qu'aujourd'hui. L'erreur `42501` (non connecté) est traitée comme « pas de créneaux », pas comme un crash.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/availabilityApi.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: load busy slots from doctor_busy_slots"
```

---

### Task 9: Identité prestataire côté patient

**Files:**
- Modify: `src/services/patientApi.ts` (`fetchConsultations`, `mapConsultation`)
- Test: `src/services/patientApi.test.ts`

**Interfaces:**
- La sélection consultations patient devient `doctor:provider_identity!doctor_id ( id, first_name, last_name, avatar_url, specialization )`.
- `mapConsultation` lit `specialization` sur cette vue, plus `healthcare_professionals`.
- Aucune sélection patient ne demande `email` ou `phone` d'un médecin.

- [ ] **Step 1: Write the failing test**

La chaîne passée à `.select` contient `provider_identity` et ne contient pas `doctor:users`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/patientApi.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Point patient doctor joins at `provider_identity`**

Le médecin, lui, continue de lire ses patients dans `users` (ce sont ses patients, pas un catalogue public). Ne pas changer `providerApi` sur ce point dans cette tâche.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/patientApi.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: show doctors to patients through provider_identity"
```

---

### Task 10: Verrou de paiement des consultations

**Files:**
- Create: `src/services/paymentAttempt.ts`
- Modify: `src/services/patientApi.ts` (`bookConsultation`)
- Modify: `app/payment.tsx`
- Test: `src/services/paymentAttempt.test.ts`, `src/services/patientApi.test.ts`

**Interfaces:**
- Produces: `registerConsultationPayment(consultationId: string, txnRef: string, useWallet = false)`
- Produces: `confirmConsultationPayment(consultationId: string, txnRef: string, payRef: string, useWallet = false)`
- `bookConsultation` insère `status: 'pending_payment'` et `payment_status: 'pending'`. Il n'appelle plus `payment-initiate-v2`. Il ne met pas à jour le statut après le widget.
- `registerConsultationPayment` : un échec réseau, 429 ou 503 ne lance pas d'exception bloquante. `NOT_PAYABLE` et `TXN_ALREADY_USED` lancent une exception et le widget ne s'ouvre pas.
- Le montant inséré est celui affiché par `public_provider_listing` pour l'utilisateur connecté. Le client ne recalcule pas un tarif.

- [ ] **Step 1: Write the failing test**

L'insert contient `pending_payment`. `invoke` n'est pas appelé avec `payment-initiate-v2`. Il est appelé avec `register-payment-attempt` puis, au retour, `confirm-consultation-payment` et les champs `consultationId`, `txnRef`, `payRef`, `useWallet`. Une erreur `23P01` garde le message déjà utilisé pour le chevauchement. Une erreur dont le message contient `payment_fields_locked` ou `insert_amount_out_of_range` n'est pas ré-essayée par un `update`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/patientApi.test.ts src/services/paymentAttempt.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Replace the booking payment sequence**

Ordre : insert → générer `txnRef` → `register-payment-attempt` → ouvrir le widget → au retour succès, `confirm-consultation-payment`. Réactiver la WebView de `app/payment.tsx` seulement pour poster ce widget. Au retour, l'écran rendez-vous relit la consultation : `scheduled` + `paid` viennent de la base, pas d'un état local.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/patientApi.test.ts src/services/paymentAttempt.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: book consultations through the enforced payment lock"
```

---

### Task 11: Référence de paiement prestataire avant le widget

**Files:**
- Modify: `src/services/paymentAttempt.ts`
- Test: `src/services/paymentAttempt.test.ts`
- Modify: `app/provider/subscription.tsx` seulement si un widget y est branché dans la même tâche. Aujourd'hui le bouton fait `router.back()` : ne pas inventer un paiement.

**Interfaces:**
- Produces: `registerProviderPaymentAttempt(body: { kind: 'subscription', subscriptionId: string, txnRef: string } | { kind: 'wallet_recharge', quantity: 5 | 10 | 20 | 50 | 100, currency: string, txnRef: string })`
- Le corps ne contient pas de montant.
- Réponses qui laissent continuer : succès, `alreadyPaid`, erreur réseau, 429, 503.
- Réponses qui arrêtent : `409 NOT_PAYABLE`, `404 NOT_FOUND`. `409 TXN_ALREADY_USED` demande une nouvelle `txnRef` et un seul nouvel essai.
- Après le widget : `confirm-subscription-payment` ou `confirm-wallet-recharge` avec la même `txnRef`.
- Si `APP_ENV === 'development'` et qu'un drapeau de simulation locale est actif, la fonction n'est pas appelée.

- [ ] **Step 1: Write the failing test**

Un corps `subscription` et un corps `wallet_recharge` n'ont pas de champ `amount`. Un 503 ne rejette pas. Un 404 rejette.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/paymentAttempt.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Add the function and keep the subscription screen from opening a widget**

Le bouton « S'abonner maintenant » ne déclenche pas de paiement tant que la ligne `provider_subscriptions` en `pending_payment` et le widget ne sont pas branchés ensemble, dans cet ordre : `txnRef`, `register-provider-payment-attempt`, widget, `confirm-subscription-payment`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/paymentAttempt.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: register provider payment references before the widget"
```

---

### Task 12: Contrat visio `get-video-token`

**Files:**
- Create: `src/services/videoToken.ts`
- Modify: `app/call/[room].tsx`
- Test: `src/services/videoToken.test.ts`
- Modify: `eas.json` — retirer `EXPO_PUBLIC_JITSI_DOMAIN`

**Interfaces:**
- Produces: `videoRoomId(consultation: { id: string, video_room_id?: string | null }): string` — `video_room_id` sinon `id`.
- Produces: `videoJoinBody(roomId: string): { roomId: string }` — aucun `userName`, `userEmail`, `userPhone`, `userId`, `role`.
- Produces: `videoFailure(status: number, body: { code?: string, opensAt?: string | null, error?: string }): { kind: 'too_early' | 'closed' | 'cancelled' | 'denied' | 'unauthenticated', message: string, opensAt: string | null }`
- `room_not_open_yet` → « La consultation n'est pas encore ouverte (la salle ouvre à HH:MM) » avec `opensAt`.
- `room_closed` → « La salle de cette consultation est fermée ».
- `consultation_cancelled` → « Cette consultation est annulée ou manquée ».
- 401 → retour à la connexion via la tâche 6.

- [ ] **Step 1: Write the failing test**

Les trois codes 403 donnent les trois messages. Le corps d'appel est exactement `{ roomId }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/videoToken.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Call `get-video-token` and open the returned room**

L'écran d'appel remplace la maquette. Il appelle `functions.invoke('get-video-token', { body: videoJoinBody(roomId) })` avec la session. Succès : ouvrir `${data.serverUrl}/${data.roomName}?jwt=${data.jwt}` dans une WebView (`react-native-webview`), permissions caméra et micro. C'est le même contrat que l'iframe web. Le SDK `@jitsi/react-native-sdk` n'est pas installé dans cette tâche : le guide le conditionne à un POC séparé, et le repli WebView est le chemin qui respecte déjà la règle « un seul contrat ». `recording` n'est pas activé par l'URL. À la fermeture, retour à la fiche consultation.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/videoToken.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: join video rooms with get-video-token instead of public Jitsi"
```

---

### Task 13: Téléphone, WhatsApp et `set-login-credentials`

**Files:**
- Modify: `app/(auth)/phone-login.tsx`
- Modify: `src/services/registration.ts`
- Test: `src/services/registration.test.ts`

**Interfaces:**
- Produces: `setLoginCredentials(email: string, newPassword: string, confirmPassword: string)`
- Le corps utilise `newPassword` et `confirmPassword`, pas `password`.
- Le bouton « Renvoyer le code » reste inactif 60 secondes.
- Le texte affiché après l'envoi du numéro : « Votre code de confirmation vous a été envoyé par WhatsApp ».

- [ ] **Step 1: Write the failing test**

`functions.invoke('set-login-credentials', { body })` reçoit les trois noms de champs du guide. `newPassword !== confirmPassword` n'appelle pas la fonction.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/registration.test.ts --watchman=false`
Expected: FAIL

- [ ] **Step 3: Add the credential step after the OTP**

Après validation du code, l'écran demande e-mail, mot de passe et confirmation, puis appelle la fonction avec la session. Le compte doit ensuite pouvoir se connecter par e-mail.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/registration.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: attach email credentials after WhatsApp phone signup"
```

---

### Task 14: Environnements UAT et Production

**Files:**
- Modify: `eas.json`
- Modify: tout écran qui proposerait un sélecteur d'environnement (aucun trouvé aujourd'hui : ne pas en ajouter)

**Interfaces:**
- `development` et `preview` : `APP_ENV` `development` / `uat`, `EXPO_PUBLIC_SUPABASE_URL` = `https://pslypdfjmjetjhtpzwip.supabase.co`.
- `production` : `APP_ENV` `production`, URL `https://cftqxuxhsellvquidpxr.supabase.co`.
- Aucune clé anon dans le fichier. Les clés sont des secrets EAS, lues via `EXPO_PUBLIC_SUPABASE_ANON_KEY` déjà consommé par `src/lib/supabase.ts`.
- Un changement d'URL d'environnement dans un build non production appelle `signOut({ scope: 'local' })` avant de recréer le client.

- [ ] **Step 1: Write the failing test**

Un test lit `eas.json` et échoue si le fichier contient `eyJ`, `service_role`, ou si `development` / `preview` contiennent `cftqxuxhsellvquidpxr`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/config/easEnv.test.ts --watchman=false`
Expected: FAIL, because the current file points every profile at Production and embeds an anon key.

- [ ] **Step 3: Split the URLs and remove committed keys**

Ne pas commiter la valeur des clés. Documenter dans le message de commit que les secrets EAS doivent être posés avant le prochain build. Aucun test manuel sur le projet Production.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/config/easEnv.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: point test builds at UAT and remove committed Supabase keys"
```

---

### Task 15: Fonctions métier à aligner après les flux bloquants

Cette tâche ne change pas le parcours d'inscription ni le paiement. Elle aligne les lectures qui existent déjà sous une autre forme.

**Files:**
- Modify: `src/services/providerApi.ts` et `src/services/dashboardMetrics.ts` pour les revenus.
- Modify: les écrans ordonnance (`app/records.tsx`, `app/patient/record-form.tsx`) seulement pour lire `prescriptions` / `prescription_items` quand une ordonnance signée existe. Ne pas réécrire le dossier médical libre dans cette tâche.
- Test: `src/services/dashboardMetrics.test.ts`

**Interfaces:**
- Revenus en cours : `consultations` où `doctor_id = user.id`, `status in ('completed', 'no_show')`, `payment_status = 'paid'`. Périodes payées : `provider_payouts` où `status = 'paid'`.
- Ordonnance : statuts `draft`, `signed`, `issued`, `partially_dispensed`, `dispensed`, `cancelled`, `expired`. QR : `https://visiodoc.cd/?verify_rx=<qr_token_hash>`. Vérification publique : RPC `verify_prescription` ou `get_prescription_for_pharmacy`. Ces RPC ne sont pas appelées avec un identifiant patient.
- Consentement : ne pas créer de ligne `medical_record_consent` à la réservation. Le trigger `grant_medical_record_consent_on_booking_trg` le fait. L'accès dossier passe par `has_medical_record_consent`.
- No-show : ne pas créditer le portefeuille dans le client. Le trigger `trg_consultation_noshow_wallet_credit` crédite 60 %. L'écran portefeuille lit `patient_wallets` et `patient_wallet_transactions`.
- Spécialité : écrire dans `specialty_change_requests` (`pending` / `approved` / `rejected`), pas un update direct de la spécialité du médecin.

- [ ] **Step 1: Write the failing test**

`dashboardMetrics` n'utilise plus un taux local pour afficher 0 quand des consultations `completed` ou `no_show` sont `paid`. Le test fournit deux lignes payées et attend leur somme.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/services/dashboardMetrics.test.ts --watchman=false`
Expected: FAIL if the current helper still applies a client-side fee or ignores `no_show`.

- [ ] **Step 3: Read earnings, prescriptions, wallet, and specialty requests from the server tables**

Le client affiche. Il ne décide pas du crédit no-show, du consentement, ni du pourcentage de frais : ces colonnes (`fee_percent_at_booking` et voisines) sont lues, jamais écrites.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/services/dashboardMetrics.test.ts src/services/providerApi.test.ts --watchman=false`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: read earnings, prescriptions, and wallets from the server contracts"
```

---

## Hors de ce plan

- POC natif `@jitsi/react-native-sdk` 13.3.0 (7 points du guide). Il ne part qu'après la tâche 12, sur un development build UAT, parce que Expo Go ne charge pas ce SDK. Si le POC échoue, la WebView de la tâche 12 reste le client.
- Comptes de test UAT : ils ne sont pas dans le dépôt. Les scénarios du guide (patient, `VALIDE_ABO_ACTIF`, `en_attente_de_validation`, `profil_rejete`, `VALIDE_SANS_ABO`, admin pays) se jouent sur UAT seulement.
- Le guide marque aussi MOB-0712-1 « à intégrer côté web ». Ce plan ne modifie pas le dépôt web. Le mobile suit le contrat du 08/11/2026, pas l'ancien comportement web s'il n'a pas encore enregistré la référence avant le widget.

## Self-review

- Couverture : étapes 1 à 11 et MOB-0411-1, MOB-0411-2, MOB-0611-1, MOB-0611-2, MOB-0611-3, MOB-0612-1, MOB-0612-2, MOB-0612-3, MOB-0712-1 ont une tâche.
- Les cinq cas du Review Focus sont couverts par les tâches 10, 3, 9, 4 et 6.
- `registerPatientAccount`, `mobileRole`, `providerGate`, `registerConsultationPayment` et `videoJoinBody` gardent le même nom d'une tâche à l'autre.
- Le SDK Jitsi natif est volontairement hors des tâches exécutables : le guide en fait un POC conditionnel, pas un prérequis du contrat.
