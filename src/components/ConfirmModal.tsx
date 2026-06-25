import { type ReactNode, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Modal, useModalTitleId } from './Modal';

type Props = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  confirmLabel?: string;
  confirmLoadingLabel?: string;
  destructive?: boolean;
  helperContent?: ReactNode;
};

export function ConfirmModal({
  open,
  title,
  message,
  onClose,
  onConfirm,
  confirmLabel = 'Confirmar',
  confirmLoadingLabel = 'Aguarde...',
  destructive = true,
  helperContent,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const titleId = useModalTitleId();

  useEffect(() => {
    if (open) setErr(null);
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    if (!loading) onClose();
  };

  const handleConfirm = async () => {
    setLoading(true);
    setErr(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ocorreu um erro. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      titleId={titleId}
      disableEscape={loading}
      containerClassName="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      backdropClassName="zm-backdrop absolute inset-0 bg-black/45 backdrop-blur-[1px]"
      panelLayoutClassName="w-full sm:max-w-md"
      panelClassName="zm-sheet rounded-t-2xl bg-[var(--color-surface)] shadow-xl sm:rounded-2xl"
    >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 pb-4 pt-3 sm:pt-4">
          <h3 id={titleId} className="text-[17px] font-bold text-[var(--color-ink)] sm:text-base">{title}</h3>
          <button
            onClick={handleClose}
            disabled={loading}
            className="-mr-1 -mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink-soft)]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-5 [padding-bottom:env(safe-area-inset-bottom)]">
          <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">{message}</p>
          {helperContent ? <div className="mt-3">{helperContent}</div> : null}
          {err && <p className="mt-2 text-xs text-[var(--color-alert)]">{err}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="min-h-[44px] rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] disabled:opacity-50 sm:min-h-0 sm:py-2"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={`min-h-[44px] rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:bg-[var(--color-line-strong)] sm:min-h-0 sm:py-2 ${
                destructive ? 'bg-[var(--color-alert)] hover:brightness-95' : 'bg-[var(--color-brand)] hover:bg-[var(--color-brand-deep)]'
              }`}
            >
              {loading ? confirmLoadingLabel : confirmLabel}
            </button>
          </div>
        </div>
    </Modal>
  );
}
