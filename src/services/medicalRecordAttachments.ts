import { supabase, supabaseConfigured } from '@/lib/supabase';
import type { MedicalRecordAttachment } from '@/types';

const BUCKET = 'medical-record-attachments';

export type PickedFile = { uri: string; name: string; mimeType: string };

/**
 * Nettoie un nom de fichier avant de l'interpoler dans une clé Storage : espaces, accents
 * et surtout `/` produiraient sinon une clé inattendue (ou un sous-dossier involontaire).
 * Le nom d'origine reste conservé tel quel dans `attachments.name` pour l'affichage.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'fichier';
}

export async function uploadRecordAttachment(
  patientId: string,
  recordId: string,
  file: PickedFile,
): Promise<MedicalRecordAttachment> {
  const uploadedAt = new Date().toISOString();
  if (!supabaseConfigured || !supabase) {
    return { name: file.name, path: '', type: file.mimeType, uploadedAt };
  }
  const path = `${patientId}/${recordId}/${Date.now()}-${sanitizeFileName(file.name)}`;
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
