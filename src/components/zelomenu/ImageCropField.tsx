import { useEffect, useState, type ChangeEvent } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Check, ImagePlus, Loader2, Maximize2, Trash2, X } from 'lucide-react';

type ImageCropFieldProps = {
  value: string | null;
  busy?: boolean;
  aspect?: number;
  onChange: (file: File) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  onError: (message: string) => void;
};

export function ImageCropField({
  value,
  busy = false,
  aspect = 1,
  onChange,
  onRemove,
  onError,
}: ImageCropFieldProps) {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  function closeCropper() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceFile(null);
    setSourceUrl(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError('Envie uma imagem em PNG, JPG, WEBP ou formato compatível.');
      return;
    }
    if (file.type === 'image/gif') {
      void onChange(file);
      return;
    }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
  }

  async function useWholeImage() {
    if (!sourceFile) return;
    setProcessing(true);
    try {
      await onChange(sourceFile);
      closeCropper();
    } catch {
      onError('Não foi possível preparar a imagem.');
    } finally {
      setProcessing(false);
    }
  }

  async function useCrop() {
    if (!sourceFile || !sourceUrl || !croppedArea) return;
    setProcessing(true);
    try {
      const file = await cropImage(sourceUrl, croppedArea, sourceFile, aspect);
      await onChange(file);
      closeCropper();
    } catch {
      onError('Não foi possível recortar a imagem.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)]">
          <ImagePlus className="h-4 w-4" />
          {value ? 'Trocar imagem' : 'Enviar imagem'}
          <input type="file" accept="image/*" className="sr-only" onChange={handleSelect} disabled={busy} />
        </label>
        {value ? (
          <button
            type="button"
            onClick={() => void onRemove()}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Remover foto
          </button>
        ) : null}
      </div>

      {value ? (
        <div className="flex aspect-square max-w-[240px] items-center justify-center overflow-hidden rounded-xl bg-[var(--color-canvas)] p-2">
          <img src={value} alt="Prévia da foto do produto" className="h-full w-full object-contain" />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-muted)] px-4 py-8 text-center text-xs text-[var(--color-ink-muted)]">
          Nenhuma foto selecionada.
        </div>
      )}

      {sourceFile && sourceUrl ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4">
          <div className="w-full overflow-hidden rounded-t-2xl bg-[var(--color-surface)] sm:max-w-lg sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
              <div>
                <h4 className="text-sm font-bold text-[var(--color-ink)]">Ajustar foto</h4>
                <p className="text-xs text-[var(--color-ink-muted)]">Arraste e aproxime para enquadrar a foto.</p>
              </div>
              <button type="button" onClick={closeCropper} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-[var(--color-surface-muted)]" aria-label="Fechar ajuste de foto">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative aspect-square max-h-[55dvh] bg-[var(--color-ink)]">
              <Cropper
                image={sourceUrl}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setCroppedArea(pixels)}
                showGrid={false}
              />
            </div>

            <div className="space-y-4 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4">
              <label className="flex items-center gap-3">
                <Maximize2 className="h-4 w-4 text-[var(--color-ink-muted)]" />
                <span className="sr-only">Zoom</span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="w-full"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void useWholeImage()}
                  disabled={processing}
                  className="min-h-[44px] rounded-xl border border-[var(--color-line-strong)] px-4 text-sm font-semibold text-[var(--color-ink-soft)] disabled:opacity-50"
                >
                  Usar imagem inteira
                </button>
                <button
                  type="button"
                  onClick={() => void useCrop()}
                  disabled={processing || !croppedArea}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Aplicar recorte
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

async function cropImage(sourceUrl: string, area: Area, sourceFile: File, aspect: number = 1): Promise<File> {
  const image = await loadImage(sourceUrl);
  const w = Math.min(1600, Math.max(1, Math.round(area.width)));
  const h = Math.min(1600, Math.max(1, Math.round(w / aspect)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas indisponível.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    w,
    h,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('Falha ao gerar imagem.');
  const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'produto';
  return new File([blob], `${baseName}-recortada.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Falha ao carregar imagem.'));
    image.src = url;
  });
}
