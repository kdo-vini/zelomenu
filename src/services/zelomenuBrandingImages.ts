import {
  buildZeloMenuBrandingImagePath,
  getOwnedZeloMenuBrandingImagePath,
  ZELOMENU_BRANDING_IMAGE_BUCKET,
} from '../domain/zelomenuBrandingImages';
import { compressImage } from './imageCompress';
import { supabase } from './supabaseClient';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export async function uploadOwnedZeloMenuBrandingImage(
  userId: string,
  kind: 'logo' | 'cover',
  file: File,
  previousUrl?: string | null,
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Envie uma imagem em PNG, JPG, WEBP ou formato compatível.');
  }

  const compressedFile = await compressImage(file);
  if (compressedFile.size > MAX_UPLOAD_BYTES) {
    throw new Error('Imagem muito grande. Use um arquivo de até 3 MB.');
  }

  const objectPath = buildZeloMenuBrandingImagePath(userId, kind, compressedFile.name);
  const { error: uploadError } = await supabase.storage
    .from(ZELOMENU_BRANDING_IMAGE_BUCKET)
    .upload(objectPath, compressedFile, { upsert: false });
  if (uploadError) throw new Error('Não consegui enviar a imagem.');

  const { data } = supabase.storage.from(ZELOMENU_BRANDING_IMAGE_BUCKET).getPublicUrl(objectPath);
  const previousPath = getOwnedZeloMenuBrandingImagePath(previousUrl);
  if (previousPath && previousPath !== objectPath) {
    await supabase.storage.from(ZELOMENU_BRANDING_IMAGE_BUCKET).remove([previousPath]);
  }
  return data.publicUrl;
}

export async function deleteOwnedZeloMenuBrandingImage(url: string | null | undefined): Promise<void> {
  const objectPath = getOwnedZeloMenuBrandingImagePath(url);
  if (!objectPath) return;
  const { error } = await supabase.storage.from(ZELOMENU_BRANDING_IMAGE_BUCKET).remove([objectPath]);
  if (error) throw new Error('Não consegui remover a imagem anterior.');
}
