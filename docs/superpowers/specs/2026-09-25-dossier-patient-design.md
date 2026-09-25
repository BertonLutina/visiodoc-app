# Dossier patient (DPI) côté prestataire — Design

Date : 2026-09-25
App : `visiodoc-app` (Expo / Expo Router / Supabase)

## Objectif

Remplacer l'onglet "Dossiers" actuel côté prestataire — une liste 100% mock (`providerPatientFiles`)
avec un bouton "Modifier" qui ne fait rien — par un vrai dossier patient informatisé (DPI) :
identité et infos administratives réelles, historique médical structuré (allergies, médicaments,
pathologies, vaccinations, résultats labo, documents, notes, ordonnances, comptes-rendus de
consultation) avec pièces jointes, historique des consultations, et la capacité pour le
prestataire de créer/modifier/archiver des entrées.

Unifie au passage deux écrans qui montrent aujourd'hui des bouts différents et incomplets d'un
même patient : l'onglet "Patients" (fiche basique, âge/genre en placeholder) et l'onglet
"Dossiers" (liste mock, aucune fiche réelle).

**Toutes les données de schéma ci-dessous ont été vérifiées en direct sur la vraie base de
production (`cftqxuxhsellvquidpxr`) le 2026-09-25** — pas déduites d'un fichier de migration
local (l'expérience de la fonctionnalité précédente a montré que ces fichiers peuvent être
incomplets ou obsolètes par rapport à la prod réelle).

## Décisions

