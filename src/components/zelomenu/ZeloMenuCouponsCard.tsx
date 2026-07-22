import { useEffect, useState } from 'react';
import { Loader2, Plus, Tag, Trash2, X } from 'lucide-react';
import {
  listZeloMenuCouponsAdmin,
  createZeloMenuCouponAdmin,
  updateZeloMenuCouponAdmin,
  deleteZeloMenuCouponAdmin,
  type ZeloMenuCoupon,
  type ZeloMenuCouponInput,
} from '../../services/zelomenuAdminApi';
import { useToast } from '../../contexts/ToastContext';

type DiscountType = 'valor' | 'percentual' | 'frete_gratis';

export function ZeloMenuCouponsCard() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [coupons, setCoupons] = useState<ZeloMenuCoupon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form draft
  const [formCode, setFormCode] = useState('');
  const [formDiscountType, setFormDiscountType] = useState<DiscountType>('percentual');
  const [formDiscountValue, setFormDiscountValue] = useState('');
  const [formMinOrder, setFormMinOrder] = useState('');
  const [formStartsAt, setFormStartsAt] = useState('');
  const [formExpiresAt, setFormExpiresAt] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listZeloMenuCouponsAdmin();
        if (!active) return;
        setCoupons(list);
      } catch {
        toast.error('Erro ao carregar cupons.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setFormCode('');
    setFormDiscountType('percentual');
    setFormDiscountValue('');
    setFormMinOrder('');
    setFormStartsAt('');
    setFormExpiresAt('');
    setEditingId(null);
    setShowForm(false);
  }

  function fillForm(c: ZeloMenuCoupon) {
    setEditingId(c.id);
    setFormCode(c.code);
    setFormDiscountType(c.discountType as DiscountType);
    setFormDiscountValue(c.discountValue != null ? String(c.discountValue) : '');
    setFormMinOrder(c.minOrderValue != null ? String(c.minOrderValue) : '');
    setFormStartsAt(c.startsAt ?? '');
    setFormExpiresAt(c.expiresAt ?? '');
    setShowForm(true);
  }

  async function handleSave() {
    if (!formCode.trim()) { toast.error('Informe o código do cupom.'); return; }
    const input: ZeloMenuCouponInput = {
      code: formCode.trim(),
      discountType: formDiscountType,
      discountValue: formDiscountType === 'frete_gratis' ? null : (Number(formDiscountValue) || 0),
      minOrderValue: formMinOrder ? Number(formMinOrder) : null,
      startsAt: formStartsAt || null,
      expiresAt: formExpiresAt || null,
      active: true,
    };
    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateZeloMenuCouponAdmin(editingId, input);
        setCoupons((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
        toast.success('Cupom atualizado.');
      } else {
        const created = await createZeloMenuCouponAdmin(input);
        setCoupons((prev) => [created, ...prev]);
        toast.success('Cupom criado.');
      }
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'COUPON_CODE_TAKEN') toast.error('Este código já está em uso.');
      else if (msg === 'COUPON_INVALID_CODE') toast.error('Código inválido (3-30 caracteres, letras/números/hífen).');
      else if (msg === 'COUPON_INVALID_DISCOUNT_VALUE') toast.error('Valor de desconto inválido.');
      else toast.error('Erro ao salvar cupom.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, code: string) {
    if (!window.confirm(`Excluir o cupom "${code}"?`)) return;
    try {
      await deleteZeloMenuCouponAdmin(id);
      setCoupons((prev) => prev.map((c) => (c.id === id ? { ...c, active: false } : c)));
      toast.success('Cupom excluído.');
    } catch {
      toast.error('Erro ao excluir cupom.');
    }
  }

  if (loading) {
    return (
      <SectionWrapper>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      </SectionWrapper>
    );
  }

  const isFreteGratis = formDiscountType === 'frete_gratis';

  return (
    <SectionWrapper>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Tag className="h-4 w-4" />
          Cupons de desconto
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 rounded-lg bg-[var(--color-brand-soft)] px-3 py-1.5 text-xs font-medium text-[var(--color-brand-deep)] transition-colors hover:bg-[var(--color-brand-deep)] hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo cupom
          </button>
        )}
        {showForm && (
          <button
            type="button"
            onClick={resetForm}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100"
          >
            <X className="h-3.5 w-3.5" />
            Cancelar
          </button>
        )}
      </div>

      {/* Create/edit form */}
      {showForm && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Código</span>
              <input
                type="text"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                placeholder="Ex: PROMO10"
                maxLength={30}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--color-brand-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-deep)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Tipo de desconto</span>
              <select
                value={formDiscountType}
                onChange={(e) => setFormDiscountType(e.target.value as DiscountType)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--color-brand-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-deep)]"
              >
                <option value="percentual">% (percentual)</option>
                <option value="valor">R$ (valor fixo)</option>
                <option value="frete_gratis">Frete grátis</option>
              </select>
            </label>
            {!isFreteGratis && (
              <label className="block">
                <span className="text-xs font-medium text-gray-600">
                  Valor do desconto {formDiscountType === 'percentual' ? '(%)' : '(R$)'}
                </span>
                <input
                  type="number"
                  value={formDiscountValue}
                  onChange={(e) => setFormDiscountValue(e.target.value)}
                  placeholder={formDiscountType === 'percentual' ? 'Ex: 10' : 'Ex: 15.00'}
                  min={0}
                  step="any"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--color-brand-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-deep)]"
                />
              </label>
            )}
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Pedido mínimo (R$) — opcional</span>
              <input
                type="number"
                value={formMinOrder}
                onChange={(e) => setFormMinOrder(e.target.value)}
                placeholder="Ex: 50"
                min={0}
                step="any"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--color-brand-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-deep)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Válido a partir de — opcional</span>
              <input
                type="datetime-local"
                value={formStartsAt}
                onChange={(e) => setFormStartsAt(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--color-brand-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-deep)]"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-600">Válido até — opcional</span>
              <input
                type="datetime-local"
                value={formExpiresAt}
                onChange={(e) => setFormExpiresAt(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[var(--color-brand-deep)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand-deep)]"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !formCode.trim()}
            className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--color-brand-deep)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {editingId ? 'Salvar alterações' : 'Criar cupom'}
          </button>
        </div>
      )}

      {/* Coupon list */}
      {coupons.length === 0 && !showForm && (
        <p className="mt-4 text-sm text-gray-500">Nenhum cupom cadastrado.</p>
      )}
      {coupons.length > 0 && (
        <ul className="mt-4 divide-y divide-gray-200">
          {coupons.map((c) => (
            <li key={c.id} className={`flex items-center justify-between py-3 ${!c.active ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-gray-800">{c.code}</span>
                  {!c.active && <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">Excluído</span>}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  {c.discountType === 'valor' && `R$ ${Number(c.discountValue).toFixed(2)} de desconto`}
                  {c.discountType === 'percentual' && `${Number(c.discountValue).toFixed(0)}% de desconto`}
                  {c.discountType === 'frete_gratis' && 'Frete grátis'}
                  {c.minOrderValue != null && ` | Mín: R$ ${Number(c.minOrderValue).toFixed(2)}`}
                  {c.expiresAt && ` | até ${new Date(c.expiresAt).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              <div className="ml-4 flex items-center gap-1">
                {c.active && (
                  <>
                    <button
                      type="button"
                      onClick={() => fillForm(c)}
                      className="rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id, c.code)}
                      className="rounded p-1 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionWrapper>
  );
}

// Reusable wrapper matching ZeloMenuSettingsCard's container look
function SectionWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      {children}
    </div>
  );
}
