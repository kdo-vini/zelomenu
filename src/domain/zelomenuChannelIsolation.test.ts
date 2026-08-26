import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ZELOMENU_UI_FILES = [
  new URL('../components/views/CatalogView.tsx', import.meta.url),
  new URL('../components/views/catalog/ProductEditorModal.tsx', import.meta.url),
];

describe('ZeloMenu channel isolation', () => {
  it('does not expose the PDV-only visibility field in the digital-menu UI', () => {
    for (const file of ZELOMENU_UI_FILES) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain('ocultar_no_pdv');
      expect(source).not.toContain('Ocultar no PDV');
      expect(source).not.toContain('Visível no PDV');
    }
  });
});
