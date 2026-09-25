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
