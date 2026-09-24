# Schéma Supabase réel — projet `lgcvcxicywyguqjrxvma` ("visiodoc")

Nouveau projet Supabase (2026-09-23), reconstruit à partir des migrations et
Edge Functions versionnées dans `../supabase/` (65 migrations + 25 Edge
Functions, rejouées avec `supabase db push` / `supabase functions deploy`).
Remplace l'ancien projet `cftqxuxhsellvquidpxr`, lui-même remplacé une
première fois par `nbepralqoohlwcuwjxoe` (projet vide, schéma incompatible —
abandonné). `.env` pointe sur `lgcvcxicywyguqjrxvma`.

## ⚠️ Écarts trouvés entre les migrations versionnées et la prod réelle

Le dépôt `supabase/migrations` ne capture pas fidèlement l'historique complet
de l'ancien projet — plusieurs changements ont visiblement été faits à la main
dans le Studio sans migration correspondante. Rejouer les migrations sur un
projet vide a fait échouer ces trous ; ils ont été corrigés par 4 migrations
ajoutées dans cette session (numérotées `2026032222xxx`) :

1. **Table `ai_call_usage_logs` manquante** — référencée par 3 migrations et
   par les Edge Functions `apimedic-symptom-checker`/`isabel-symptom-checker`,
   mais jamais créée par aucune migration. Reconstruite à partir des colonnes
   effectivement utilisées (`20260218000000_create_ai_call_usage_logs.sql`).
2. **`countries.id` désaligné avec le mobile** — le seed EPIC1 génère un UUID
   aléatoire pour CD et ne seed pas NE (Niger), alors que
   `visiodoc-app/src/config/countries.ts` insère `users.country_id` avec des
   UUID **fixes** codés en dur côté client. Réaligné + NE ajouté
   (`20260322222532_align_countries_with_mobile_app.sql`).
3. **Récursion RLS infinie sur `users`** — la policy SELECT
   "Patients can view active providers" (ajoutée par
   `20260322215504_fix_rls_provider_role_patient_view.sql`) fait une
   sous-requête brute sur `users` dans son propre `USING`, au lieu de passer
   par une fonction `SECURITY DEFINER` comme les autres policies
   (`is_admin()`, `is_doctor_patient()`) → boucle infinie sur tout SELECT.
   Supprimée : elle faisait doublon avec "Public can view active provider
   profiles", qui couvre déjà le même accès plus largement
   (`20260322222533_fix_users_select_recursion.sql`).
4. **INSERT self-registration manquant sur `users`** —
   `20251005172519_fix_rls_recursion_with_function.sql` (oct. 2025) a
   supprimé la policy d'auto-inscription en reconstruisant tout autour de
   `is_admin()`, et aucune migration ultérieure ne l'a recréée. Pourtant le
   comportement de prod vérifié en direct (voir plus bas) montrait bien un
   insert de sa propre ligne fonctionnel → policy restaurée
   (`20260322222534_restore_users_self_insert_policy.sql`).
5. **Edge Function `register-presta` désynchronisée** — la source versionnée
   n'utilisait ni `phone` ni `countryId` du body, alors que
   `AuthContext.registerProvider` (mobile) les envoie et que
   `users.country_id`/`phone` sont requis (`chk_country_required`). Corrigée
   dans `../supabase/functions/register-presta/index.ts` puis redéployée.
6. **Confirmation email activée par défaut** — un projet Supabase neuf a
   "Confirm email" actif, ce qui casse `AuthContext.registerPatient` (attend
   une session immédiate après `signUp`, sans étape de confirmation). Désactivé
   dans Authentication → Sign In / Providers.

Tout le reste (65 migrations, 25 Edge Functions) a été rejoué **sans
modification** et correspond à l'historique réel du projet web.

## ✅ Vérifié en direct sur le nouveau projet (smoke tests, 2026-09-23)

- Inscription patient complète : `auth.signUp` → session immédiate → insert
  `public.users` (RLS self-insert) → lecture du profil avec embed
  `countries(code, currency_code, locale)` → update de son propre profil.
