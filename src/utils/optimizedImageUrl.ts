interface ImageTransformOptions {
  width: number;
  height?: number;
  quality?: number;
}

const PUBLIC_OBJECT_PATH = '/storage/v1/object/public/';
const PUBLIC_RENDER_PATH = '/storage/v1/render/image/public/';

/** Uses Supabase Image Transformations for public storage objects. */
export function optimizedImageUrl(
  source: string | null | undefined,
  options: ImageTransformOptions,
): string | null {
  if (!source) return null;

  try {
    const url = new URL(source, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    const objectIndex = url.pathname.indexOf(PUBLIC_OBJECT_PATH);
    if (objectIndex === -1) return source;

    url.pathname = `${url.pathname.slice(0, objectIndex)}${PUBLIC_RENDER_PATH}${url.pathname.slice(objectIndex + PUBLIC_OBJECT_PATH.length)}`;
    url.searchParams.set('width', String(options.width));
    if (options.height) url.searchParams.set('height', String(options.height));
    url.searchParams.set('resize', 'cover');
    url.searchParams.set('quality', String(options.quality ?? 72));
    url.searchParams.set('format', 'webp');
    return url.toString();
  } catch {
    return source;
  }
}
