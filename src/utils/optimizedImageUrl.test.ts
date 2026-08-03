import { describe, expect, it } from 'vitest';
import { optimizedImageUrl } from './optimizedImageUrl.ts';

describe('optimizedImageUrl', () => {
  it('converts public Supabase objects to resized WebP renders', () => {
    const result = optimizedImageUrl(
      'https://project.supabase.co/storage/v1/object/public/logos/business-cover.png',
      { width: 640, height: 426, quality: 70 },
    );

    const url = new URL(result!);
    expect(url.pathname).toBe('/storage/v1/render/image/public/logos/business-cover.png');
    expect(url.searchParams.get('width')).toBe('640');
    expect(url.searchParams.get('height')).toBe('426');
    expect(url.searchParams.get('resize')).toBe('cover');
    expect(url.searchParams.get('quality')).toBe('70');
    expect(url.searchParams.get('format')).toBe('webp');
  });

  it('leaves local and unrelated URLs untouched', () => {
    expect(optimizedImageUrl('/assets/hero/zelomenu-hero.webp', { width: 640 })).toBe('/assets/hero/zelomenu-hero.webp');
    expect(optimizedImageUrl(null, { width: 640 })).toBeNull();
  });
});