- Catalogue médecins en anon (`role=eq.provider&is_active=eq.true`) : lisible,
  aucune erreur RLS (table vide pour l'instant, pas de médecin actif seedé).
- Edge Function `register-presta` : crée le compte (email confirmé,
  `is_active=false`, `doctor_status=EN_ATTENTE_VALIDATION`), en attente de
  validation admin — conforme au flux documenté.

## Structure (inchangée par rapport à l'ancien projet)

### `users`
`id` · `email` · `first_name` · `last_name` · `phone` · `role` (`patient` /
`provider` / `admin` / `super_admin` / `country_admin` / `provider_validator`)
· `is_active` · `avatar_url` · `bio` · `specialization` (text[]) ·
`license_number` · `date_of_birth` · `gender` · `address` ·
`emergency_contact_name` · `emergency_contact_phone` · `blood_type` ·
`allergies` · `years_of_experience` · `consultation_fee` · `doctor_status` ·
`preferred_currency` (défaut `'USD'` dans le schéma — **valeur de donnée**
`CDF` était peut-être un défaut ajusté à la main sur l'ancien prod, non
reproduit ici faute de confirmation) · `public_id` · `country_id` (FK →
`countries`) · `created_at` · `updated_at`.

### `healthcare_professionals` (1:1 avec `users` via `user_id`)
`specialization` (text[]) · `city` · `consultation_fee` · `rating` ·
`average_rating` · `review_count` · `total_consultations` ·
`years_of_experience` · `availability_status` · `license_number` · `bio` ·
`qualifications` · `languages` · `service_type_id`.

### `countries`
`id` · `code` · `name` · `currency_code` · `currency_iso` · `locale` ·
`is_active` · `created_at`.

| code | name | currency_code | locale | is_active |
|---|---|---|---|---|
| **CD** | République Démocratique du Congo | **CDF** | fr-CD | true |
| NE | Niger | XOF | fr-NE | true |
| CG / TD / SN / CM | (seed EPIC1, inactifs) | XAF | — | false |

`CD.id` = `5845fc2a-0579-4604-a4cd-adcc1dabab6c`,
`NE.id` = `602311ca-5958-4877-af57-65c44d7a3031` — doivent rester synchro avec
`visiodoc-app/src/config/countries.ts`.

### `consultations` / `medical_records` / `doctor_availability` / `payment_fee_config`
Colonnes conformes à l'usage dans `patientApi.ts` / `providerApi.ts` (déjà
vérifiées par la lecture directe des migrations, pas seulement présumées
comme sur l'ancien doc) : `patient_id`, `doctor_id` (FK vers `users`, noms de
contrainte `consultations_patient_id_fkey` / `consultations_doctor_id_fkey` —
utilisés tels quels dans les embeds `users!consultations_doctor_id_fkey`),
`scheduled_at`, `consultation_type`, `duration`, `payment_amount`, `status`,
`payment_status`, `video_room_id`, `started_at`.

## ⚠️ Bug live confirmé : RLS de `doctor_availability` bloque tous les prestataires

Trouvé en testant l'écran `app/provider/availability.tsx` sur l'app réelle (message
"Enregistré sur cet appareil ...") — les policies SELECT/INSERT de `doctor_availability`
(`20251212165243_fix_rls_performance_and_security.sql`) vérifient encore
`users.role = 'doctor'`, une valeur d'avant le renommage EPIC1
(`20260321094717_..._epic1_rename_doctor_to_provider.sql`, qui a fait
`UPDATE users SET role = 'provider' WHERE role = 'doctor'` sans recréer les policies qui
en dépendaient). Le rôle réel d'un prestataire est `'provider'` (confirmé ci-dessus) : la
condition `role = 'doctor'` n'est donc plus jamais vraie, toute lecture/écriture provider
échoue silencieusement la RLS. Corrigé pour `doctor_availability` par
`20260924000003_fix_doctor_availability_role_check.sql` (branche
`feat/scheduling-availability`).

**Le même pattern existe ailleurs et n'a PAS été corrigé** (hors périmètre de cette
branche — repéré par `grep -rn "role = 'doctor'" supabase/migrations/` après le
renommage) : `medical_records`, `patients`, `ai_questionnaire_sessions`,
`healthcare_professionals` ont des policies écrites contre l'ancienne valeur `'doctor'`.
`consultations` et `provider_scheduling_settings` (nouvelle table de cette branche) n'en
sont PAS affectés — leurs policies filtrent uniquement sur la propriété
(`doctor_id`/`patient_id`/`provider_id` = `auth.uid()`), pas sur le rôle.

## Correction : projet live réel

Le projet mentionné plus haut (`lgcvcxicywyguqjrxvma`) est la source de vérité au
2026-09-24. Les migrations `20260924000000` à `20260924000003` (branche
`feat/scheduling-availability`) référençaient encore `cftqxuxhsellvquidpxr` dans leurs
commentaires d'avertissement — corrigé.

## Edge Functions déployées (25)
Toutes les fonctions de `../supabase/functions/` sont déployées sur
`lgcvcxicywyguqjrxvma`. Celles utilisées par le mobile :
- `register-presta` — inscription prestataire (corrigée, voir ci-dessus).
- `payment-initiate` — réservation/paiement (non testée en profondeur ;
  dépend probablement de secrets de gateway de paiement non configurés).

Les fonctions liées aux paiements (`payment-*`, `webhook-*`) et à l'IA
(`*-symptom-checker`, `ai-*`) nécessitent des secrets externes (clés API
gateway de paiement, fournisseurs IA) qui n'ont pas été configurés dans cette
session — à faire via `supabase secrets set` si ces fonctionnalités sont
utilisées.
