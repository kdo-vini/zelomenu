import { formatEstimatedDeliveryMinutes } from './deliverySettings';
import { formatNextOpenDay } from './businessHours';
import type { ZeloMenuPublicBusinessHoursStatus } from '../services/zelomenuApi';

export type StorefrontOperationKey = 'hours' | 'fulfillment' | 'information';

export type StorefrontOperationAction = {
  key: StorefrontOperationKey;
  title: string;
  summary: string;
  tone: 'positive' | 'neutral' | 'warning';
};

export type StorefrontOperationsBusiness = {
  address: string;
  deliveryEnabled: boolean;
  deliveryEstimatedMinutes: number | null;
  businessHours?: ZeloMenuPublicBusinessHoursStatus;
  whatsapp?: string | null;
};

function buildHoursAction(hours: ZeloMenuPublicBusinessHoursStatus | undefined): StorefrontOperationAction {
  if (!hours?.configured) {
    return { key: 'hours', title: 'Horários', summary: 'Horário não informado', tone: 'neutral' };
  }

  if (hours.openNow) {
    return { key: 'hours', title: 'Aberto agora', summary: hours.label || 'Consulte os horários', tone: 'positive' };
  }

  const nextOpen = hours.nextOpen
    ? `Abre ${formatNextOpenDay(hours.nextOpen.day, hours.timezone)} às ${hours.nextOpen.start}`
    : 'Fechado no momento';
  return { key: 'hours', title: 'Fechado', summary: nextOpen, tone: 'warning' };
}

export function buildStorefrontOperations(
  business: StorefrontOperationsBusiness,
): StorefrontOperationAction[] {
  const deliverySummary = business.deliveryEnabled
    ? formatEstimatedDeliveryMinutes(business.deliveryEstimatedMinutes) ?? 'Prazo a confirmar'
    : 'Peça no local';

  return [
    buildHoursAction(business.businessHours),
    {
      key: 'fulfillment',
      title: business.deliveryEnabled ? 'Entrega' : 'Retirada',
      summary: deliverySummary,
      tone: business.deliveryEnabled && business.deliveryEstimatedMinutes ? 'positive' : 'neutral',
    },
    {
      key: 'information',
      title: 'Informações',
      summary: business.address || business.whatsapp ? 'Endereço e contato' : 'Detalhes da loja',
      tone: 'neutral',
    },
  ];
}
