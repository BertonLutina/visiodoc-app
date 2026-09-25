# Dossier patient (DPI) côté prestataire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock "Dossiers" tab and the thin "Fiche patient" screen with a real, editable
patient medical record (DPI): real identity/clinical data, a full `medical_records` history with
attachments, provider create/edit/archive, and a consultation history — all gated by a
circle-of-care access model already partially enforced by existing RLS.

**Architecture:** No new backend service — direct Supabase client calls from React Native screens,
matching the existing pattern (`patientApi.ts`/`providerApi.ts`). One new pure taxonomy module
shared by both patient and provider screens, one new attachments module wrapping Supabase Storage,
and two RLS policy fixes + a new Storage bucket applied directly to the live database (no local
migration files exist in this repo — verified live, applied live, documented in `SUPABASE.md`).

**Tech Stack:** Expo Router, React Native, Supabase (Postgres + Storage), `expo-image-picker` +
`expo-document-picker` (new), Jest (existing).

**Spec:** [docs/superpowers/specs/2026-09-25-dossier-patient-design.md](../specs/2026-09-25-dossier-patient-design.md)

## Global Constraints

- Every RLS policy referenced in this plan was verified live against `cftqxuxhsellvquidpxr` on
  2026-09-25 (see spec) — never trust a local migration file for this table.
- Never a real `DELETE` on a `medical_records` row — archiving means `status = 'inactive'` only.
- Never a silent "saved locally" fallback on a medical-record write failure — surface the real
  error (lesson from the `doctor_availability` bug fixed earlier this project).
- `record_type` must always be one of the 9 real `CHECK`-constraint values: `allergy`,
  `medication`, `condition`, `vaccination`, `lab_result`, `document`, `note`, `prescription`,
  `consultation_report`.
- Every create/update/archive of a medical record is logged to `audit_logs`, best-effort (must
  never throw or block the write on logging failure).
- UI follows existing conventions exactly: `Card`/`Button`/`Field`/`SectionTitle`/`Badge` from
  `@/components/ui`, NativeWind classes already in use, `colors` from `@/theme/colors`, French copy.

## Review Focus

- A doctor whose only relationship to a patient is a cancelled/no-show consultation must NOT be
  able to read or write that patient's `medical_records` — owned by Task 4 (live RLS verification).
- `date_of_birth` absent (`null`) on a patient must never crash the age display or show a bogus
  number — owned by Task 6 (`calculateAge` unit tests).
- An attachment must never be uploaded before its `medical_records` row exists (the Storage policy
  requires the row to already exist) — owned by Task 12 (`onSave` sequencing: create/update first,
  upload second).
- A patient with zero medical records must render a clear empty state, not `undefined` or a crash,
  in both the "Dossiers" list and the patient detail screen — owned by Tasks 10 and 11.
- Switching an entry's type away from `prescription` (or between two edits) must never leave stale
  `medication`/`dosage`/`frequency` values in `metadata` for a type that doesn't use them — owned by
  Task 12 (`buildMetadata` only populates `metadata` when `kind === 'prescription'`).

---

### Task 1: Add attachment-picker dependencies

**Files:**
- Modify: `package.json` (via `npx expo install`, not hand-edited)
- Modify: `app.json`

**Interfaces:**
- Produces: `expo-image-picker`, `expo-document-picker` available for import in later tasks.

- [ ] **Step 1: Install the packages at the correct Expo SDK 57 versions**

Run:
```bash
npx expo install expo-image-picker expo-document-picker
```
Expected: `package.json` gains two new dependencies pinned to `~57.x` (whatever `expo install`
resolves — do not hand-pin a version).

- [ ] **Step 2: Add the iOS photo-library usage description and the image-picker config plugin**

In `app.json`, add `NSPhotoLibraryUsageDescription` next to the existing `NSCameraUsageDescription`:

```json
"infoPlist": {
  "NSCameraUsageDescription": "VisioDoc utilise la caméra pour les consultations vidéo.",
  "NSMicrophoneUsageDescription": "VisioDoc utilise le micro pour les consultations vidéo.",
  "NSPhotoLibraryUsageDescription": "VisioDoc utilise votre photothèque pour joindre des documents au dossier médical d'un patient.",
  "ITSAppUsesNonExemptEncryption": false
}
```