| Sujet | Décision |
|---|---|
| Portée CRUD | Gestion libre : le prestataire peut ajouter/modifier/archiver n'importe quelle entrée à tout moment, pas seulement pendant une consultation active |
| Accès (qui voit quel dossier) | **Cercle de soins** : uniquement les prestataires ayant eu une consultation (active, ni annulée ni no-show) avec ce patient. Pas d'accès libre à tout patient — conforme à la pratique réelle (secret médical / relation de soin), voir recherche menée en conversation |
| Consentement patient explicite (`medical_record_consent`) | Hors périmètre pour cette itération — la table existe déjà en base mais reste non branchée ; piste future si un besoin réglementaire plus strict se présente |
| Pièces jointes | Incluses dès la v1 (photo/PDF) — nouveau bucket Storage, aucun bucket existant à ce jour |
| Taxonomie des types d'entrée | Alignée sur les vraies valeurs de la contrainte `CHECK` de `medical_records.record_type` (9 valeurs, voir ci-dessous) — pas les 5 valeurs actuelles du code (`ordonnance`/`diagnostic`/`analyse`/`vaccin`/`allergie`) qui ne correspondent pas au schéma réel |
| Champs structurés ordonnance | Nom médicament/dosage/fréquence dans la colonne `metadata` jsonb déjà existante — pas de nouvelle colonne |
| Suppression d'une entrée | Jamais un vrai `DELETE` — archivage via `status = 'inactive'` (la policy `DELETE` existe en base mais l'app ne l'utilise jamais) |
| Écrans Patients vs Dossiers | Un seul écran de fiche patient unifié, ouvert depuis les deux onglets — évite de maintenir deux vues qui divergent |
| Recherche patient côté prestataire | Limitée à ses propres patients (cohérent avec le cercle de soins) ; la recherche de *prestataire* par un patient est une fonctionnalité distincte, déjà existante côté patient, hors périmètre ici |
| Traçabilité | Réutilise `audit_logs` (déjà branché pour les évènements d'authentification cette même session) pour chaque création/modification/archivage d'entrée |
| Bug RLS `role = 'doctor'` (pré-existant, documenté dans `SUPABASE.md`) | Dans le périmètre : corrigé sur `medical_records` avant de construire quoi que ce soit dessus (même correctif que celui déjà appliqué sur `doctor_availability`) |
| Consultations annulées/no-show | Exclues de la condition d'accès (RLS) — un rendez-vous annulé n'établit pas de relation de soin réelle |

## Modèle de données

### `medical_records` (existante, vérifiée en direct — 17 colonnes, aucune migration de schéma nécessaire)

```
id:uuid! patient_id:uuid! doctor_id:uuid! consultation_id:uuid record_type:text! title:text!
description:text category:text severity:text status:text date_recorded:timestamptz
start_date:timestamptz end_date:timestamptz attachments:jsonb metadata:jsonb
created_at:timestamptz updated_at:timestamptz
```

Contraintes `CHECK` réelles (vérifiées en direct) :
- `record_type IN ('allergy','medication','condition','vaccination','lab_result','document','note','consultation_report','prescription')`
- `severity IN ('mild','moderate','severe')`
- `status IN ('active','inactive','resolved')`

Note : `medication` et `prescription` coexistent en base avec des usages distincts dans ce
design — voir taxonomie ci-dessous. `consultation_report` existe aussi et n'était identifié dans
aucune doc/migration locale avant cette vérification.

### RLS actuelle (vérifiée en direct — à corriger, pas à réécrire)

```sql
-- INSERT "Doctors can create medical records for their patients" — check actuel :
((auth.uid() = doctor_id)
 AND EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'doctor')  -- BUG
 AND EXISTS (SELECT 1 FROM consultations
             WHERE consultations.doctor_id = auth.uid()
               AND consultations.patient_id = medical_records.patient_id))               -- pas de filtre status

-- SELECT "Doctors can view their patients medical records" — qual actuel :
EXISTS (SELECT 1 FROM consultations
        WHERE consultations.doctor_id = auth.uid()
          AND consultations.patient_id = medical_records.patient_id)                     -- pas de filtre status
```

Correctifs à appliquer (deux `ALTER POLICY`, pas de `DROP`/`CREATE`) :

```sql
ALTER POLICY "Doctors can create medical records for their patients" ON medical_records
WITH CHECK (
  (( SELECT auth.uid() AS uid ) = doctor_id)
  AND EXISTS (SELECT 1 FROM users WHERE users.id = ( SELECT auth.uid() AS uid ) AND users.role = 'provider'::text)
  AND EXISTS (
    SELECT 1 FROM consultations
    WHERE consultations.doctor_id = ( SELECT auth.uid() AS uid )
      AND consultations.patient_id = medical_records.patient_id
      AND consultations.status NOT IN ('cancelled', 'no_show')
  )
);

ALTER POLICY "Doctors can view their patients medical records" ON medical_records
USING (
  EXISTS (
    SELECT 1 FROM consultations
    WHERE consultations.doctor_id = ( SELECT auth.uid() AS uid )
      AND consultations.patient_id = medical_records.patient_id
      AND consultations.status NOT IN ('cancelled', 'no_show')
  )
);
```

`UPDATE`/`DELETE` (`auth.uid() = doctor_id`, sans vérification de rôle ni de consultation) ne
sont pas modifiées — une fois qu'un médecin a créé une entrée, il continue de la gérer même si la
relation de consultation qui l'a permise n'existe plus (comportement jugé raisonnable, pas un
bug). L'app n'appelle jamais `DELETE` (archivage uniquement).

### Taxonomie types ↔ UI

| `record_type` (DB) | Libellé FR | Usage |
|---|---|---|
| `allergy` | Allergie | Allergie connue, généralement de longue durée |
| `medication` | Traitement en cours | Médicament pris au long cours (déclaratif, pas forcément prescrit sur cette plateforme) |
| `condition` | Pathologie | Antécédent ou pathologie diagnostiquée |
| `vaccination` | Vaccination | |
| `lab_result` | Résultat labo | Généralement avec pièce jointe |
| `document` | Document | Pièce jointe libre (compte-rendu externe, etc.) |
| `note` | Note | Note clinique libre |
| `prescription` | Ordonnance | **Champs structurés** dans `metadata` (nom médicament, dosage, fréquence) — voir ci-dessous |
| `consultation_report` | Compte-rendu de consultation | Lié à `consultation_id`, généré/rédigé après une consultation |

### Champs `metadata` (jsonb) pour `record_type = 'prescription'`

```json
{ "medication_name": "Amoxicilline", "dosage": "500mg", "frequency": "3x/jour" }
```
La "durée" se déduit de `start_date`/`end_date`, pas un champ `metadata` séparé (évite la
redondance).

### Champs `users` déjà existants à exploiter (vérifiés en direct, tous présents)

`date_of_birth`, `gender`, `blood_type`, `allergies` (texte libre), `address`,
`emergency_contact_name`, `emergency_contact_phone`. Aucun n'est lu aujourd'hui par
`getPatients()` (qui synthétise `age: 0, gender: 'F'` en placeholder).

Note de cohérence : `users.allergies` (texte libre) et les lignes `medical_records` avec
`record_type = 'allergy'` sont deux emplacements distincts pour la même information clinique.
Les deux sont affichés dans la fiche patient (le champ `users.allergies` en résumé rapide dans
l'en-tête, les lignes `medical_records` dans l'historique détaillé) — pas de fusion/migration de
données entre les deux pour cette itération, juste une mention explicite dans l'UI pour éviter
la confusion.

### Pièces jointes — nouveau bucket Storage

Aucun bucket Storage n'existe actuellement sur le projet (vérifié : `storage.buckets` vide).
Nouveau bucket `medical-record-attachments` (privé, pas public) :

```sql
insert into storage.buckets (id, name, public) values ('medical-record-attachments', 'medical-record-attachments', false);

create policy "Circle of care can read attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'medical-record-attachments'
    and exists (
      select 1 from medical_records mr
      join consultations c on c.doctor_id = auth.uid() and c.patient_id = mr.patient_id
      where mr.id::text = (storage.foldername(name))[2]  -- chemin: {patient_id}/{record_id}/{filename}
        and c.status not in ('cancelled', 'no_show')
    )
    or (storage.foldername(name))[1] = auth.uid()::text  -- le patient peut voir ses propres pièces jointes
  );

create policy "Circle of care can upload attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'medical-record-attachments'
    and exists (
      select 1 from medical_records mr
      join consultations c on c.doctor_id = auth.uid() and c.patient_id = mr.patient_id
      where mr.id::text = (storage.foldername(name))[2]
        and mr.doctor_id = auth.uid()
        and c.status not in ('cancelled', 'no_show')
    )
  );
```
Cette policy suppose que la ligne `medical_records` est créée **avant** l'upload de la pièce
jointe (le formulaire enregistre d'abord l'entrée pour obtenir son `id`, puis upload le fichier
en le référençant) — sinon `(storage.foldername(name))[2]` ne correspond à aucune ligne et
l'upload est refusé à raison. Chemin de fichier : `{patient_id}/{record_id}/{filename}`. Stocké
dans la colonne `attachments`
jsonb existante sous forme de tableau : `[{ "name", "path", "type", "uploaded_at" }]` (on stocke
le chemin Storage, pas une URL publique signée — générée à la demande côté client via
`createSignedUrl`).

### `audit_logs` — réutilisation (pas de nouvelle table)

Actions : `medical_record:create`, `medical_record:update`, `medical_record:archive`.
`actor_id` = médecin, `target_id` = patient concerné, `payload` = `{ record_id, record_type }`.
Même mécanisme que celui branché pour les évènements d'authentification
(`src/services/auditLog.ts`).

## Services

### `src/services/providerApi.ts` (étendu)

- `getPatient(patientId: string): Promise<PatientDetail>` — nouvelle fonction, lecture directe
  d'une seule ligne `users` (remplace le pattern actuel qui charge toute la liste `getPatients()`
  pour en extraire une). Calcule l'âge réel depuis `date_of_birth` (gère le cas nul :
  "âge inconnu"), lit `gender`/`blood_type`/`allergies`/`address`/`emergency_contact_*`.
