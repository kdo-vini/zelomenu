import { useEffect, useState, useCallback } from 'react';
import { Download } from 'lucide-react';

interface PwaInstallButtonProps {
  variant?: 'header' | 'mobile';
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaInstallButton({ variant = 'header' }: PwaInstallButtonProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Detect iOS Safari (no beforeinstallprompt)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) setShowIOSHint(true);

    const installedHandler = () => setDeferredPrompt(null);
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === 'accepted') setDeferredPrompt(null);
    }
    if (showIOSHint) setShowIOSHint(false);
  }, [deferredPrompt, showIOSHint]);

  const button = (
    <button
      type="button"
      className={variant === 'mobile' ? 'home-button home-button--primary' : 'home-button home-button--ghost home-header__pwa'}
      onClick={handleInstall}
      aria-label="Instalar aplicativo"
    >
      <Download size={16} strokeWidth={2.5} />
      Instalar
    </button>
  );

  return (
    <>
      {deferredPrompt || showIOSHint ? button : null}
      {showIOSHint ? (
        <dialog className="home-pwa-modal" open={showIOSHint} onClick={() => setShowIOSHint(false)}>
          <div className="home-pwa-modal__content" onClick={(e) => e.stopPropagation()}>
            <strong>Adicione o ZeloMenu à tela inicial.</strong>
            <p className="home-pwa-modal__intro">No iPhone e iPad, use o menu Compartilhar do Safari para instalar o app.</p>
            <ol>
              <li>Toque em <strong>Compartilhar</strong> <span aria-hidden="true">⎙</span></li>
              <li>Role até <strong>Adicionar à Tela de Início</strong></li>
              <li>Confirme e pronto! <span aria-hidden="true">✓</span></li>
            </ol>
            <button type="button" className="home-button home-button--secondary" onClick={() => setShowIOSHint(false)}>
              Entendi
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