Add the `expo-image-picker` plugin entry to the `plugins` array (right after `expo-local-authentication`'s entry):

```json
[
  "expo-image-picker",
  {
    "photosPermission": "VisioDoc utilise votre photothèque pour joindre des documents au dossier médical d'un patient."
  }
]
```

`expo-document-picker` needs no plugin entry (no dangerous permission on either platform).

- [ ] **Step 3: Verify the app still boots**

Run: `npx tsc --noEmit`
Expected: no new type errors (these are config-only changes).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json app.json
git commit -m "chore: add expo-image-picker and expo-document-picker for record attachments"
```

---

### Task 2: Extend shared types

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/types/provider.ts`

**Interfaces:**
- Produces: `MedicalRecordKind` (9 values), `MedicalRecordSeverity`, `MedicalRecordStatus`,
  `MedicalRecordAttachment`, extended `MedicalRecord`, `MedicalRecordInput` (all from
  `src/types/index.ts`); `PatientDetail` (from `src/types/provider.ts`).

- [ ] **Step 1: Replace the medical record types in `src/types/index.ts`**

Replace lines 78-92 (the current `MedicalRecordKind`/`MedicalRecord`) with:

```typescript
export type MedicalRecordKind =
  | 'allergy'
  | 'medication'
  | 'condition'
  | 'vaccination'
  | 'lab_result'
  | 'document'
  | 'note'
  | 'prescription'
  | 'consultation_report';

export type MedicalRecordSeverity = 'mild' | 'moderate' | 'severe';
export type MedicalRecordStatus = 'active' | 'inactive' | 'resolved';

export interface MedicalRecordAttachment {
  name: string;
  path: string;
  type: string;
  uploadedAt: string;
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  doctorId: string;
  consultationId?: string;
  kind: MedicalRecordKind;
  title: string;
  description?: string;
  category?: string;
  severity?: MedicalRecordSeverity;
  status: MedicalRecordStatus;
  author: string;
  date: string;
  startDate?: string;
  endDate?: string;
  attachments: MedicalRecordAttachment[];
  metadata: Record<string, string>;
}

export interface MedicalRecordInput {
  patientId: string;
  doctorId: string;
  kind: MedicalRecordKind;
  title: string;
  description?: string;
  category?: string;
  severity?: MedicalRecordSeverity;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, string>;
  consultationId?: string;
}
```

(`detail` and the 5-value taxonomy are removed — `detail` was never read anywhere in the UI, and
the old kinds don't match the real `medical_records.record_type` CHECK constraint.)

- [ ] **Step 2: Add `PatientDetail` to `src/types/provider.ts`**

Add after the `ProviderPatient` interface:

```typescript
export interface PatientDetail {
  id: string;
  firstName: string;
  lastName: string;
  initials: string;
  age: number | null;
  gender: 'M' | 'F' | null;
  bloodType: string | null;
  allergiesSummary: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}
```

- [ ] **Step 3: Confirm the codebase still typechecks (it won't fully yet — later tasks fix the
  call sites that use the old shape)**

Run: `npx tsc --noEmit`
Expected: errors in `src/services/patientApi.ts`, `src/data/mock.ts`, `app/records.tsx`,
`app/patient/[id].tsx` — these are exactly the files fixed in Task 5 (the first three) and Task 11
(the last one). `app/(provider)/records.tsx` (rewritten in Task 10) does not use `MedicalRecordKind`
directly today, so it is not expected to error here. Confirm no error appears anywhere else (if one
does, note it — it means something else depended on the old shape that this plan didn't anticipate).

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/types/provider.ts
git commit -m "feat: align medical record types with the real medical_records schema"
```

---

### Task 3: Shared record-kind taxonomy module

**Files:**
- Create: `src/services/medicalRecordTaxonomy.ts`
- Test: `src/services/medicalRecordTaxonomy.test.ts`

**Interfaces:**
- Consumes: `MedicalRecordKind` (Task 2).
- Produces: `RECORD_KIND_META: Record<MedicalRecordKind, { icon: typeof Pill; color: string; label: string }>`,
  `RECORD_KINDS: MedicalRecordKind[]`, `isMedicalRecordKind(value: string): value is MedicalRecordKind`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/medicalRecordTaxonomy.test.ts
import { RECORD_KIND_META, RECORD_KINDS, isMedicalRecordKind } from './medicalRecordTaxonomy';

describe('medicalRecordTaxonomy', () => {
  it('defines metadata for exactly the 9 record types allowed by the medical_records CHECK constraint', () => {
    expect([...RECORD_KINDS].sort()).toEqual(
      [
        'allergy',
        'condition',
        'consultation_report',
        'document',
        'lab_result',
        'medication',
        'note',
        'prescription',
        'vaccination',
      ].sort(),
    );
  });

  it('every kind has a non-empty label, a color, and an icon component', () => {
    for (const kind of RECORD_KINDS) {
      const meta = RECORD_KIND_META[kind];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.color.length).toBeGreaterThan(0);
      expect(meta.icon).toBeDefined();
    }
  });

  it('isMedicalRecordKind narrows valid DB values and rejects unknown/legacy ones', () => {
    expect(isMedicalRecordKind('allergy')).toBe(true);
    expect(isMedicalRecordKind('ordonnance')).toBe(false);
    expect(isMedicalRecordKind('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/medicalRecordTaxonomy.test.ts`
Expected: FAIL — `Cannot find module './medicalRecordTaxonomy'`.

- [ ] **Step 3: Implement the module**

```typescript
// src/services/medicalRecordTaxonomy.ts
import {
  AlertTriangle,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FlaskConical,
  Pill,
  StickyNote,
  Stethoscope,
  Syringe,
} from 'lucide-react-native';
import { colors } from '@/theme/colors';
import type { MedicalRecordKind } from '@/types';

export type RecordKindMeta = { icon: typeof Pill; color: string; label: string };

export const RECORD_KIND_META: Record<MedicalRecordKind, RecordKindMeta> = {
  allergy: { icon: AlertTriangle, color: colors.warning, label: 'Allergie' },
  medication: { icon: Pill, color: colors.soft, label: 'Traitement en cours' },
  prescription: { icon: ClipboardList, color: colors.primary, label: 'Ordonnance' },
  condition: { icon: Stethoscope, color: '#3B82F6', label: 'Pathologie' },
  vaccination: { icon: Syringe, color: colors.success, label: 'Vaccination' },
  lab_result: { icon: FlaskConical, color: '#8B5CF6', label: 'Résultat labo' },
  document: { icon: FileText, color: colors.muted, label: 'Document' },
  note: { icon: StickyNote, color: colors.clay, label: 'Note' },
  consultation_report: { icon: ClipboardCheck, color: colors.accent, label: 'Compte-rendu' },
};

export const RECORD_KINDS = Object.keys(RECORD_KIND_META) as MedicalRecordKind[];

export function isMedicalRecordKind(value: string): value is MedicalRecordKind {
  return Object.prototype.hasOwnProperty.call(RECORD_KIND_META, value);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/services/medicalRecordTaxonomy.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/medicalRecordTaxonomy.ts src/services/medicalRecordTaxonomy.test.ts
git commit -m "feat: add shared medical-record-kind taxonomy (icons, colors, labels)"
```

---

### Task 4: Fix live RLS on `medical_records` + create the attachments Storage bucket

**Files:**
- Modify: `SUPABASE.md` (document the change, same convention as the earlier `doctor_availability` fix)

**Interfaces:**
- Produces: `medical_records` INSERT/SELECT policies now check `role = 'provider'` and exclude
  `cancelled`/`no_show` consultations; a new private `medical-record-attachments` Storage bucket
  with matching circle-of-care policies.

This task changes the live production database (`cftqxuxhsellvquidpxr`), not application files.
Apply the SQL via the Supabase SQL Editor for that project. If executing it directly is blocked
(as it was earlier this session — "Modify Shared Resources" classifier denial), hand the exact SQL
below to the user to run themselves; do not attempt to route around the denial with a different
tool.

- [ ] **Step 1: Fix the two `role = 'doctor'` / missing-status-filter policies**

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

- [ ] **Step 2: Create the Storage bucket and its two policies**

```sql
insert into storage.buckets (id, name, public) values ('medical-record-attachments', 'medical-record-attachments', false);

create policy "Circle of care can read attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'medical-record-attachments'
    and (
      exists (
        select 1 from medical_records mr
        join consultations c on c.doctor_id = auth.uid() and c.patient_id = mr.patient_id
        where mr.id::text = (storage.foldername(name))[2]
          and (storage.foldername(name))[1] = mr.patient_id::text
          and c.status not in ('cancelled', 'no_show')
      )
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

create policy "Circle of care can upload attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'medical-record-attachments'
    and exists (
      select 1 from medical_records mr
      join consultations c on c.doctor_id = auth.uid() and c.patient_id = mr.patient_id
      where mr.id::text = (storage.foldername(name))[2]
        and (storage.foldername(name))[1] = mr.patient_id::text
        and mr.doctor_id = auth.uid()
        and c.status not in ('cancelled', 'no_show')
    )
  );
```

Le segment `(storage.foldername(name))[1]` doit être lié à `mr.patient_id` : sans cette
condition, le chemin (`{patient_id}/{record_id}/{filename}`) n'est vérifié que sur son segment
`record_id`. Un prestataire pourrait alors déposer un fichier sous le dossier d'un patient
arbitraire tout en référençant l'id d'une de ses propres entrées ; la clause
`or (storage.foldername(name))[1] = auth.uid()::text` de la policy SELECT donnerait ensuite
l'accès en lecture à ce patient étranger. Le chemin doit donc toujours décrire le patient
réellement propriétaire de l'entrée.

- [ ] **Step 3: Verify live**

Run this query in the SQL editor and confirm the output matches:

```sql
select string_agg(cmd || ' | ' || policyname || ' | check=' || coalesce(with_check, qual), E'\n---\n')
from pg_policies where tablename = 'medical_records' and policyname in
  ('Doctors can create medical records for their patients', 'Doctors can view their patients medical records');

select id, public from storage.buckets where id = 'medical-record-attachments';

select policyname from pg_policies where tablename = 'objects' and policyname like '%attachments%';
```

Expected: the two `medical_records` policies no longer contain `role = 'doctor'` and both contain
`NOT IN ('cancelled', 'no_show')`; the bucket row exists with `public = false`; both Storage
policies are listed.

- [ ] **Step 4: Document the change in `SUPABASE.md`**

Add a new section at the end of `SUPABASE.md`:

```markdown
## Correctif appliqué : RLS `medical_records` + bucket pièces jointes (2026-09-25)

Même bug que `doctor_availability` (voir plus haut) : les policies INSERT/SELECT de
`medical_records` vérifiaient encore `role = 'doctor'` et n'excluaient pas les consultations
`cancelled`/`no_show` de la relation de soin. Corrigé par deux `ALTER POLICY` (voir
`docs/superpowers/plans/2026-09-25-dossier-patient.md`, Task 4). Nouveau bucket Storage privé
`medical-record-attachments` créé avec policies calquées sur le même modèle de cercle de soins.
```

- [ ] **Step 5: Commit**

```bash
git add SUPABASE.md
git commit -m "docs: record the medical_records RLS fix and new attachments bucket"
```

---

### Task 5: Read the real `medical_records` schema in `patientApi.ts`

**Files:**
- Modify: `src/services/patientApi.ts:188-218`
- Modify: `src/data/mock.ts:156-162`
- Modify: `app/records.tsx` (patient-facing dossier screen — full rewrite; do not confuse with
  `app/(provider)/records.tsx`, a different file rewritten in Task 10)
- Test: `src/services/patientApi.test.ts`

**Interfaces:**
- Consumes: `MedicalRecord`, `isMedicalRecordKind` (Tasks 2, 3); `RECORD_KIND_META`, `RECORD_KINDS`
  (Task 3, for `app/records.tsx`).
- Produces: `mapMedicalRecordRow(row: any): MedicalRecord` (exported, pure — reused by `providerApi.ts`
  in Task 8), updated `getMedicalRecords(patientId: string): Promise<MedicalRecord[]>`.

- [ ] **Step 1: Write the failing test for the pure mapping function**

Append to `src/services/patientApi.test.ts`:

```typescript
import { mapMedicalRecordRow } from './patientApi';

describe('mapMedicalRecordRow', () => {
  it('maps a full row to the app MedicalRecord shape', () => {
    const row = {
      id: 'r1',
      patient_id: 'p1',
      doctor_id: 'd1',
      consultation_id: 'c1',
      record_type: 'prescription',
      title: 'Amoxicilline',
      description: 'Antibiotique',
      category: 'Infection',
      severity: 'mild',
      status: 'active',
      date_recorded: '2026-06-10T00:00:00.000Z',
      start_date: '2026-06-10T00:00:00.000Z',
      end_date: '2026-06-17T00:00:00.000Z',
      attachments: [{ name: 'ordo.pdf', path: 'p1/r1/ordo.pdf', type: 'application/pdf', uploadedAt: '2026-06-10T00:00:00.000Z' }],
      metadata: { medication_name: 'Amoxicilline', dosage: '500mg', frequency: '3x/jour' },
      created_at: '2026-06-10T00:00:00.000Z',
    };
    expect(mapMedicalRecordRow(row)).toEqual({
      id: 'r1',
      patientId: 'p1',
      doctorId: 'd1',
      consultationId: 'c1',
      kind: 'prescription',
      title: 'Amoxicilline',
      description: 'Antibiotique',
      category: 'Infection',
      severity: 'mild',
      status: 'active',
      author: '',
      date: new Date('2026-06-10T00:00:00.000Z').toLocaleDateString('fr-FR'),
      startDate: '2026-06-10T00:00:00.000Z',
      endDate: '2026-06-17T00:00:00.000Z',
      attachments: row.attachments,
      metadata: row.metadata,
    });
  });

  it('falls back to "note" for an unrecognized record_type instead of crashing', () => {
    const row = { id: 'r2', patient_id: 'p1', doctor_id: 'd1', record_type: 'something_new', title: 'X', created_at: '2026-01-01T00:00:00.000Z' };
    expect(mapMedicalRecordRow(row).kind).toBe('note');
  });

  it('defaults attachments/metadata to empty when the DB returns null', () => {
    const row = { id: 'r3', patient_id: 'p1', doctor_id: 'd1', record_type: 'note', title: 'X', attachments: null, metadata: null, created_at: '2026-01-01T00:00:00.000Z' };
    const mapped = mapMedicalRecordRow(row);
    expect(mapped.attachments).toEqual([]);
    expect(mapped.metadata).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/services/patientApi.test.ts -t mapMedicalRecordRow`
Expected: FAIL — `mapMedicalRecordRow is not a function` (not yet exported).

- [ ] **Step 3: Implement — replace lines 188-218 of `src/services/patientApi.ts`**

```typescript
/* ---------- Dossier médical ---------- */
export function mapMedicalRecordRow(row: any): MedicalRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    consultationId: row.consultation_id ?? undefined,
    kind: isMedicalRecordKind(row.record_type) ? row.record_type : 'note',
    title: row.title ?? '',
    description: row.description ?? undefined,
    category: row.category ?? undefined,
    severity: row.severity ?? undefined,
    status: row.status ?? 'active',
    author: '',
    date: new Date(row.date_recorded ?? row.created_at).toLocaleDateString('fr-FR'),
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    metadata: row.metadata ?? {},
  };
}

export async function getMedicalRecords(patientId: string): Promise<MedicalRecord[]> {
  if (useMock()) return mock.medicalRecords;
  const { data, error } = await supabase!
    .from('medical_records')
    .select(
      'id, patient_id, doctor_id, consultation_id, record_type, title, description, category, severity, status, date_recorded, start_date, end_date, attachments, metadata, created_at',
    )
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapMedicalRecordRow);
}
```

Update the import line at the top of the file to add `isMedicalRecordKind`:

```typescript
import { isMedicalRecordKind } from './medicalRecordTaxonomy';
```

(the `recordKindMap` object that previously occupied these lines is deleted entirely — it's no
longer needed since `record_type` values now match `MedicalRecordKind` 1:1.)

- [ ] **Step 4: Update the mock fixture to the new shape — replace `src/data/mock.ts:156-162`**

```typescript
export const medicalRecords: MedicalRecord[] = [
  { id: 'r1', patientId: 'pat-1', doctorId: 'doc-1', kind: 'prescription', title: 'Paracétamol 1g — 3x/jour · 7 jours', status: 'active', author: 'Dr. Amara Diallo', date: '10 juin 2026', attachments: [], metadata: { medication_name: 'Paracétamol', dosage: '1g', frequency: '3x/jour' } },
  { id: 'r2', patientId: 'pat-1', doctorId: 'doc-1', kind: 'condition', title: 'Rhinopharyngite aiguë', status: 'active', author: 'Dr. Amara Diallo', date: '10 juin 2026', attachments: [], metadata: {} },
  { id: 'r3', patientId: 'pat-2', doctorId: 'doc-1', kind: 'lab_result', title: 'NFS complète — résultats normaux', status: 'active', author: 'Labo Pasteur', date: '5 mai 2026', attachments: [], metadata: {} },
  { id: 'r4', patientId: 'pat-3', doctorId: 'doc-1', kind: 'vaccination', title: 'Fièvre jaune — à jour', status: 'active', author: 'HGR Kinshasa', date: '12 jan. 2026', attachments: [], metadata: {} },
  { id: 'r5', patientId: 'pat-4', doctorId: 'doc-1', kind: 'allergy', title: 'Allergie connue : Pénicilline', status: 'inactive', author: 'Dr. Ndiaye', date: '3 mars 2025', attachments: [], metadata: {} },
];
```

(`r5`'s status is set to `'inactive'` deliberately, so the demo/mock app has one archived entry to
exercise the "show archived" toggle built in Task 11.)

- [ ] **Step 5: Replace the full contents of `app/records.tsx`**

This is the patient's own read-only dossier screen. Its `kindMeta`/`filters` currently hardcode the
old 5-value taxonomy — after Task 2, that object no longer matches `MedicalRecordKind` and stops
compiling. Replace it with the shared taxonomy module from Task 3 (the module was built exactly so
both this screen and the provider screens share one source of truth — this is the one place that
was missed when the module was designed):

```tsx
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getMedicalRecords } from '@/services/patientApi';
import { RECORD_KIND_META, RECORD_KINDS } from '@/services/medicalRecordTaxonomy';
import type { MedicalRecordKind } from '@/types';

export default function MedicalRecords() {
  const { user } = useAuth();
  const uid = user?.id ?? 'patient-1';
  const [active, setActive] = useState('Tout');
  const { data: records } = useAsync(() => getMedicalRecords(uid), [uid]);

  const filters = useMemo(
    () => [
      { key: 'Tout', match: undefined as MedicalRecordKind | undefined },
      ...RECORD_KINDS.map((k) => ({ key: RECORD_KIND_META[k].label, match: k })),
    ],
    [],
  );

  const list = useMemo(() => {
    const all = records ?? [];
    const f = filters.find((x) => x.key === active);
    if (!f?.match) return all;
    return all.filter((r) => r.kind === f.match);
  }, [active, records, filters]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">Dossier médical</Text>
      </View>

      <View className="px-5 pb-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {filters.map((f) => {
            const on = f.key === active;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActive(f.key)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{f.key}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        {list.map((r) => {
          const meta = RECORD_KIND_META[r.kind];
          return (
            <Card key={r.id} className="mb-3 flex-row">
              <View
                className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                style={{ backgroundColor: meta.color + '22' }}
              >
                <meta.icon color={meta.color} size={20} />
              </View>
              <View className="flex-1">
                <Text className="text-xs font-sans-bold" style={{ color: meta.color }}>
                  {meta.label}
                </Text>
                <Text className="font-sans-bold text-ink mt-0.5">{r.title}</Text>
                <Text className="font-sans text-xs text-muted mt-0.5">{r.date}</Text>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
```

(The old `{r.author} · {r.date}` line is replaced with just `{r.date}` — `author` is always `''` in
`mapMedicalRecordRow`, so the old text rendered as a stray leading " · ".)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/services/patientApi.test.ts`
Expected: PASS (all tests, including the pre-existing `bookConsultation`/`SlotUnavailableError` ones).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: the `src/services/patientApi.ts`, `src/data/mock.ts`, and `app/records.tsx` errors from
Task 2 Step 3 are gone (the pre-existing, unrelated `global.css` error is expected to remain — see
ledger). Remaining errors should only be in `app/patient/[id].tsx` (fixed in Task 11).

- [ ] **Step 8: Commit**

```bash
git add src/services/patientApi.ts src/services/patientApi.test.ts src/data/mock.ts app/records.tsx
git commit -m "feat: read the full medical_records schema, drop the stale kind-mapping table"
```

---

### Task 6: `getPatient` + real age calculation

**Files:**
- Modify: `src/services/providerApi.ts`
- Test: `src/services/providerApi.test.ts`

**Interfaces:**
- Consumes: `PatientDetail` (Task 2).
- Produces: `calculateAge(dateOfBirth: string | null | undefined): number | null`,
  `getPatient(patientId: string): Promise<PatientDetail>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/services/providerApi.test.ts`:

```typescript
import { calculateAge, getPatient } from './providerApi';

describe('calculateAge', () => {
  it('returns null when date_of_birth is missing', () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge(undefined)).toBeNull();
  });

  it('returns null for an unparseable date instead of NaN', () => {
    expect(calculateAge('not-a-date')).toBeNull();
  });

  it('computes a whole number of years from a birth date', () => {
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
    expect(calculateAge(eighteenYearsAgo.toISOString())).toBe(18);
  });

  it('does not count a birthday that has not happened yet this year', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const notYetTurned20 = new Date(tomorrow);
    notYetTurned20.setFullYear(notYetTurned20.getFullYear() - 20);
    expect(calculateAge(notYetTurned20.toISOString())).toBe(19);
  });
});

