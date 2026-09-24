# Schéma Supabase réel — projet `cftqxuxhsellvquidpxr` ("bolt-native-database-68425593")

## ⚠️ Correction majeure (2026-09-24)

Le vrai projet de production est **`cftqxuxhsellvquidpxr`**, sous l'organisation
Supabase **"Visiodoc project"** (Pro Plan, org id `wkvhqrfdalotscciqrpm`) — pas
sous "Creative African Designers" où j'avais travaillé jusque-là. Il est vivant,
en bonne santé, avec de vraies données (17 patients, 15 prestataires, 3
country_admin, 2 provider_validator, 1 super_admin au 2026-09-24) et une
activité normale (~500 requêtes/24h). `.env` pointe maintenant dessus.

**Le dossier local `../supabase/` (migrations + functions) n'est PAS la source
de vérité.** C'est un ancien fork/snapshot qui a divergé de la vraie prod :
- La vraie prod a **43 Edge Functions** déployées ; le dossier local n'en liste
  que 25 (18 manquantes : `admin-reset-user-password`, `ai-symptom-checker`,
  `ai-symptom-fct`, `auth-send-sms-hook`, `confirm-phone-merge`,
  `get-jitsi-token`, `get-video-token`, `merge-phone-account`,
  `payment-config-manager`, `payment-encrypt-decrypt`,
  `payment-resolve-config`, `presta-submit-documents`,
  `send-consultation-reminders`, `send-sms`, `send-welcome-email`,
  `setup-superadmin`, `specialty-change-notify`, `specialty-notification`).
- `is_admin()` en vraie prod vérifie
  `role IN ('country_admin_global','super_admin','country_admin','provider_validator'`
  + variantes MAJUSCULES) — **pas** `'admin'` littéral, contrairement à ce que
  montre `20251005172519_fix_rls_recursion_with_function.sql`. Patché à la
  main sur la vraie prod, jamais committé.
- `users` a une policy INSERT self-registration déjà présente
  ("Users can insert own profile during registration") — le dossier local la
  montrait manquante (à tort, seulement vrai pour un projet rejoué depuis les
  migrations).
- `doctor_status` a un vocabulaire bien plus riche en vraie prod :
  `EN_ATTENTE_VALIDATION`, `VALIDE_SANS_ABO`, `VALIDE_ABO_ACTIF`,
  `profil_incomplet`, `en_attente_de_validation`, `profil_valide`,
  `profil_rejete` — deux nomenclatures (ancienne MAJUSCULE, nouvelle
  snake_case) coexistent.

**Ne pas rejouer les migrations locales ni redéployer les functions locales
sur `cftqxuxhsellvquidpxr` sans vérifier d'abord l'état réel** (SQL Editor /
dashboard) — le risque d'écraser une évolution organique non versionnée est
réel. Deux projets orphelins existent sous "Creative African Designers"
(`lgcvcxicywyguqjrxvma`, `nbepralqoohlwcuwjxoe`) issus d'une tentative de
reconstruction depuis le dossier local avant la découverte du vrai projet —
ce sont des clones de test vides, pas la prod, à garder ou supprimer selon le
choix de l'utilisateur.

## 🔴 Bug confirmé en vraie prod : incohérence RLS sur la validation prestataire

Point de départ : l'utilisateur avait signalé que sur l'ancien projet,
`register-presta` mettait `is_active: true` immédiatement, sans gate. Confirmé
en lisant le code déployé réel de `register-presta` :
```
doctor_status: 'profil_incomplet',
is_active: true,
```
Donc oui, `is_active` est vrai dès l'inscription — ce n'est pas lui qui gate
l'accès. Le vrai gate est censé être `doctor_status`, via la policy RLS
**"Public can view active provider profiles"** (rôle anon) :
`is_active = true AND doctor_status IN ('VALIDE_ABO_ACTIF','VALIDE_SANS_ABO')`.

Mais il existe une **deuxième** policy SELECT sur `users`, **"Patients can
view active providers"** (rôle authenticated, condition JWT
`app_metadata.role IN ('patient','PATIENT')`), qui ne vérifie que
`is_active = true` — **sans condition sur `doctor_status`**. Les policies RLS
étant OR-ées, un patient connecté voit donc n'importe quel prestataire actif,
**y compris `profil_incomplet`, jamais validé**.

**Pas exploité par l'app mobile actuelle** : `getDoctors()` et `getDoctor()`
dans [src/services/patientApi.ts](src/services/patientApi.ts:43) utilisent
délibérément `supabasePublic` (client anon, pas la session du patient connecté)
pour justement retomber sur la policy anon plus stricte — un commentaire dans
le code l'explique explicitement. Donc le catalogue mobile est protégé
aujourd'hui. Mais la policy "Patients can view active providers" reste une
faille latente en base : toute requête directe authentifiée-patient sur
`users` (autre client, évolution future du code, admin backoffice mal
configuré) contournerait le gate de validation. À corriger idéalement en
alignant cette policy sur la même condition `doctor_status`, mais c'est un
changement RLS sur la vraie prod — à faire seulement avec confirmation
explicite de l'utilisateur.

Le backoffice admin (`src/components/nexus/pages/NexusProvidersPage.tsx` dans
ce même repo, à la racine) semble être une version différente/plus ancienne
que ce qui tourne réellement en prod (vu le vocabulaire `doctor_status` plus
riche en prod que ce que ce fichier référence) — je n'ai pas pu vérifier son
code réellement déployé (pas dans ce repo).

## Vérifié en direct sur la vraie prod (2026-09-24)
- Connectivité anon confirmée avec la vraie clé (`EXPO_PUBLIC_SUPABASE_ANON_KEY`
  legacy JWT, récupérée manuellement par l'utilisateur — les clés `sb_publishable_*`
  affichées dans Settings → API Keys sont rejetées par la gateway avec
  `UNAUTHORIZED_INVALID_API_KEY`, ce projet n'a apparemment pas encore migré
  vers le nouveau système de clés au niveau data-plane malgré leur présence
  dans le dashboard).
- `countries` : CD = `5845fc2a-0579-4604-a4cd-adcc1dabab6c`, NE =
  `602311ca-5958-4877-af57-65c44d7a3031` — identiques à ce qui est codé en dur
  dans `src/config/countries.ts`. Pas de bug ici en vraie prod.
- `ai_call_usage_logs` existe bel et bien en vraie prod.

## Structure de `users` (inchangée dans ses grandes lignes)
`id` · `email` · `first_name` · `last_name` · `phone` · `role` · `is_active` ·
`doctor_status` (vocabulaire étendu, voir plus haut) · `specialization` ·
`license_number` · `country_id` (FK → `countries`) · `preferred_currency` ·
`public_id` · etc. Voir aussi `provider_specialties` et
`provider_onboarding_audit_logs`, deux tables utilisées par `register-presta`
et absentes du dossier de migrations local — schéma non audité en détail,
seulement leur usage par cette fonction.
