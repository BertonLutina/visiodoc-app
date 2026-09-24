# Prompts Codex — VisioDoc Mobile (par lot)

Si tu manques de crédits ici, copie-colle ces prompts dans **Codex** (ou un autre assistant code)
pour continuer. Chaque lot est autonome. Donne à Codex l'accès au dossier `visiodoc-app`.

**Contexte commun à coller en tête de chaque prompt :**

> Projet : `visiodoc-app`. App mobile **Expo (SDK 51) + Expo Router v3 + TypeScript + NativeWind v4**.
> Backend = **Supabase** (mêmes Edge Functions que l'app web VisioDoc : auth, paiement Interswitch/PawaPay,
> IA symptômes `ai-symptom-analysis`, etc.). Visio = **Jitsi** (`@jitsi/react-native-sdk`).
> Thème : vert médical teal (`primary #0D9488`), libellés en français, monnaie « F CFA », cible Afrique.
> Alias d'import `@/*` → `src/*`. Composants UI partagés dans `src/components/ui.tsx` (Button, Card, Avatar,
> Badge, Field, SectionTitle, Stars) et `src/components/DoctorCard.tsx`. Types dans `src/types/index.ts`.
> Respecte le style des écrans déjà présents dans `app/`.

---

## Lot A — Fondations (déjà fait ✅)

Config Expo, NativeWind, client Supabase (`src/lib/supabase.ts`), thème, types, composants partagés,
contexte d'auth mock (`src/contexts/AuthContext.tsx`). Rien à refaire — sert de référence de style.

---

## Lot B — Frontend Patient (déjà fait ✅)

11 écrans dans `app/` : `index` (accueil), `(auth)/register`, `(auth)/login`, `(patient)/index` (dashboard),
`(patient)/doctors`, `(patient)/appointments`, `(patient)/wallet`, `(patient)/profile`,
`doctor/[id]` (réservation), `records` (dossier médical), `call/[room]` (visio + IA).

---

## Lot C — Lien backend Patient (Phase 2)

> Branche les écrans patient existants sur Supabase. Crée `src/services/patientApi.ts` exposant :
> `getDoctors(filter)`, `getDoctor(id)`, `getConsultations(status)`, `bookConsultation(input)`,
> `getWallet()`, `getMedicalRecords()`. Implémente-les avec le client `supabase` de `src/lib/supabase.ts`
> en t'inspirant des requêtes de l'app web (`src/lib/*Queries.ts` : `providerQueries`, `consultationQueries`,
> `walletQueries`, `patientQueries`).
> Remplace l'auth mock de `src/contexts/AuthContext.tsx` par `supabase.auth.signInWithPassword`,
> l'inscription via l'Edge Function `create-user`, et `supabase.auth.signOut`. Persiste la session avec
> `expo-secure-store`/AsyncStorage (déjà configuré). Ajoute un magic link via `magic-link-request`.
> Remplace les imports de `@/data/mock` dans les écrans par des appels à `patientApi`, avec états
> chargement/erreur. Branche le paiement de réservation sur `payment-initiate`. Ne change pas le design.

---

## Lot D — Frontend Médecin (Phase 3)

> Crée l'espace médecin : groupe de routes `app/(provider)/` avec bottom-tabs
> (Accueil, Patients, Consult., Dossiers, Profil) sur le modèle de `app/(patient)/_layout.tsx`.
> 10 écrans, en réutilisant `src/components/ui.tsx` et le thème :
> 1. Inscription médecin (`(auth)/register-provider`) — prénom, nom, email pro, téléphone, spécialisation,
>    N° licence, mot de passe ; bandeau « Validation par l'administrateur requise ».
> 2. Connexion médecin (`(auth)/login-provider`) — + statut « Compte en cours de validation ».
> 3. Dashboard médecin — stats (Patients total, Consult./mois, Revenu net, Note moyenne),
>    consultations du jour, avis récents.
> 4. Mes patients — liste (nom, âge, sexe, motif) + bouton Voir.
> 5. Mes consultations — onglets À venir / En cours / Passées, boutons Démarrer / Notes.
> 6. Dossiers médicaux — liste patients + dernier acte, bouton Modifier.
> 7. Disponibilités & agenda — créneaux hebdo, exceptions/congés.
> 8. Tarif consultation — tarif actuel, décomposition frais plateforme (4 %), revenu net, modifier.
> 9. Abonnement — plans Mensuel / Annuel, fonctionnalités, S'abonner.
> 10. Profil médecin — infos pro, spécialisations, tarif, dispos, abonnement, analyse IA, déconnexion.
> Données mock dans `src/data/mockProvider.ts`, structurées comme `src/data/mock.ts`.

---

## Lot E — Lien backend Médecin (Phase 4)

> Crée `src/services/providerApi.ts` : `getProviderDashboard()`, `getPatients()`, `getProviderConsultations()`,
> `startConsultation(id)`, `getAvailabilities()`, `setAvailabilities(input)`, `getFee()/setFee(amount)`,
> `getSubscription()/subscribe(plan)`. Implémente via `supabase` (réf. app web : `availabilityQueries`,
> `feeQueries`, `subscriptionQueries`, `consultationQueries`, `reviewQueries`).
> Inscription médecin via Edge Function `register-presta` (statut PENDING_VALIDATION), connexion via
> `auth-provider-login`. Démarrage de consultation → ouvre `call/[room]` avec Jitsi. Abonnement →
> `payment-initiate`. Branche les écrans du Lot D sur ce service, états chargement/erreur, design inchangé.

---

## Lot F — Visio Jitsi réelle (transverse)

> Dans `app/call/[room].tsx`, remplace le placeholder vidéo par `<JitsiMeeting>` de `@jitsi/react-native-sdk` :
> domaine `EXPO_PUBLIC_JITSI_DOMAIN`, room = param `room`, displayName = utilisateur courant, audio/vidéo on.
> Gère permissions caméra/micro (déjà déclarées dans `app.json`). Garde le panneau IA branché sur
> l'Edge Function `ai-symptom-analysis`. Nécessite un dev build (le SDK Jitsi a du code natif —
> `npx expo prebuild` puis build EAS ou local).
