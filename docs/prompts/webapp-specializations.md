# Prompt — Web app VisioDoc : gestion des spécialisations (admin + prestataire)

Contexte : l'app mobile VisioDoc (Expo / Supabase, projet `cftqxuxhsellvquidpxr`) a un catalogue de
spécialisations médicales et de professions de santé validé par l'administrateur. Le web app doit
utiliser la **même table** et offrir l'interface d'administration. Ne recrée pas de table : utilise
celle décrite ci-dessous (script d'origine : `docs/sql/specializations.sql` dans le repo mobile,
à exécuter s'il n'est pas encore appliqué).

## Modèle de données (`public.specializations`)
- `id uuid`, `label text`, `label_key text unique` (libellé sans accents, minuscules, trim),
  `category` (`medical` | `allied` | `other`), `status` (`pending` | `approved` | `rejected`),
  `suggested_by`, `reviewed_by`, `reviewed_at`, `created_at`.
- RLS : tout le monde lit `approved` ; un utilisateur lit ses propres suggestions ; `is_admin()`
  lit/modifie/supprime tout ; un prestataire n'insère que `pending` + `category='other'` à son nom.
- RPC : `review_specialization(p_id uuid, p_status text, p_label text default null)` — admin
  seulement, passe en `approved`/`rejected`, peut corriger le libellé, trace relecteur et date.

## Règles métier (à respecter strictement)
1. La liste officielle = uniquement `status = 'approved'`.
2. Un prestataire peut saisir une spécialisation libre : elle est créée en `pending`. Il la voit sur
   son profil avec la mention « en attente », mais elle n'entre PAS dans la liste officielle tant que
   l'administrateur ne l'a pas acceptée.
3. Seul l'administrateur accepte, refuse ou renomme. Jamais d'auto-validation.
4. Max 5 spécialisations par prestataire (la première = spécialité principale).
5. Doublons : comparer via `label_key` (insensible à la casse et aux accents).
6. Le prestataire stocke ses choix dans `users.specialization` / `healthcare_professionals.specialization`
   (texte `A · B` ou `text[]` — lire les deux formats).

## À construire

### A. Espace administrateur — « Spécialisations »
- Onglets : **En attente** (par défaut, avec compteur), **Approuvées**, **Refusées**.
- Liste En attente : libellé, proposé par (nom du prestataire), date, nombre de prestataires qui
  l'utilisent. Actions : **Accepter**, **Accepter en renommant** (champ libellé éditable),
  **Refuser**, **Fusionner avec une entrée existante** (remplace le libellé chez les prestataires
  concernés, puis marque refusé).
- Liste Approuvées : recherche, filtre par catégorie, ajout manuel d'une entrée (insert `approved`),
  renommage, désactivation (repasse en `rejected`).
- Toute action passe par `review_specialization` (ou update admin) ; confirmation avant refus.
- Accès réservé aux rôles couverts par `is_admin()` ; masquer la page aux autres.

### B. Profil prestataire (web)
- Même comportement que le mobile : recherche dans la liste approuvée, puces, max 5, étoile sur la
  principale, « Proposer "…" (validation admin) » pour la saisie libre, badge « en attente » sur les
  entrées hors liste officielle, minimum 1 spécialisation.
- À l'enregistrement : mettre à jour les colonnes ci-dessus puis insérer en `pending`
  (`upsert` sur `label_key`, `ignoreDuplicates`) les libellés absents de la liste officielle.

### C. Notifications (optionnel mais recommandé)
- Notifier le prestataire quand sa proposition est acceptée / refusée (utiliser les fonctions
  existantes `specialty-notification` / `specialty-change-notify` si elles conviennent).

## Critères d'acceptation
- Un prestataire propose « Rolfing » → visible « en attente » sur son profil, absent de la liste des
  autres prestataires.
- L'admin l'accepte → il apparaît dans la liste officielle de tous et perd le badge « en attente ».
- L'admin refuse → il reste en `rejected`, n'apparaît dans aucune liste ; le prestataire est informé.
- Un non-admin ne peut ni lire les `pending` des autres ni changer un statut (testé via RLS).
- Aucune migration destructive ; compatible avec les entrées déjà amorcées (264).

Livre : code, tests, et la liste des fichiers modifiés. Pose-moi les questions nécessaires avant de
supposer un nom de table ou un rôle absent du schéma.