- `getPatientRecords(patientId: string): Promise<MedicalRecord[]>` — remplace, côté provider,
  l'usage actuel de `patientApi.getMedicalRecords()` ; même requête `medical_records` mais lit
  désormais toutes les colonnes utiles (`description`, `category`, `severity`, `status`,
  `start_date`, `end_date`, `attachments`, `metadata`, `consultation_id`) au lieu du sous-ensemble
  actuel (`id, record_type, title, status, created_at` avec `status` ignoré et `author: ''` en
  dur).
- `createMedicalRecord(input: MedicalRecordInput): Promise<void>`
- `updateMedicalRecord(id: string, input: Partial<MedicalRecordInput>): Promise<void>`
- `archiveMedicalRecord(id: string): Promise<void>` — `update({ status: 'inactive' })`
- `uploadRecordAttachment(patientId: string, recordId: string, file): Promise<AttachmentMeta>`
- `getPatientConsultationHistory(patientId: string, doctorId: string): Promise<Consultation[]>` —
  réutilise la table `consultations` déjà lue ailleurs (`getProviderConsultations`), filtrée par
  patient.

`patientApi.getMedicalRecords()` (côté patient) n'est pas modifiée — les deux fonctions
partageront le même type `MedicalRecord` étendu mais restent des requêtes séparées (patient vs
provider ont des filtres RLS différents).

## UI Prestataire

1. **`app/(provider)/records.tsx` (modifié)** — remplace `providerPatientFiles` (mock) par un
   vrai appel listant les patients du prestataire (même dérivation que `getPatients()`, via ses
   consultations) avec le dernier acte réel (`record_type` + date le plus récent par patient,
   au lieu du texte en dur actuel). La recherche par nom déjà présente se branche sur les
   vraies données. Chaque ligne navigue vers `/patient/[id]`.
