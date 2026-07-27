import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { enablePushNotifications, getPushStatus } from '../../services/pushNotifications.ts';

interface PushNotificationButtonProps {
  variant?: 'header' | 'mobile' | 'order';
  orderId?: string;
  cartToken?: string;
}

type PushStatus = 'unsupported' | 'disabled' | 'enabled' | 'blocked' | 'loading' | 'error';

export function PushNotificationButton({ variant = 'header', orderId, cartToken }: PushNotificationButtonProps) {
  const [status, setStatus] = useState<PushStatus>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    getPushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);

  if (status === 'unsupported') return null;

  async function handleClick() {
    if (status === 'enabled') return;
    setStatus('loading');
    setMessage('');
    try {
      await enablePushNotifications({ orderId, cartToken });
      setStatus('enabled');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Não foi possível ativar agora.');
    }
  }

  const active = status === 'enabled';
  const blocked = status === 'blocked';
  const label = active ? 'Notificações ativas' : blocked ? 'Notificações bloqueadas' : 'Ativar notificações';
  const className = variant === 'order'
    ? 'mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--zm-brand-soft)] bg-[var(--zm-brand-soft)] px-4 text-[13px] font-semibold text-[var(--zm-brand-deep)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60'
    : variant === 'mobile'
    ? 'home-button home-button--secondary'
    : 'home-button home-button--ghost home-header__notifications';

  return (
    <span className="home-notifications">
      <button type="button" className={className} onClick={() => void handleClick()} disabled={active || blocked || status === 'loading'} aria-label={label} title={message || label}>
        {active ? <BellRing size={16} strokeWidth={2.4} /> : <Bell size={16} strokeWidth={2.4} />}
        {variant === 'order'
          ? active ? 'Atualizações ativas' : 'Receber atualizações do pedido'
          : variant === 'mobile' ? label : null}
      </button>
      {status === 'error' && message ? <span className="home-notifications__message" role="status">{message}</span> : null}
    </span>
  );
}
