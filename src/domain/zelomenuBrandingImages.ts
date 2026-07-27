export const ZELOMENU_BRANDING_IMAGE_BUCKET = 'logos';
export const ZELOMENU_BRANDING_IMAGE_PREFIX = 'zelomenu-branding';

function sanitizeFileName(fileName: string): string {
  const safe = fileName.trim().toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return safe || 'imagem.jpg';
}

export function buildZeloMenuBrandingImagePath(userId: string, kind: 'logo' | 'cover', fileName: string): string {
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${ZELOMENU_BRANDING_IMAGE_PREFIX}/${userId}/${kind}-${unique}-${sanitizeFileName(fileName)}`;
}

export function getOwnedZeloMenuBrandingImagePath(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${ZELOMENU_BRANDING_IMAGE_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    const objectPath = decodeURIComponent(parsed.pathname.slice(index + marker.length));
    return objectPath.startsWith(`${ZELOMENU_BRANDING_IMAGE_PREFIX}/`) ? objectPath : null;
  } catch {
    return null;
  }
}