2. **`app/patient/[id].tsx` (modifié en profondeur)** — devient le vrai dossier, ouvert depuis
   "Patients" ET "Dossiers" :
   - En-tête : identité réelle (`getPatient`), âge calculé, groupe sanguin, allergies (résumé
     `users.allergies`) mises en évidence, contact d'urgence.
   - Section "Historique médical" : liste `getPatientRecords`, filtrable par type (réutilise le
     pattern de filtre déjà présent côté patient dans `app/records.tsx`), badge de statut
     (actif/archivé — archivé visuellement estompé, masqué par défaut avec bascule pour
     l'afficher), indicateur de pièce jointe.
   - Bouton **"+ Ajouter une entrée"**.
   - Taper une entrée l'ouvre en édition (même formulaire pré-rempli) avec action "Archiver".
   - Nouvelle section "Historique des consultations" (`getPatientConsultationHistory`) : liste
     des rendez-vous passés avec ce patient, dates + motif.
3. **Formulaire d'entrée (nouveau, modal ou écran dédié `app/patient/record-form.tsx`)** :
   - Sélecteur de type (9 valeurs de la taxonomie).
   - Champs communs : titre (obligatoire), description, catégorie, gravité (pertinent surtout
     pour `allergy`/`condition`), dates début/fin.
   - Si `record_type = 'prescription'` : sous-champs structurés (médicament, dosage, fréquence)
     stockés dans `metadata`.
   - Pièce jointe optionnelle (`expo-image-picker` / `expo-document-picker`) : uploadée **après**
     l'enregistrement de l'entrée (la policy Storage exige que la ligne `medical_records`
     existe déjà, voir section pièces jointes) — le flux est donc "Enregistrer" crée d'abord la
     ligne, puis déclenche l'upload si un fichier a été sélectionné, avant de fermer le
     formulaire.
   - Pas de champ pour lier explicitement une consultation précise — l'accès est déjà garanti par
     la relation de soin existante ; `consultation_id` reste nul sauf pour `consultation_report`
     qui sera pré-lié depuis un futur écran de fin de consultation (hors périmètre de cette
     itération, le champ existe déjà en base).

`app/(provider)/patients.tsx` n'est pas modifié dans son rôle (liste + navigation), seul son
`onPress` pointe vers la même fiche enrichie.

## États de chargement / erreur

| Cas | Comportement |
|---|---|
| Patient sans aucune entrée | État vide dans la section historique, en-tête d'identité toujours affiché |
| `date_of_birth` absente | "Âge inconnu" plutôt qu'un calcul erroné |
| Échec d'écriture (RLS, hors-ligne, réseau) | Erreur affichée clairement, **jamais de repli silencieux "enregistré localement"** (leçon du bug corrigé sur les disponibilités) |
| Échec d'upload de pièce jointe | Le formulaire garde sa saisie, retry possible sans tout retaper |
| Historique long | Chargement progressif (pagination) plutôt que tout charger d'un coup |
| Entrée archivée | Visible mais estompée, masquée par défaut derrière une bascule "Afficher les entrées archivées" |
| Provider sans consultation avec ce patient (tente d'accéder directement) | RLS bloque la lecture — écran affiche une erreur/redirection plutôt qu'un état vide trompeur |

## Tests

Aucune infra de test de rendu RN existante pour cet écran (le seul framework de test du repo,
`jest`/`jest-expo`, a été ajouté pour le moteur de disponibilité — réutilisé ici).

Unitaires :
- Correspondance `record_type` ↔ libellé/icône UI (les 9 valeurs).
- Sérialisation/désérialisation des champs `metadata` pour `prescription`.
- Calcul de l'âge depuis `date_of_birth` (dont le cas `null`).
- Validation de formulaire (titre obligatoire, `end_date >= start_date`).

Vérification manuelle en direct sur la vraie base pour tout ce qui touche la RLS et le bucket
Storage (comme pratiqué tout au long de cette session) — impossible de garantir ce comportement
par des tests unitaires seuls.

## Points ouverts avant le plan d'implémentation

1. `medical_record_consent` reste non branché — à revisiter si un besoin réglementaire plus
   strict se présente (le modèle "cercle de soins" retenu ici correspond déjà à la pratique
   réelle vérifiée en conversation, donc pas urgent).
2. `status = 'resolved'` n'est pas exposé dans l'UI v1 (seulement actif/archivé via `inactive`) —
   `resolved` a un sens clinique différent (pathologie guérie vs traitement arrêté) qui mériterait
   sa propre réflexion UX, reporté à une itération future si le besoin se précise.
3. `consultation_report` : le champ/type existe en base et est documenté ici, mais son
   alimentation automatique depuis un écran de fin de consultation est hors périmètre de cette
   itération (seule la création manuelle via le formulaire générique est couverte).
