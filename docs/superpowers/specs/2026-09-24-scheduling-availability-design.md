# Disponibilités & réservation façon Calendly — Design

Date : 2026-09-24
App : `visiodoc-app` (Expo / Expo Router / Supabase)

## Objectif

Remplacer le système actuel (créneaux hebdomadaires uniques, sans protection de double
réservation) par un moteur de disponibilité complet : horaires hebdomadaires récurrents,
plusieurs plages par jour, exceptions/dates spécifiques, réglages de réservation par
prestataire, génération de créneaux, et réservation sans risque de double booking.

Réutilise au maximum l'existant : table `doctor_availability` (colonnes `recurrence_type`,
`specific_date`, `is_exception` déjà présentes mais jamais utilisées), table `consultations`
comme source de vérité des rendez-vous, `AuthContext`, le kit UI (`src/components/ui.tsx`,
`colors`), et le pattern d'accès direct Supabase (pas de nouvelle API REST).

**⚠️ Migrations en attente de confirmation du schéma live** (`cftqxuxhsellvquidpxr`, voir
`SUPABASE.md`) — écrites ici contre les migrations locales, à ajuster une fois le schéma réel
collé dans la conversation.

## Décisions

| Sujet | Décision |
|---|---|
| Table des horaires + exceptions | Réutiliser `doctor_availability` (pas de nouvelle table) |
| Réglages de réservation | Nouvelle table `provider_scheduling_settings` (1 ligne/prestataire) |
| Sécurité anti double-réservation | Contrainte Postgres `EXCLUDE` (gist) sur `consultations` |
| Un seul rendez-vous par jour | Un patient ne peut pas prendre 2 rendez-vous le même jour avec le **même** prestataire (index unique partiel) ; plusieurs prestataires différents le même jour restent autorisés |
| Fuseau horaire | Un seul fuseau app (`Africa/Kinshasa`, UTC+1, pas de DST) — pas de conversion IANA pour l'instant |
| Lecture disponibilité (mois/jour) | Requêtes Supabase directes dans un nouveau service, pas de nouvelle edge function |
| Calendrier mensuel | Grille faite maison (pas de `react-native-calendars`) |
| Réglages provider | Écran dédié dès maintenant (durée, intervalle, tampons, préavis, horizon) |
| Bugs pré-existants (`status`/`consultation_type` CHECK vs valeurs app) | Hors périmètre — non touchés par cette fonctionnalité |
| Tests | Ajout de `jest` + `jest-expo` (aucun framework de test n'existe aujourd'hui) ; tests unitaires du moteur de créneaux uniquement pour cette itération |

## Modèle de données

### `doctor_availability` (existante, étendue en usage, pas en colonnes)
Chaque ligne = une plage horaire. Une journée peut avoir plusieurs lignes (pauses).

- Règle hebdomadaire : `recurrence_type='weekly'`, `day_of_week` (0=lundi), `start_time`,
  `end_time`, `is_available=true`.
- Jour hebdo désactivé : soit aucune ligne pour ce `day_of_week`, soit une ligne
  `is_available=false` sans horaires (les deux représentations existent déjà côté schéma ;
  on normalise sur "aucune ligne = indisponible" côté nouveau code, `saveWeeklyAvailability`
  n'écrit que les jours actifs, comme aujourd'hui).
- Override date spécifique : `recurrence_type='specific_date'`, `specific_date`,
  `day_of_week=NULL`. Indisponibilité totale ce jour-là : une ligne `is_available=false`
  sans horaires. Horaires personnalisés : une ou plusieurs lignes `is_available=true` avec
  `start_time`/`end_time`.
