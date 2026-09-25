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
