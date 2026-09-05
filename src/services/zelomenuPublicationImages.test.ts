import { beforeEach, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  upload: vi.fn(), remove: vi.fn(), getPublicUrl: vi.fn(),
}));
vi.mock('./supabaseClient', () => ({ supabase: { storage: { from: () => storage } } }));
vi.mock('./imageCompress', () => ({ compressImage: async (file: File) => file }));
import { uploadOwnedZeloMenuPublicationImage } from './zelomenuPublicationImages';

beforeEach(() => {
  vi.clearAllMocks();
  storage.upload.mockResolvedValue({ error: null });
  storage.remove.mockResolvedValue({ error: null });
  storage.getPublicUrl.mockImplementation((path: string) => ({ data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/logos/${path}` } }));
});

it('keeps the published image while its replacement is only an uploaded draft', async () => {
  const previous = 'https://test.supabase.co/storage/v1/object/public/logos/zelomenu-products/owner/1-old.jpg';
  const uploaded = await uploadOwnedZeloMenuPublicationImage('owner', 1, new File(['image'], 'new.jpg', { type: 'image/jpeg' }), previous);
  expect(uploaded).not.toBe(previous);
  expect(storage.upload).toHaveBeenCalledOnce();
  expect(storage.remove).not.toHaveBeenCalled();
});
