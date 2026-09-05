export type ZeloMenuCheckoutDetails = {
  customerName: string | null | undefined;
  customerPhone: string | null | undefined;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryMode?: 'distance' | 'neighborhood';
  deliveryAddress: string | null | undefined;
  deliveryStreet?: string | null | undefined;
  deliveryNumber?: string | null | undefined;
  deliveryNeighborhood?: string | null | undefined;
  pickupDate: string | null | undefined;
  pickupTime: string | null | undefined;
};

export type ZeloMenuCheckoutField =
  | 'customerName'
  | 'customerPhone'
  | 'deliveryAddress'
  | 'deliveryStreet'
  | 'deliveryNumber'
  | 'deliveryNeighborhood'
  | 'pickupDate'
  | 'pickupTime';

export type ZeloMenuCheckoutErrors = Partial<Record<ZeloMenuCheckoutField, string>>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealCivilDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidBrazilianPhone(value: string | null | undefined): boolean {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!/^\d{10,11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99 || digits.slice(2).startsWith('0')) return false;
  return digits.length !== 11 || digits[2] === '9';
}

export function validateZeloMenuCheckoutDetails(
  details: ZeloMenuCheckoutDetails,
): ZeloMenuCheckoutErrors {
  const errors: ZeloMenuCheckoutErrors = {};

  if (!(details.customerName ?? '').trim()) {
    errors.customerName = 'Informe seu nome.';
  }
  if (!isValidBrazilianPhone(details.customerPhone)) {
    errors.customerPhone = 'Informe um WhatsApp válido com DDD.';
  }
  if (
    details.fulfillmentType === 'delivery'
    && details.deliveryMode !== 'neighborhood'
    && !(details.deliveryAddress ?? '').trim()
  ) {
    errors.deliveryAddress = 'Informe o endereço da entrega.';
  }
  if (details.fulfillmentType === 'delivery' && details.deliveryMode === 'neighborhood') {
    if (!(details.deliveryStreet ?? '').trim()) errors.deliveryStreet = 'Informe a rua.';
    if (!(details.deliveryNumber ?? '').trim()) errors.deliveryNumber = 'Informe o número.';
    if (!(details.deliveryNeighborhood ?? '').trim()) errors.deliveryNeighborhood = 'Escolha um bairro.';
  }
  if (!isRealCivilDate((details.pickupDate ?? '').trim())) {
    errors.pickupDate = 'Informe a data.';
  }
  if (!TIME_PATTERN.test((details.pickupTime ?? '').trim())) {
    errors.pickupTime = 'Informe o horário.';
  }

  return errors;
}

export function firstZeloMenuCheckoutError(
  errors: ZeloMenuCheckoutErrors,
): string | null {
  return (
    errors.customerName
    ?? errors.customerPhone
    ?? errors.deliveryAddress
    ?? errors.deliveryStreet
    ?? errors.deliveryNumber
    ?? errors.deliveryNeighborhood
    ?? errors.pickupDate
    ?? errors.pickupTime
    ?? null
  );
}
