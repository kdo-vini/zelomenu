import { useId } from 'react';
import { Clock3, ExternalLink, MapPin, MessageCircle, Truck, X } from 'lucide-react';
import { Modal } from '../Modal';
import { formatEstimatedDeliveryMinutes } from '../../domain/deliverySettings';
import { formatNextOpenDay } from '../../domain/businessHours';
import type { StorefrontOperationKey } from '../../domain/storefrontOperations';
import type { ZeloMenuPublicStoreResponse } from '../../services/zelomenuApi';

type StorefrontOperationSheetProps = {
  operation: StorefrontOperationKey | null;
  business: ZeloMenuPublicStoreResponse['business'];
  onClose: () => void;
};

const dayLabels: Record<string, string> = {
  sun: 'Domingo',
  mon: 'Segunda-feira',
  tue: 'Terça-feira',
  wed: 'Quarta-feira',
  thu: 'Quinta-feira',
  fri: 'Sexta-feira',
  sat: 'Sábado',
};

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function formatAddressSearch(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function StorefrontOperationSheet({ operation, business, onClose }: StorefrontOperationSheetProps) {
  const titleId = useId();
  const hours = business.businessHours;
  const open = operation !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      titleId={titleId}
      containerClassName="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      backdropClassName="absolute inset-0 bg-black/60"
      panelLayoutClassName="w-full sm:max-w-lg"
      panelClassName="max-h-[min(86vh,720px)] overflow-hidden rounded-t-3xl bg-[var(--zm-surface)] shadow-2xl sm:rounded-3xl"
    >
      <div className="flex max-h-[min(86vh,720px)] flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--zm-line)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--zm-brand-soft)] text-[var(--zm-brand-deep)]">
              {operation === 'hours' ? <Clock3 className="h-5 w-5" aria-hidden="true" /> : null}
              {operation === 'fulfillment' ? <Truck className="h-5 w-5" aria-hidden="true" /> : null}
              {operation === 'information' ? <MapPin className="h-5 w-5" aria-hidden="true" /> : null}
            </span>
            <div>
              <h2 id={titleId} className="text-[17px] font-bold text-[var(--zm-ink)]">
                {operation === 'hours' ? 'Horários de funcionamento' : null}
                {operation === 'fulfillment' ? (business.deliveryEnabled ? 'Entrega' : 'Retirada') : null}
                {operation === 'information' ? 'Informações da loja' : null}
              </h2>
              <p className="text-[12px] text-[var(--zm-ink-soft)]">{business.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--zm-ink-soft)] hover:bg-[var(--zm-canvas)]" aria-label="Fechar informações">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          {operation === 'hours' ? (
            <div className="space-y-4">
              <div className={`rounded-2xl border px-4 py-3 ${hours?.openNow ? 'border-[var(--zm-brand)]/30 bg-[var(--zm-brand-soft)]' : 'border-[var(--color-warn)]/40 bg-[var(--color-warn-soft)]'}`}>
                <p className="text-[14px] font-bold text-[var(--zm-ink)]">
                  {!hours?.configured ? 'Horário não informado' : hours.openNow ? 'Aberto agora' : 'Fechado no momento'}
                </p>
                <p className="mt-1 text-[13px] text-[var(--zm-ink-soft)]">
                  {hours?.openNow && hours.label ? hours.label : null}
                  {!hours?.openNow && hours?.nextOpen ? `Abre ${formatNextOpenDay(hours.nextOpen.day, hours.timezone)} às ${hours.nextOpen.start}.` : null}
                  {hours?.configured && !hours.openNow && !hours.nextOpen ? 'Confira a programação abaixo.' : null}
                </p>
              </div>
              {hours?.configured ? (
                <div className="space-y-2">
                  {Object.entries(hours.weeklySchedule ?? {}).map(([day, windows]) => (
                    <div key={day} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--zm-line)] bg-[var(--zm-canvas)] px-3.5 py-3">
                      <span className="text-[13px] font-semibold text-[var(--zm-ink)]">{dayLabels[day] ?? day}</span>
                      <span className="text-right text-[12px] text-[var(--zm-ink-soft)]">
                        {Array.isArray(windows) && windows.length > 0 ? windows.map((window) => `${window.start} às ${window.end}`).join(' · ') : 'Fechado'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] leading-relaxed text-[var(--zm-ink-soft)]">A loja ainda não publicou os horários. Confirme a disponibilidade antes de finalizar o pedido.</p>
              )}
            </div>
          ) : null}

          {operation === 'fulfillment' ? (
            <div className="space-y-4">
              {business.deliveryEnabled ? (
                <>
                  <div className="rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-canvas)] px-4 py-3">
                    <p className="text-[12px] font-semibold text-[var(--zm-ink-soft)]">Tempo estimado</p>
                    <p className="mt-1 text-[18px] font-bold text-[var(--zm-ink)]">{formatEstimatedDeliveryMinutes(business.deliveryEstimatedMinutes) ?? 'Prazo a confirmar'}</p>
                  </div>
                  {business.deliveryNeighborhoods.length > 0 ? (
                    <div>
                      <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-[var(--zm-ink-soft)]">Taxas por região</h3>
                      <div className="overflow-hidden rounded-2xl border border-[var(--zm-line)]">
                        {business.deliveryNeighborhoods.map((region) => (
                          <div key={`${region.name}-${region.fee}`} className="flex items-center justify-between gap-4 border-b border-[var(--zm-line)] bg-[var(--zm-surface)] px-4 py-3 last:border-b-0">
                            <span className="text-[13px] font-semibold text-[var(--zm-ink)]">{region.name}</span>
                            <span className="text-[13px] font-bold text-[var(--zm-brand-deep)]">{region.fee.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-[var(--zm-ink-soft)]">A taxa é calculada ao informar o endereço no pedido.</p>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-canvas)] px-4 py-4">
                  <p className="text-[14px] font-bold text-[var(--zm-ink)]">Atendimento no local</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--zm-ink-soft)]">Esta loja não oferece entrega pelo cardápio. Escolha retirada no local ao montar o pedido.</p>
                </div>
              )}
            </div>
          ) : null}

          {operation === 'information' ? (
            <div className="space-y-3">
              {business.description ? (
                <div className="rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-canvas)] px-4 py-4">
                  <h3 className="text-[14px] font-bold text-[var(--zm-ink)]">Sobre a loja</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--zm-ink-soft)]">{business.description}</p>
                </div>
              ) : null}
              {business.address ? (
                <div className="rounded-2xl border border-[var(--zm-line)] bg-[var(--zm-canvas)] px-4 py-4">
                  <div className="flex gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[var(--zm-brand)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-bold text-[var(--zm-ink)]">Endereço</h3>
                      <p className="mt-1 text-[13px] leading-relaxed text-[var(--zm-ink-soft)]">{business.address}</p>
                      <a href={formatAddressSearch(business.address)} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--zm-line-strong)] px-3.5 text-[13px] font-semibold text-[var(--zm-ink)] hover:border-[var(--zm-brand)]">
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        Como chegar
                      </a>
                    </div>
                  </div>
                </div>
              ) : null}
              {business.whatsapp ? (
                <a href={`https://wa.me/${normalizePhone(business.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-emerald-700 hover:border-emerald-500">
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                  <span>
                    <strong className="block text-[14px]">Falar no WhatsApp</strong>
                    <span className="text-[12px]">Tire dúvidas antes de pedir</span>
                  </span>
                </a>
              ) : null}
              {!business.address && !business.whatsapp ? <p className="text-[13px] text-[var(--zm-ink-soft)]">A loja ainda não publicou endereço ou contato.</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