- **Priorité** : s'il existe au moins une ligne `specific_date` pour une date donnée, elle
  remplace *entièrement* la règle hebdomadaire de ce jour-là (le moteur ignore les lignes
  `weekly` dès qu'une ligne `specific_date` existe pour cette date).
- Pas de contrainte DB anti-chevauchement entre plages du même jour — validé côté formulaire
  provider (empêcher de sauvegarder deux plages qui se chevauchent), comme c'est déjà le cas
  implicitement aujourd'hui avec une seule plage.

### `provider_scheduling_settings` (nouvelle)
```sql
create table provider_scheduling_settings (
  provider_id uuid primary key references users(id) on delete cascade,
  appointment_duration_minutes int not null default 30,
  slot_interval_minutes int not null default 30,
  buffer_before_minutes int not null default 0,
  buffer_after_minutes int not null default 0,
  minimum_notice_minutes int not null default 120,
  booking_horizon_days int not null default 60,
  updated_at timestamptz not null default now()
);
-- RLS : provider gère sa propre ligne ; patients (et l'app) peuvent lire la ligne
-- d'un provider VALIDATED (même politique de lecture que healthcare_professionals).
```
Le service applique les valeurs par défaut ci-dessus en mémoire si aucune ligne n'existe
encore pour un provider (pas de backfill obligatoire).

### `consultations` (existante, + 1 contrainte)
```sql
create extension if not exists btree_gist;

alter table consultations
  add constraint no_overlapping_bookings
  exclude using gist (
    doctor_id with =,
    tstzrange(scheduled_at, scheduled_at + (duration || ' minutes')::interval, '[)') with &&
  ) where (status not in ('cancelled', 'no_show'));
```
Deux réservations concurrentes sur le même créneau : la seconde `INSERT` échoue avec le code
Postgres `23P01`. C'est le mécanisme qui garantit l'absence de double réservation, indépendamment
de tout bug côté client.

```sql
create unique index one_booking_per_provider_per_day
  on consultations (patient_id, doctor_id, ((scheduled_at at time zone 'Africa/Kinshasa')::date))
  where (status not in ('cancelled', 'no_show'));
```
Un même patient ne peut avoir qu'un seul rendez-vous actif par jour avec un même prestataire
(un second `INSERT` échoue avec le code Postgres `23505`, mappé sur le même
`SlotUnavailableError` côté client, message « Vous avez déjà un rendez-vous ce jour-là avec ce
professionnel »). Rien n'empêche de réserver le même jour avec un prestataire différent.

## Moteur de disponibilité — `src/services/availabilityEngine.ts` (nouveau)

Fonctions pures + accès Supabase, réutilisées par les écrans provider ET patient.

- `getWeeklyRules(providerId)` / `getOverrides(providerId, from, to)` / `getSettings(providerId)`
  / `getBookedRanges(providerId, from, to)` — requêtes Supabase directes (même pattern que
  `providerApi.ts`/`patientApi.ts` existants).
- `effectiveRangesForDate(date, weeklyRules, overrides): {start, end}[]` — applique la règle
  de priorité override > hebdo décrite ci-dessus, retourne des plages en minutes-du-jour.
- `generateSlots(date, ranges, settings, bookedRanges, now): Slot[]` où
  `Slot = {start: Date, end: Date, available: boolean}` :
  1. Pour chaque plage, avancer de `slot_interval_minutes` en `slot_interval_minutes`,
     chaque créneau dure `appointment_duration_minutes`.
  2. Exclure tout créneau dont `[start - buffer_before, end + buffer_after]` chevauche une
     réservation existante.
  3. Exclure tout créneau `start < now + minimum_notice_minutes`.
  4. Exclure toute date `> today + booking_horizon_days` ou dans le passé.
- `getMonthAvailability(providerId, year, month): Record<'YYYY-MM-DD', 'available'|'full'|'unavailable'>`
  — pour chaque jour du mois dans l'horizon : calcule `generateSlots`, `available` si ≥1 créneau
  libre, `full` si des plages existent mais tout est pris, `unavailable` si aucune plage ce
  jour-là. Les jours hors horizon / passés sont traités côté UI (non sélectionnables), pas
  encodés dans ce map.
- `getDaySlots(providerId, date): Slot[]` — pour l'écran de sélection de créneau.

Pas de nouvelle edge function : ces fonctions tournent côté client (RLS protège déjà la lecture
de `doctor_availability`/`consultations`), comme le fait `generateBookableDays` aujourd'hui.
`generateBookableDays` et son usage dans `app/doctor/[id].tsx` sont supprimés, remplacés par ce
module.

## UI Prestataire

Trois écrans, navigation par un petit sélecteur de segments en haut de chacun (Hebdomadaire /
Dates spécifiques / Réglages), pour rester sur des routes Expo Router simples sans restructurer
`app/provider/`.

1. **`app/provider/availability.tsx` (modifié)** — écran hebdomadaire existant, étendu pour
   supporter plusieurs plages par jour : bouton « + Ajouter une plage » par jour actif, bouton
   de suppression par plage. Le picker de durée global est retiré (déplacé dans Réglages).
2. **`app/provider/availability-overrides.tsx` (nouveau)** — grille mensuelle (composant
   partagé, voir UI Patient) pour choisir une date, puis formulaire : bascule « Indisponible
   toute la journée » ou une/plusieurs plages personnalisées ; liste des overrides à venir avec
   édition/suppression ; « Restaurer l'horaire habituel » = supprimer les lignes `specific_date`
   de cette date.
3. **`app/provider/scheduling-settings.tsx` (nouveau)** — formulaire pour les 6 champs de
   `provider_scheduling_settings`, sliders/steppers cohérents avec `Field`/`Button` existants.

`app/(provider)/profile.tsx:39` (ligne « Disponibilités ») pointe toujours vers
`/provider/availability`, qui devient le point d'entrée des trois écrans via le sélecteur de
segments.

## UI Patient

- **`src/components/MonthCalendar.tsx` (nouveau)** — grille 7 colonnes faite maison, props
  `monthStatus`, `selectedDate`, `onSelectDate`, `minDate`/`maxDate` (aujourd'hui / horizon),
  utilise `colors`/`Card`. États visuels distincts : disponible, complet, indisponible,
  sélectionné, aujourd'hui, passé/hors-horizon (non cliquable, grisé).
- **`app/doctor/[id].tsx` (modifié)** — remplace la bande de jours horizontale par
  `MonthCalendar` (chargé via `getMonthAvailability`) ; sous le calendrier, liste des créneaux
  du jour sélectionné (`getDaySlots`), boutons flex-wrap comme aujourd'hui, état "réservé" en
  gris/non cliquable (aucune info sur qui a réservé), état sélectionné mis en évidence.
- Après réservation réussie, invalidation/refetch du mois + du jour (pas seulement fermeture
  d'écran) pour que le créneau disparaisse immédiatement si l'utilisateur revient en arrière.

## Réservation — sécurité de concurrence

`bookConsultation` (`src/services/patientApi.ts`, modifié) :
1. Revalide côté client que le créneau choisi est toujours dans `getDaySlots` (best-effort,
   pas la garantie réelle).
2. `INSERT` dans `consultations` comme aujourd'hui.
3. Si l'insert échoue avec le code Postgres `23P01` (chevauchement, contrainte
   `no_overlapping_bookings`) ou `23505` (index `one_booking_per_provider_per_day`) → erreur
   typée `SlotUnavailableError` (message adapté au code), remontée à l'UI.
4. L'écran patient attrape `SlotUnavailableError` : message « Ce créneau vient d'être réservé »,
   refetch automatique de `getDaySlots` pour la date choisie, retour à l'étape de sélection.

## États de chargement / erreur

| Cas | Comportement |
|---|---|
| Chargement dispo du mois | Squelette/spinner sur la grille |
| Chargement créneaux du jour | Spinner sous le calendrier |
| Aucune dispo ce mois | Message « Aucune disponibilité ce mois-ci » |
| Aucune dispo ce jour | Message « Aucun créneau disponible ce jour-là » |
| Erreur réseau | Message + bouton "Réessayer" (pattern déjà utilisé ailleurs dans l'app) |
| Conflit à la réservation | Voir section précédente |
| Provider non validé / suspendu | Écran doctor déjà filtre sur `VALIDATED`, comportement inchangé |
| Date hors horizon / passée | Non sélectionnable dans `MonthCalendar` (pas d'appel réseau) |

## Tests

Aucun framework de test n'existe dans `visiodoc-app` aujourd'hui. Ajout minimal :
`jest` + `jest-expo` (devDependencies), script `"test": "jest"`.

Tests unitaires de `src/services/availabilityEngine.ts` (fonctions pures, pas de rendu RN) :
- Horaire hebdo simple (une plage/jour)
- Plusieurs plages le même jour (pause déjeuner)
- Override date spécifique (remplace l'hebdo)
- Override "indisponible toute la journée"
- Conflit avec un rendez-vous existant (créneau exclu)
- Tampon avant/après (buffer)
- Durée de rendez-vous ≠ intervalle de créneau
- Préavis minimum (créneaux trop proches de `now` exclus)
- Horizon de réservation (jours au-delà exclus)
- Jour entièrement complet → `getMonthAvailability` retourne `full`
- Annulation d'un rendez-vous → créneau redevient disponible

Pas de tests d'écran RN pour cette itération (pas d'infra `@testing-library/react-native`
existante ; ajouté seulement si une régression UI le justifie).

## Points ouverts avant le plan d'implémentation

1. **Schéma live à confirmer** (voir requête SQL demandée en conversation) — colonnes réelles
   de `doctor_availability`, `consultations`, `users`/`provider_profiles` sur le projet prod
   `cftqxuxhsellvquidpxr`. Les migrations ci-dessus seront ajustées en conséquence.
2. Les bugs pré-existants de vocabulaire `status`/`consultation_type` (CHECK vs valeurs
   réellement écrites par l'app) restent non corrigés par ce travail.
