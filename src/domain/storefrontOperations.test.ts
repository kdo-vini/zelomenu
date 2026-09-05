import { describe, expect, it } from 'vitest';
import { buildStorefrontOperations } from './storefrontOperations';

const baseBusiness = {
  name: 'Casa dos Salgados',
  address: 'Rua de teste, 100',
  pixEnabled: true,
  deliveryEnabled: true,
  deliveryEstimatedMinutes: 40,
  deliveryNeighborhoods: [{ name: 'Centro', fee: 8 }],
  whatsapp: '5514999999999',
};

describe('buildStorefrontOperations', () => {
  it('descreve uma loja aberta com prazo de entrega', () => {
    const actions = buildStorefrontOperations({
      ...baseBusiness,
      businessHours: {
        configured: true,
        openNow: true,
        label: 'Fecha às 23:00',
        timezone: 'America/Sao_Paulo',
        weeklySchedule: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
        schedulingEnabled: false,
        schedulingLeadTimeMinutes: 0,
      },
    });

    expect(actions).toEqual([
      expect.objectContaining({ key: 'hours', title: 'Aberto agora', summary: 'Fecha às 23:00', tone: 'positive' }),
      expect.objectContaining({ key: 'fulfillment', title: 'Entrega', summary: '40 min', tone: 'positive' }),
      expect.objectContaining({ key: 'information', title: 'Informações', summary: 'Endereço e contato', tone: 'neutral' }),
    ]);
  });

  it('descreve uma loja fechada com próxima abertura', () => {
    const [hours] = buildStorefrontOperations({
      ...baseBusiness,
      businessHours: {
        configured: true,
        openNow: false,
        label: null,
        nextOpen: { day: 'mon', start: '17:00' },
        timezone: 'America/Sao_Paulo',
        weeklySchedule: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
        schedulingEnabled: false,
        schedulingLeadTimeMinutes: 0,
      },
    });

    expect(hours).toEqual(expect.objectContaining({ title: 'Fechado', tone: 'warning' }));
    expect(hours.summary).toMatch(/Abre/);
  });

  it('não inventa horário quando a loja não configurou expediente', () => {
    const [hours] = buildStorefrontOperations({ ...baseBusiness, businessHours: undefined });

    expect(hours).toEqual(expect.objectContaining({ title: 'Horários', summary: 'Horário não informado', tone: 'neutral' }));
  });

  it('mostra prazo a confirmar quando a entrega não tem estimativa', () => {
    const [, fulfillment] = buildStorefrontOperations({
      ...baseBusiness,
      deliveryEstimatedMinutes: null,
      businessHours: undefined,
    });

    expect(fulfillment).toEqual(expect.objectContaining({ title: 'Entrega', summary: 'Prazo a confirmar', tone: 'neutral' }));
  });

  it('explica retirada quando delivery está desabilitado', () => {
    const [, fulfillment] = buildStorefrontOperations({
      ...baseBusiness,
      deliveryEnabled: false,
      businessHours: undefined,
    });

    expect(fulfillment).toEqual(expect.objectContaining({ title: 'Retirada', summary: 'Peça no local', tone: 'neutral' }));
  });
});