describe('getPatient', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('reads real clinical columns from users and computes age from date_of_birth', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: {
        id: 'pat-1',
        first_name: 'Marie',
        last_name: 'Konaté',
        date_of_birth: '1990-01-01T00:00:00.000Z',
        gender: 'F',
        blood_type: 'O+',
        allergies: 'Pénicilline',
        address: 'Kinshasa',
        emergency_contact_name: 'Jean Konaté',
        emergency_contact_phone: '+243800000000',
      },
      error: null,
    });
    const eqMock = jest.fn(() => ({ single: singleMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ select: selectMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { getPatient: getPatientFresh } = require('./providerApi');
    const result = await getPatientFresh('pat-1');

    expect(fromMock).toHaveBeenCalledWith('users');
    expect(eqMock).toHaveBeenCalledWith('id', 'pat-1');
    expect(result.bloodType).toBe('O+');
    expect(result.allergiesSummary).toBe('Pénicilline');
    expect(result.age).toBeGreaterThan(30);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/services/providerApi.test.ts -t "calculateAge|getPatient"`
Expected: FAIL — `calculateAge`/`getPatient` not exported.

- [ ] **Step 3: Implement — add to `src/services/providerApi.ts`**

Add `PatientDetail` to the type import at the top:

```typescript
import type {
  AvailabilitySlot,
  PatientDetail,
  ProviderConsultation,
  ProviderPatient,
  ProviderStats,
} from '@/types/provider';
```

Add after the `getPatients` function:

```typescript
export function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export async function getPatient(patientId: string): Promise<PatientDetail> {
  if (useMock()) {
    const p = mock.providerPatients.find((x) => x.id === patientId);
    return {
      id: patientId,
      firstName: p?.firstName ?? '',
      lastName: p?.lastName ?? '',
      initials: p?.initials ?? '?',
      age: p?.age ?? null,
      gender: (p?.gender as 'M' | 'F' | undefined) ?? null,
      bloodType: null,
      allergiesSummary: null,
      address: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    };
  }
  const { data, error } = await supabase!
    .from('users')
    .select(
      'id, first_name, last_name, date_of_birth, gender, blood_type, allergies, address, emergency_contact_name, emergency_contact_phone',
    )
    .eq('id', patientId)
    .single();
  if (error) throw error;
  return {
    id: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    initials: initials(data.first_name, data.last_name),
    age: calculateAge(data.date_of_birth),
    gender: data.gender ?? null,
    bloodType: data.blood_type ?? null,
    allergiesSummary: data.allergies ?? null,
    address: data.address ?? null,
    emergencyContactName: data.emergency_contact_name ?? null,
    emergencyContactPhone: data.emergency_contact_phone ?? null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/services/providerApi.test.ts`
Expected: PASS (all tests, including the pre-existing `saveAvailability`/`groupOverrideRows` ones).

- [ ] **Step 5: Commit**

```bash
git add src/services/providerApi.ts src/services/providerApi.test.ts
git commit -m "feat: add getPatient with real clinical fields and age calculation"
```

---

### Task 7: Create/update/archive a medical record + audit logging

**Files:**
- Modify: `src/services/auditLog.ts`
- Modify: `src/services/providerApi.ts`
- Test: `src/services/auditLog.test.ts` (new)
- Test: `src/services/providerApi.test.ts`

**Interfaces:**
- Consumes: `MedicalRecordInput`, `MedicalRecordKind` (Task 2).
- Produces: `logMedicalRecordEvent(...)` (from `auditLog.ts`); `createMedicalRecord(input)`,
  `updateMedicalRecord(id, context, patch)`, `archiveMedicalRecord(id, context)` (from
  `providerApi.ts`).

- [ ] **Step 1: Write the failing test for the audit helper**

```typescript
// src/services/auditLog.test.ts
import { logMedicalRecordEvent } from './auditLog';

describe('logMedicalRecordEvent', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('inserts an audit_logs row with the record id and type in the payload', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    const fromMock = jest.fn(() => ({ insert: insertMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

    const { logMedicalRecordEvent: logFresh } = require('./auditLog');
    await logFresh('medical_record:create', 'doc-1', 'pat-1', 'rec-1', 'prescription');

    expect(fromMock).toHaveBeenCalledWith('audit_logs');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: 'doc-1',
        actor_role: 'provider',
        action: 'medical_record:create',
        target_id: 'pat-1',
        payload: { record_id: 'rec-1', record_type: 'prescription' },
      }),
    );
  });

  it('never throws when the insert fails (best-effort)', async () => {
    const insertMock = jest.fn().mockRejectedValue(new Error('offline'));
    const fromMock = jest.fn(() => ({ insert: insertMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

    const { logMedicalRecordEvent: logFresh } = require('./auditLog');
    await expect(logFresh('medical_record:archive', 'doc-1', 'pat-1', 'rec-1', 'note')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/services/auditLog.test.ts`
Expected: FAIL — `logMedicalRecordEvent` not exported.

- [ ] **Step 3: Implement — add to `src/services/auditLog.ts`**

```typescript
export async function logMedicalRecordEvent(
  action: 'medical_record:create' | 'medical_record:update' | 'medical_record:archive',
  doctorId: string,
  patientId: string,
  recordId: string,
  recordType: string,
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('audit_logs').insert({
      actor_id: doctorId,
      actor_role: 'provider',
      action,
      target_id: patientId,
      payload: { record_id: recordId, record_type: recordType },
    });
  } catch {
    /* best-effort : ne jamais bloquer l'écriture du dossier pour un souci de journalisation */
  }
}
```

- [ ] **Step 4: Run the audit test to verify it passes**

Run: `npx jest src/services/auditLog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tests for the CRUD functions**

Append to `src/services/providerApi.test.ts`:

```typescript
describe('createMedicalRecord / updateMedicalRecord / archiveMedicalRecord', () => {
  const logMock = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('./auditLog', () => ({ logMedicalRecordEvent: logMock }));
  });

  afterEach(() => {
    jest.dontMock('@/lib/supabase');
    jest.dontMock('./auditLog');
  });

  it('createMedicalRecord inserts record_type from kind and defaults status to active', async () => {
    const singleMock = jest.fn().mockResolvedValue({ data: { id: 'rec-1' }, error: null });
    const selectMock = jest.fn(() => ({ single: singleMock }));
    const insertMock = jest.fn(() => ({ select: selectMock }));
    const fromMock = jest.fn(() => ({ insert: insertMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { createMedicalRecord: createFresh } = require('./providerApi');
    const result = await createFresh({ patientId: 'pat-1', doctorId: 'doc-1', kind: 'prescription', title: 'Amox' });

    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ record_type: 'prescription', status: 'active', title: 'Amox' }));
    expect(result).toEqual({ id: 'rec-1' });
    expect(logMock).toHaveBeenCalledWith('medical_record:create', 'doc-1', 'pat-1', 'rec-1', 'prescription');
  });

  it('updateMedicalRecord only patches the fields that were provided', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { updateMedicalRecord: updateFresh } = require('./providerApi');
    await updateFresh('rec-1', { doctorId: 'doc-1', patientId: 'pat-1', kind: 'note' }, { title: 'Nouveau titre' });

    expect(updateMock).toHaveBeenCalledWith({ title: 'Nouveau titre' });
    expect(logMock).toHaveBeenCalledWith('medical_record:update', 'doc-1', 'pat-1', 'rec-1', 'note');
  });

  it('archiveMedicalRecord sets status to inactive, never deletes the row', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { archiveMedicalRecord: archiveFresh } = require('./providerApi');
    await archiveFresh('rec-1', { doctorId: 'doc-1', patientId: 'pat-1', kind: 'allergy' });

    expect(updateMock).toHaveBeenCalledWith({ status: 'inactive' });
    expect(logMock).toHaveBeenCalledWith('medical_record:archive', 'doc-1', 'pat-1', 'rec-1', 'allergy');
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx jest src/services/providerApi.test.ts -t "createMedicalRecord|updateMedicalRecord|archiveMedicalRecord"`
Expected: FAIL — none of the three functions exist yet.

- [ ] **Step 7: Implement — add to `src/services/providerApi.ts`**

Add the import:

```typescript
import { logMedicalRecordEvent } from './auditLog';
import type { MedicalRecordInput, MedicalRecordKind } from '@/types';
```

Add after `getPatient`:

```typescript
export async function createMedicalRecord(input: MedicalRecordInput): Promise<{ id: string }> {
  if (useMock()) return { id: `mock-${Date.now()}` };
  const { data, error } = await supabase!
    .from('medical_records')
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      consultation_id: input.consultationId ?? null,
      record_type: input.kind,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      severity: input.severity ?? null,
      status: 'active',
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single();
  if (error) throw error;
  await logMedicalRecordEvent('medical_record:create', input.doctorId, input.patientId, data.id, input.kind);
  return { id: data.id };
}

export type MedicalRecordContext = { doctorId: string; patientId: string; kind: MedicalRecordKind };

export async function updateMedicalRecord(
  id: string,
  context: MedicalRecordContext,
  patch: Partial<Pick<MedicalRecordInput, 'title' | 'description' | 'category' | 'severity' | 'startDate' | 'endDate' | 'metadata'>>,
): Promise<void> {
  if (useMock()) return;
  const dbPatch: Record<string, any> = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.category !== undefined) dbPatch.category = patch.category;
  if (patch.severity !== undefined) dbPatch.severity = patch.severity;
  if (patch.startDate !== undefined) dbPatch.start_date = patch.startDate;
  if (patch.endDate !== undefined) dbPatch.end_date = patch.endDate;
  if (patch.metadata !== undefined) dbPatch.metadata = patch.metadata;
  const { error } = await supabase!.from('medical_records').update(dbPatch).eq('id', id);
  if (error) throw error;
  await logMedicalRecordEvent('medical_record:update', context.doctorId, context.patientId, id, context.kind);
}

export async function archiveMedicalRecord(id: string, context: MedicalRecordContext): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('medical_records').update({ status: 'inactive' }).eq('id', id);
  if (error) throw error;
  await logMedicalRecordEvent('medical_record:archive', context.doctorId, context.patientId, id, context.kind);
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest src/services/providerApi.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 9: Commit**

```bash
git add src/services/auditLog.ts src/services/auditLog.test.ts src/services/providerApi.ts src/services/providerApi.test.ts
git commit -m "feat: add medical record create/update/archive with audit_logs traceability"
```

---

### Task 8: Latest record per patient (for the Dossiers list) + patient consultation history

**Files:**
- Modify: `src/services/providerApi.ts`
- Modify: `src/data/mockProvider.ts`
- Test: `src/services/providerApi.test.ts`

**Interfaces:**
- Consumes: `mapMedicalRecordRow` (Task 5, imported from `patientApi.ts`).
- Produces: `getLatestRecordByPatient(doctorId: string): Promise<Map<string, MedicalRecord>>`,
  `getPatientConsultationHistory(doctorId: string, patientId: string): Promise<ProviderConsultation[]>`.

- [ ] **Step 1: Remove the now-unused `providerPatientFiles` mock and `PatientFile` import**

In `src/data/mockProvider.ts`, delete the `providerPatientFiles` export (lines 82-87) and remove
`PatientFile` from the type import at the top of the file (it becomes unused — the "Dossiers" list
is rewritten in Task 10 to derive its rows from `ProviderPatient` + `getLatestRecordByPatient`
directly, not from a separate mock-only type).

- [ ] **Step 2: Write the failing tests**

Append to `src/services/providerApi.test.ts`:

```typescript
describe('getLatestRecordByPatient', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('keeps only the most recent record per patient (rows already ordered desc by created_at)', async () => {
    const rows = [
      { id: 'r2', patient_id: 'pat-1', doctor_id: 'doc-1', record_type: 'prescription', title: 'Récent', status: 'active', created_at: '2026-06-10T00:00:00.000Z' },
      { id: 'r1', patient_id: 'pat-1', doctor_id: 'doc-1', record_type: 'condition', title: 'Ancien', status: 'active', created_at: '2026-05-01T00:00:00.000Z' },
      { id: 'r3', patient_id: 'pat-2', doctor_id: 'doc-1', record_type: 'allergy', title: 'Autre patient', status: 'active', created_at: '2026-06-01T00:00:00.000Z' },
    ];
    const orderMock = jest.fn().mockResolvedValue({ data: rows, error: null });
    const eqMock = jest.fn(() => ({ order: orderMock }));
    const selectMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ select: selectMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { getLatestRecordByPatient: getFresh } = require('./providerApi');
    const result = await getFresh('doc-1');

    expect(result.get('pat-1')?.id).toBe('r2');
    expect(result.get('pat-2')?.id).toBe('r3');
    expect(result.size).toBe(2);
  });
});

describe('getPatientConsultationHistory', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('filters consultations by both doctor and patient, most recent first', async () => {
    const orderMock = jest.fn().mockResolvedValue({ data: [], error: null });
    const eq2Mock = jest.fn(() => ({ order: orderMock }));
    const eq1Mock = jest.fn(() => ({ eq: eq2Mock }));
    const selectMock = jest.fn(() => ({ eq: eq1Mock }));
    const fromMock = jest.fn(() => ({ select: selectMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { getPatientConsultationHistory: getFresh } = require('./providerApi');
    await getFresh('doc-1', 'pat-1');

    expect(eq1Mock).toHaveBeenCalledWith('doctor_id', 'doc-1');
    expect(eq2Mock).toHaveBeenCalledWith('patient_id', 'pat-1');
    expect(orderMock).toHaveBeenCalledWith('scheduled_at', { ascending: false });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx jest src/services/providerApi.test.ts -t "getLatestRecordByPatient|getPatientConsultationHistory"`
Expected: FAIL — neither function exists yet.

- [ ] **Step 4: Implement — add to `src/services/providerApi.ts`**

Add the imports (`patientMock` is a second alias for `@/data/mock`, needed because that module's
`medicalRecords` fixture — not `mockProvider.ts`'s — is the mock data source, per Task 5):

```typescript
import * as patientMock from '@/data/mock';
import { mapMedicalRecordRow } from './patientApi';
import type { MedicalRecord } from '@/types';
```

Add after `getPatients`:

```typescript
export async function getLatestRecordByPatient(doctorId: string): Promise<Map<string, MedicalRecord>> {
  const map = new Map<string, MedicalRecord>();
  if (useMock()) {
    for (const r of patientMock.medicalRecords) if (!map.has(r.patientId)) map.set(r.patientId, r);
    return map;
  }
  const { data, error } = await supabase!
    .from('medical_records')
    .select(
      'id, patient_id, doctor_id, consultation_id, record_type, title, description, category, severity, status, date_recorded, start_date, end_date, attachments, metadata, created_at',
    )
    .eq('doctor_id', doctorId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  for (const row of data ?? []) {
    if (!map.has(row.patient_id)) map.set(row.patient_id, mapMedicalRecordRow(row));
  }
  return map;
}

export async function getPatientConsultationHistory(
  doctorId: string,
  patientId: string,
): Promise<ProviderConsultation[]> {
  if (useMock()) return mock.providerUpcomingConsultations.filter((c) => c.patient.id === patientId);
  const { data, error } = await supabase!
    .from('consultations')
    .select(`*, patient:users!consultations_patient_id_fkey ( id, first_name, last_name )`)
    .eq('doctor_id', doctorId)
    .eq('patient_id', patientId)
    .order('scheduled_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapConsultation);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/services/providerApi.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `mockProvider.ts` (the `PatientFile` import/export removal in Step 1 must
not leave any dangling reference — `app/(provider)/records.tsx` still imports the old
`providerPatientFiles`, which is fixed in Task 10, so an error there is still expected at this
point).

- [ ] **Step 7: Commit**

```bash
git add src/services/providerApi.ts src/services/providerApi.test.ts src/data/mockProvider.ts
git commit -m "feat: add getLatestRecordByPatient and getPatientConsultationHistory"
```

---

### Task 9: Attachment upload service

**Files:**
- Create: `src/services/medicalRecordAttachments.ts`
- Modify: `src/services/providerApi.ts`
- Test: `src/services/medicalRecordAttachments.test.ts`
- Test: `src/services/providerApi.test.ts`

**Interfaces:**
- Consumes: `MedicalRecordAttachment` (Task 2).
- Produces: `uploadRecordAttachment(patientId, recordId, file): Promise<MedicalRecordAttachment>`,
  `getAttachmentSignedUrl(path: string): Promise<string>` (from `medicalRecordAttachments.ts`);
  `appendMedicalRecordAttachment(id, existing, attachment): Promise<void>` (from `providerApi.ts`).

- [ ] **Step 1: Write the failing tests for the upload module**

```typescript
// src/services/medicalRecordAttachments.test.ts
describe('uploadRecordAttachment', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    globalThis.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve('fake-blob') }) as any;
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('uploads to the {patientId}/{recordId}/... path in the medical-record-attachments bucket', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: null });
    const fromStorageMock = jest.fn(() => ({ upload: uploadMock }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { storage: { from: fromStorageMock } },
      supabaseConfigured: true,
    }));

    const { uploadRecordAttachment: uploadFresh } = require('./medicalRecordAttachments');
    const result = await uploadFresh('pat-1', 'rec-1', { uri: 'file://x.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' });

    expect(fromStorageMock).toHaveBeenCalledWith('medical-record-attachments');
    expect(uploadMock).toHaveBeenCalled();
    const [path] = uploadMock.mock.calls[0];
    expect(path.startsWith('pat-1/rec-1/')).toBe(true);
    expect(result.name).toBe('photo.jpg');
    expect(result.path).toBe(path);
  });

  it('propagates a Storage upload error instead of swallowing it', async () => {
    const uploadMock = jest.fn().mockResolvedValue({ error: { message: 'RLS violation' } });
    const fromStorageMock = jest.fn(() => ({ upload: uploadMock }));
    jest.doMock('@/lib/supabase', () => ({
      supabase: { storage: { from: fromStorageMock } },
      supabaseConfigured: true,
    }));

    const { uploadRecordAttachment: uploadFresh } = require('./medicalRecordAttachments');
    await expect(
      uploadFresh('pat-1', 'rec-1', { uri: 'file://x.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ message: 'RLS violation' });
  });

  it('returns a placeholder without throwing when Supabase is not configured (demo mode)', async () => {
    jest.doMock('@/lib/supabase', () => ({ supabase: null, supabaseConfigured: false }));
    const { uploadRecordAttachment: uploadFresh } = require('./medicalRecordAttachments');
    const result = await uploadFresh('pat-1', 'rec-1', { uri: 'file://x.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' });
    expect(result.name).toBe('photo.jpg');
    expect(result.path).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/services/medicalRecordAttachments.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// src/services/medicalRecordAttachments.ts
import { supabase, supabaseConfigured } from '@/lib/supabase';
import type { MedicalRecordAttachment } from '@/types';

const BUCKET = 'medical-record-attachments';

export type PickedFile = { uri: string; name: string; mimeType: string };

export async function uploadRecordAttachment(
  patientId: string,
  recordId: string,
  file: PickedFile,
): Promise<MedicalRecordAttachment> {
  const uploadedAt = new Date().toISOString();
  if (!supabaseConfigured || !supabase) {
    return { name: file.name, path: '', type: file.mimeType, uploadedAt };
  }
  const path = `${patientId}/${recordId}/${Date.now()}-${file.name}`;
  const response = await fetch(file.uri);
  const blob = await response.blob();
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob as any, { contentType: file.mimeType });
  if (error) throw error;
  return { name: file.name, path, type: file.mimeType, uploadedAt };
}

export async function getAttachmentSignedUrl(path: string): Promise<string> {
  if (!supabaseConfigured || !supabase || !path) return '';
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/services/medicalRecordAttachments.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for `appendMedicalRecordAttachment`**

Append to `src/services/providerApi.test.ts`:

```typescript
describe('appendMedicalRecordAttachment', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.dontMock('@/lib/supabase');
  });

  it('appends the new attachment to the existing list rather than replacing it', async () => {
    const eqMock = jest.fn().mockResolvedValue({ error: null });
    const updateMock = jest.fn(() => ({ eq: eqMock }));
    const fromMock = jest.fn(() => ({ update: updateMock }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: fromMock }, supabasePublic: null, supabaseConfigured: true }));

    const { appendMedicalRecordAttachment: appendFresh } = require('./providerApi');
    const existing = [{ name: 'old.pdf', path: 'p/r/old.pdf', type: 'application/pdf', uploadedAt: '2026-01-01T00:00:00.000Z' }];
    const newOne = { name: 'new.jpg', path: 'p/r/new.jpg', type: 'image/jpeg', uploadedAt: '2026-06-01T00:00:00.000Z' };

    await appendFresh('rec-1', existing, newOne);

    expect(updateMock).toHaveBeenCalledWith({ attachments: [...existing, newOne] });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx jest src/services/providerApi.test.ts -t appendMedicalRecordAttachment`
Expected: FAIL — function not exported.

- [ ] **Step 7: Implement — add to `src/services/providerApi.ts`**

```typescript
export async function appendMedicalRecordAttachment(
  id: string,
  existing: MedicalRecordAttachment[],
  attachment: MedicalRecordAttachment,
): Promise<void> {
  if (useMock()) return;
  const { error } = await supabase!.from('medical_records').update({ attachments: [...existing, attachment] }).eq('id', id);
  if (error) throw error;
}
```

Add `MedicalRecordAttachment` to the `@/types` import at the top of the file.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx jest src/services/providerApi.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 9: Commit**

```bash
git add src/services/medicalRecordAttachments.ts src/services/medicalRecordAttachments.test.ts src/services/providerApi.ts src/services/providerApi.test.ts
git commit -m "feat: add medical record attachment upload via Supabase Storage"
```

---

### Task 10: Rewrite the "Dossiers" tab with real data

**Files:**
- Modify: `app/(provider)/records.tsx` (full rewrite)
- Modify: `app/(provider)/patients.tsx` (one line — see Step 2)

**Interfaces:**
- Consumes: `getPatients`, `getLatestRecordByPatient` (Tasks: existing, 8); `RECORD_KIND_META`
  (Task 3).

- [ ] **Step 1: Replace the full contents of `app/(provider)/records.tsx`**

```tsx
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search } from 'lucide-react-native';
import { Avatar, Card } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getPatients, getLatestRecordByPatient } from '@/services/providerApi';
import { RECORD_KIND_META } from '@/services/medicalRecordTaxonomy';
import { currentProvider } from '@/data/mockProvider';

export default function ProviderRecords() {
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;
  const [query, setQuery] = useState('');

  const { data: patients } = useAsync(() => getPatients(doctorId), [doctorId]);
  const { data: latestByPatient } = useAsync(() => getLatestRecordByPatient(doctorId), [doctorId]);

  const list = useMemo(
    () => (patients ?? []).filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(query.toLowerCase())),
    [patients, query],
  );

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-2">
        <Text className="font-serif-bold text-3xl text-ink mb-4" style={{ letterSpacing: -0.3 }}>
          Dossiers médicaux
        </Text>
        <View className="flex-row items-center border border-line rounded-2xl px-4 py-1 bg-surface">
          <Search color={colors.muted} size={18} />
          <TextInput
            placeholder="Rechercher un dossier..."
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            className="flex-1 ml-2 py-3 text-base text-ink"
            style={{ fontFamily: 'Mulish_400Regular' }}
          />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        {list.map((p) => {
          const last = latestByPatient?.get(p.id);
          const lastLabel = last ? `${RECORD_KIND_META[last.kind].label} · ${last.date}` : 'Aucun dossier pour le moment';
          return (
            <Pressable key={p.id} onPress={() => router.push(`/patient/${p.id}`)}>
              <Card className="mb-3 flex-row items-center">
                <Avatar initials={p.initials} size={44} tone="light" />
                <View className="flex-1 ml-3.5">
                  <Text className="font-sans-bold text-ink">
                    {p.firstName} {p.lastName}
                  </Text>
                  <Text className="font-sans text-xs text-muted mt-0.5">{lastLabel}</Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
        {list.length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center">Aucun patient pour le moment</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Wire the "Patients" tab's dead "Voir" button to the same screen**

`app/(provider)/patients.tsx`'s "Voir" button currently has no `onPress` at all — tapping it does
nothing (verified directly: the committed file has `<Pressable className="bg-accent-50 px-4 py-2.5
rounded-2xl">` with no handler). The unified-screen decision requires both tabs to reach the same
patient detail screen, so add the navigation. Change:

```tsx
<Pressable className="bg-accent-50 px-4 py-2.5 rounded-2xl">
  <Text className="text-accent font-sans-bold">Voir</Text>
</Pressable>
```

to:

```tsx
<Pressable onPress={() => router.push(`/patient/${p.id}`)} className="bg-accent-50 px-4 py-2.5 rounded-2xl">
  <Text className="text-accent font-sans-bold">Voir</Text>
</Pressable>
```

Add `import { router } from 'expo-router';` to that file's imports (it currently has none).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `app/(provider)/records.tsx` or `app/(provider)/patients.tsx`.
`app/patient/[id].tsx` errors remain expected until Task 11.

- [ ] **Step 4: Manual QA in the dev client (mock mode, no Supabase env needed)**

Run: `npx expo start`, open the app as a provider, go to the "Dossiers" tab.
Expected: 4 patients listed (from `mock.providerPatients`), each showing a real last-record label
(e.g. "Ordonnance · 10/06/2026") derived from the updated `mock.medicalRecords` fixture — not the
old hardcoded emoji strings. Tapping a row navigates to the patient detail screen. Also check the
"Patients" tab: tapping "Voir" on a patient now navigates to the same screen.

- [ ] **Step 5: Commit**

```bash
git add app/\(provider\)/records.tsx app/\(provider\)/patients.tsx
git commit -m "feat: replace mock Dossiers list with real patients + latest record"
```

---

### Task 11: Rewrite the patient detail screen into a real dossier

**Files:**
- Modify: `app/patient/[id].tsx` (full rewrite)
- Modify: `src/hooks/useAsync.ts:55` (one line — see Step 0; required for this screen's
  `useFocusEffect` to work correctly, not optional)

**Interfaces:**
- Consumes: `getPatient`, `getPatientConsultationHistory` (Tasks 6, 8); `getMedicalRecords`
  (Task 5); `RECORD_KIND_META`, `RECORD_KINDS` (Task 3).

- [ ] **Step 0: Memoize `useAsync`'s `reload` (prerequisite, found during Task 11's review)**

`useAsync.ts:55` currently returns `reload: () => setNonce((n) => n + 1)` — a fresh function on
every render, unlike `refresh` a few lines above it which IS wrapped in `useCallback(..., [])`.
This screen's `useFocusEffect(useCallback(() => { reloadPatient(); reloadRecords(); }, [reloadPatient,
reloadRecords]))` depends on `reloadPatient`/`reloadRecords` for its own memoization — with an
unstable `reload` reference, the outer `useCallback` never stabilizes either, so expo-router's
`useFocusEffect` internal effect re-runs on every render, and re-runs the reload on every visit to
this screen: an infinite reload loop on the single most common path through this feature (opening
any patient's dossier). Fix `useAsync.ts` to match `refresh`'s existing pattern:

```typescript
const reload = useCallback(() => setNonce((n) => n + 1), []);
```

(replacing the inline `reload: () => setNonce((n) => n + 1)` in the returned object with a plain
`reload,` referencing this memoized version). This is a pure, backward-compatible change — `reload`'s
behavior is identical, only its identity is now stable — and benefits every other screen using
`useAsync().reload()` today, not just this one.

- [ ] **Step 1: Replace the full contents of `app/patient/[id].tsx`**

```tsx
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { Avatar, Badge, Card, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAsync } from '@/hooks/useAsync';
import { getPatient, getPatientConsultationHistory } from '@/services/providerApi';
import { getMedicalRecords } from '@/services/patientApi';
import { currentProvider } from '@/data/mockProvider';
import { useAuth } from '@/contexts/AuthContext';
import { RECORD_KIND_META, RECORD_KINDS } from '@/services/medicalRecordTaxonomy';
import type { MedicalRecordKind } from '@/types';

export default function PatientProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;
  const [activeFilter, setActiveFilter] = useState('Tout');
  const [showArchived, setShowArchived] = useState(false);

  const { data: patient, reload: reloadPatient } = useAsync(() => getPatient(id), [id]);
  const { data: records, reload: reloadRecords } = useAsync(() => getMedicalRecords(id), [id]);
  const { data: consultations } = useAsync(() => getPatientConsultationHistory(doctorId, id), [doctorId, id]);

  useFocusEffect(
    useCallback(() => {
      reloadPatient();
      reloadRecords();
    }, [reloadPatient, reloadRecords]),
  );

  const kindFilters = useMemo(
    () => [
      { key: 'Tout', match: undefined as MedicalRecordKind | undefined },
      ...RECORD_KINDS.map((k) => ({ key: RECORD_KIND_META[k].label, match: k })),
    ],
    [],
  );

  const visibleRecords = useMemo(() => {
    const all = records ?? [];
    const byStatus = showArchived ? all : all.filter((r) => r.status !== 'inactive');
    const f = kindFilters.find((x) => x.key === activeFilter);
    if (!f?.match) return byStatus;
    return byStatus.filter((r) => r.kind === f.match);
  }, [records, activeFilter, showArchived, kindFilters]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pt-2 pb-2">
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} className="p-1 mr-2">
            <ChevronLeft color={colors.ink} size={26} />
          </Pressable>
          <Text className="font-sans-bold text-lg text-ink">Fiche patient</Text>
        </View>
        <Pressable
          onPress={() => router.push(`/patient/record-form?patientId=${id}`)}
          className="flex-row items-center bg-primary px-3.5 py-2 rounded-2xl"
        >
          <Plus color={colors.white} size={16} />
          <Text className="font-sans-bold text-white text-sm ml-1">Ajouter</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <View className="items-center mb-6">
          <Avatar initials={patient?.initials ?? '?'} size={80} tone="light" />
          <Text className="font-serif-bold text-2xl text-ink mt-3">
            {patient ? `${patient.firstName} ${patient.lastName}` : 'Patient'}
          </Text>
          {patient && (
            <Text className="font-sans text-sm text-muted mt-0.5">
              {patient.age !== null ? `${patient.age} ans` : 'Âge inconnu'}
              {patient.gender ? ` · ${patient.gender}` : ''}
              {patient.bloodType ? ` · ${patient.bloodType}` : ''}
            </Text>
          )}
          {patient?.allergiesSummary ? (
            <View className="mt-2 bg-red-50 px-3 py-1.5 rounded-full">
              <Text className="font-sans-bold text-xs text-danger">⚠ Allergies : {patient.allergiesSummary}</Text>
            </View>
          ) : null}
        </View>

        <SectionTitle>Historique médical</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
          {kindFilters.map((f) => {
            const on = f.key === activeFilter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActiveFilter(f.key)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{f.key}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable onPress={() => setShowArchived((s) => !s)} className="self-start mb-3">
          <Text className="font-sans-semibold text-xs text-muted underline">
            {showArchived ? 'Masquer les entrées archivées' : 'Afficher les entrées archivées'}
          </Text>
        </Pressable>

        {visibleRecords.length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center mb-6">
            <Text className="font-sans-semibold text-ink text-center">Aucun élément pour le moment</Text>
          </View>
        ) : (
          visibleRecords.map((r) => {
            const meta = RECORD_KIND_META[r.kind];
            return (
              <Pressable
                key={r.id}
                onPress={() => router.push(`/patient/record-form?patientId=${id}&recordId=${r.id}`)}
                style={{ opacity: r.status === 'inactive' ? 0.5 : 1 }}
              >
                <Card className="mb-3 flex-row items-center">
                  <View
                    className="w-11 h-11 rounded-2xl items-center justify-center mr-3"
                    style={{ backgroundColor: meta.color + '22' }}
                  >
                    <meta.icon color={meta.color} size={20} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-sans-bold" style={{ color: meta.color }}>
                      {meta.label}
                    </Text>
                    <Text className="font-sans-bold text-ink mt-0.5">{r.title}</Text>
                    <Text className="font-sans text-xs text-muted mt-0.5">{r.date}</Text>
                  </View>
                  {r.attachments.length > 0 ? <Badge label={`${r.attachments.length} pièce(s)`} tone="slate" /> : null}
                </Card>
              </Pressable>
            );
          })
        )}

        <SectionTitle>Historique des consultations</SectionTitle>
        {(consultations ?? []).length === 0 ? (
          <View className="bg-surface border border-line rounded-3xl p-6 items-center">
            <Text className="font-sans-semibold text-ink text-center">Aucune consultation pour le moment</Text>
          </View>
        ) : (
          (consultations ?? []).map((c) => (
            <Card key={c.id} className="mb-3">
              <Text className="font-sans-bold text-ink">{c.reason || 'Consultation'}</Text>
              <Text className="font-sans text-xs text-muted mt-0.5">{c.dateLabel}</Text>
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: only the pre-existing, unrelated `global.css` error remains (see ledger baseline) — every
error introduced by Task 2's type changes is now gone; this was the last file with a pending one.

- [ ] **Step 3: Manual QA in the dev client**

Open a patient from the "Dossiers" tab.
Expected: real name/age/gender header, allergy banner only when `allergiesSummary` is set, type
filter chips (9 kinds + "Tout"), "Afficher les entrées archivées" toggle hides `r5` (the mock
archived allergy entry from Task 5) by default and reveals it when tapped, "Historique des
consultations" section renders below.

- [ ] **Step 4: Commit**

```bash
git add app/patient/\[id\].tsx
git commit -m "feat: turn the patient detail screen into a real medical record viewer"
```

---

### Task 12: Add/edit-entry form screen

**Files:**
- Create: `app/patient/record-form.tsx`

**Interfaces:**
- Consumes: `createMedicalRecord`, `updateMedicalRecord`, `archiveMedicalRecord`,
  `appendMedicalRecordAttachment` (Tasks 7, 9); `uploadRecordAttachment` (Task 9); `getMedicalRecords`
  (Task 5); `RECORD_KIND_META`, `RECORD_KINDS` (Task 3).

- [ ] **Step 1: Create `app/patient/record-form.tsx`**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Button, Field, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { getMedicalRecords } from '@/services/patientApi';
import {
  archiveMedicalRecord,
  createMedicalRecord,
  updateMedicalRecord,
  appendMedicalRecordAttachment,
} from '@/services/providerApi';
import { uploadRecordAttachment, type PickedFile } from '@/services/medicalRecordAttachments';
import { RECORD_KIND_META, RECORD_KINDS } from '@/services/medicalRecordTaxonomy';
import { currentProvider } from '@/data/mockProvider';
import type { MedicalRecordKind, MedicalRecordSeverity } from '@/types';

export default function RecordForm() {
  const { patientId, recordId } = useLocalSearchParams<{ patientId: string; recordId?: string }>();
  const { user } = useAuth();
  const doctorId = user?.id ?? currentProvider.id;
  const isEdit = !!recordId;

  const { data: records } = useAsync(() => getMedicalRecords(patientId), [patientId]);
  const existing = useMemo(() => (records ?? []).find((r) => r.id === recordId), [records, recordId]);

  const [kind, setKind] = useState<MedicalRecordKind>('note');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState<MedicalRecordSeverity | undefined>(undefined);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [medicationName, setMedicationName] = useState('');
  const [dosage, setDosage] = useState('');
  const [frequency, setFrequency] = useState('');
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (existing && !hydrated) {
      setKind(existing.kind);
      setTitle(existing.title);
      setDescription(existing.description ?? '');
      setCategory(existing.category ?? '');
      setSeverity(existing.severity);
      setStartDate(existing.startDate ?? '');
      setEndDate(existing.endDate ?? '');
      setMedicationName(existing.metadata?.medication_name ?? '');
      setDosage(existing.metadata?.dosage ?? '');
      setFrequency(existing.metadata?.frequency ?? '');
      setHydrated(true);
    }
  }, [existing, hydrated]);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPickedFile({ uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg' });
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPickedFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/pdf' });
  };

  const buildMetadata = (): Record<string, string> => {
    if (kind !== 'prescription') return {};
    const m: Record<string, string> = {};
    if (medicationName) m.medication_name = medicationName;
    if (dosage) m.dosage = dosage;
    if (frequency) m.frequency = frequency;
    return m;
  };

  const onSave = async () => {
    if (!title.trim()) {
      setError('Le titre est obligatoire.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let id = recordId;
      if (isEdit && id) {
        await updateMedicalRecord(
          id,
          { doctorId, patientId, kind },
          {
            title,
            description: description || undefined,
            category: category || undefined,
            severity,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
            metadata: buildMetadata(),
          },
        );
      } else {
        const created = await createMedicalRecord({
          patientId,
          doctorId,
          kind,
          title,
          description: description || undefined,
          category: category || undefined,
          severity,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          metadata: buildMetadata(),
        });
        id = created.id;
      }
      if (pickedFile && id) {
        const attachment = await uploadRecordAttachment(patientId, id, pickedFile);
        await appendMedicalRecordAttachment(id, existing?.attachments ?? [], attachment);
      }
      router.back();
    } catch (e: any) {
      setError(e?.message ?? "Impossible d'enregistrer cette entrée. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  const onArchive = () => {
    if (!recordId) return;
    Alert.alert('Archiver cette entrée ?', 'Elle restera visible mais masquée par défaut.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Archiver',
        style: 'destructive',
        onPress: async () => {
          try {
            await archiveMedicalRecord(recordId, { doctorId, patientId, kind });
            router.back();
          } catch (e: any) {
            setError(e?.message ?? "Impossible d'archiver cette entrée.");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="flex-row items-center px-5 pt-2 pb-2">
        <Pressable onPress={() => router.back()} className="p-1 mr-2">
          <ChevronLeft color={colors.ink} size={26} />
        </Pressable>
        <Text className="font-sans-bold text-lg text-ink">{isEdit ? "Modifier l'entrée" : 'Nouvelle entrée'}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <SectionTitle>Type</SectionTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
          {RECORD_KINDS.map((k) => {
            const on = k === kind;
            return (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                className={`px-4 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>
                  {RECORD_KIND_META[k].label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Field label="Titre" value={title} onChangeText={setTitle} placeholder="Ex: Paracétamol 1g" />
        <Field label="Description" value={description} onChangeText={setDescription} placeholder="Détails (optionnel)" multiline />
        <Field label="Catégorie" value={category} onChangeText={setCategory} placeholder="Optionnel" />

        <Text className="text-sm font-sans-semibold text-ink mb-2">Gravité (optionnel)</Text>
        <View className="flex-row mb-4">
          {(
            [
              { key: undefined, label: 'Aucune' },
              { key: 'mild', label: 'Légère' },
              { key: 'moderate', label: 'Modérée' },
              { key: 'severe', label: 'Sévère' },
            ] as { key: MedicalRecordSeverity | undefined; label: string }[]
          ).map((opt) => {
            const on = opt.key === severity;
            return (
              <Pressable
                key={opt.label}
                onPress={() => setSeverity(opt.key)}
                className={`px-3.5 py-2 rounded-full mr-2 ${on ? 'bg-primary' : 'bg-surface border border-line'}`}
              >
                <Text className={`text-sm font-sans-semibold ${on ? 'text-white' : 'text-muted'}`}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {kind === 'prescription' ? (
          <>
            <SectionTitle>Détails de l'ordonnance</SectionTitle>
            <Field label="Médicament" value={medicationName} onChangeText={setMedicationName} />
            <Field label="Dosage" value={dosage} onChangeText={setDosage} placeholder="Ex: 500mg" />
            <Field label="Fréquence" value={frequency} onChangeText={setFrequency} placeholder="Ex: 3x/jour" />
          </>
        ) : null}

        <View className="flex-row">
          <Field label="Date de début" value={startDate} onChangeText={setStartDate} placeholder="AAAA-MM-JJ" className="flex-1 mr-2" />
          <Field label="Date de fin" value={endDate} onChangeText={setEndDate} placeholder="AAAA-MM-JJ" className="flex-1 ml-2" />
        </View>

        <SectionTitle>Pièce jointe</SectionTitle>
        <View className="flex-row mb-4">
          <Button label="Photo" variant="outline" onPress={pickPhoto} className="flex-1 mr-2" />
          <Button label="Fichier PDF" variant="outline" onPress={pickDocument} className="flex-1 ml-2" />
        </View>
        {pickedFile ? <Text className="font-sans text-sm text-muted mb-4">Sélectionné : {pickedFile.name}</Text> : null}
        {(existing?.attachments ?? []).map((a) => (
          <Text key={a.path} className="font-sans text-sm text-muted mb-1">
            📎 {a.name}
          </Text>
        ))}

        {error ? <Text className="font-sans-semibold text-sm text-danger mb-4">{error}</Text> : null}

        <Button label="Enregistrer" onPress={onSave} loading={saving} className="mb-3" />
        {isEdit ? <Button label="Archiver" variant="outline" onPress={onArchive} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Manual QA — create flow**

In the dev client, open a patient, tap "Ajouter", pick "Ordonnance", fill title + medication
fields, tap "Enregistrer".
Expected: returns to the patient screen (via `useFocusEffect` from Task 11), the new entry appears
at the top of "Historique médical" with the "Ordonnance" badge.

- [ ] **Step 4: Manual QA — edit flow and the metadata-leak review point**

Tap the entry just created (still `prescription`), change its type to "Note", change the title,
save. Reopen it.
Expected: it now shows as "Note" with the new title, and switching it back to "Ordonnance" shows
empty medication/dosage/frequency fields (not the old ones) — confirms `buildMetadata()` doesn't
leak stale prescription data across type switches (Review Focus item 5).

- [ ] **Step 5: Manual QA — attachment ordering**

Create a new entry of any type, pick a photo, save.
Expected: no error about a missing record — confirms the create-then-upload sequencing in `onSave`
(Review Focus item 3). If Supabase is configured against the real project, verify in the Storage
browser that the file landed under `{patientId}/{recordId}/...`.

- [ ] **Step 6: Manual QA — archive**

Open an existing entry, tap "Archiver", confirm.
Expected: back on the patient screen, the entry is gone from the default view and reappears
(dimmed) when "Afficher les entrées archivées" is toggled on.

- [ ] **Step 7: Commit**

```bash
git add app/patient/record-form.tsx
git commit -m "feat: add the medical record create/edit form with attachments"
```

---

## After all tasks

Run the full suite once more before opening a PR:

```bash
npx jest
npx tsc --noEmit
```

Expected: all tests pass, no type errors beyond the pre-existing `global.css` one (see ledger
baseline). Then do one full manual pass through the "Dossiers" tab
→ patient → add/edit/archive → back, in the dev client, before considering this feature done — no
automated screen-render tests exist in this repo for this iteration (see spec).
