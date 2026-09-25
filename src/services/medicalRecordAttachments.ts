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
