import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, Plus, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useToast } from '../../contexts/ToastContext';
import type {
  ZeloMenuModifierGroupDraft,
  ZeloMenuModifierOptionDraft,
  ZeloMenuModifierGroupKind,
} from '../../domain/zelomenuModifiers';
import type { ProdutoRow } from '../../hooks/useCatalog';

/* ─── Constants ────────────────────────────────────────────────────────────── */

const LABEL_CLS = 'block text-[13px] font-semibold text-[var(--color-ink-soft)] mb-1.5';
const INPUT_CLS =
  'w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3.5 py-2.5 text-base text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] transition-colors focus:border-[var(--color-brand)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]/20 sm:text-sm';

/* ─── Model definitions ───────────────────────────────────────────────────── */

export type ModifierModelId = 'price_swap' | 'price_add' | 'free_option' | 'quantity';

export interface GroupModel {
  id: ModifierModelId;
  title: string;
  description: string;
  example: (productName: string) => string;
  kind: ZeloMenuModifierGroupKind;
  pricingMode: 'somar' | 'substituir';
  allowsQuantity: boolean;
}

export const GROUP_MODELS: GroupModel[] = [
  {
    id: 'price_swap',
    title: 'Escolha que troca o preço',
    description: 'Substitui o preço base (ex: tamanhos, tipos).',
    example: (name) => `${name} \u2022 500ml \u2014 R$ 12,00`,
    kind: 'variacao',
    pricingMode: 'substituir',
    allowsQuantity: false,
  },
  {
    id: 'price_add',
    title: 'Adicional que soma ao preço',
    description: 'Soma um valor ao preço (ex: calda extra, borda).',
    example: (name) => `${name} + Calda de Nutella \u2014 + R$ 3,00`,
    kind: 'adicional',
    pricingMode: 'somar',
    allowsQuantity: false,
  },
  {
    id: 'free_option',
    title: 'Opção incluída, sem custo extra',
    description: 'Algo sem cobrar a mais (ex: sem cebola, ponto da carne).',
    example: (name) => `${name} \u2022 Sem cebola \u2014 R$ 0,00`,
    kind: 'adicional',
    pricingMode: 'somar',
    allowsQuantity: false,
  },
  {
    id: 'quantity',
    title: 'Adicional com quantidade',
    description: 'O cliente pode repetir a mesma opção (ex: 2x bacon).',
    example: (name) => `${name} \u2022 Bacon extra \u00d7 2 \u2014 + R$ 4,00`,
    kind: 'adicional',
    pricingMode: 'somar',
    allowsQuantity: true,
  },
];

export function detectModel(group: ZeloMenuModifierGroupDraft): ModifierModelId {
  if (group.kind === 'variacao' && group.pricingMode === 'substituir') return 'price_swap';
  if (group.allowsQuantity) return 'quantity';
  if (
    group.kind === 'adicional' &&
    group.pricingMode === 'somar' &&
    group.options.length > 0 &&
    group.options.every((option) => option.priceDelta === 0 && !option.linkedProductId && option.priceOverride == null)
  ) {
    return 'free_option';
  }
  // price_add and free_option are technically identical once an option has a price.
  return 'price_add';
}

export function isModelCompatible(modelId: ModifierModelId, group: ZeloMenuModifierGroupDraft): boolean {
  if (modelId === 'price_swap') return group.kind === 'variacao' && group.pricingMode === 'substituir';
  if (modelId === 'quantity') return group.kind === 'adicional' && group.pricingMode === 'somar' && group.allowsQuantity;
  if (modelId === 'free_option') {
    return group.kind === 'adicional'
      && group.pricingMode === 'somar'
      && !group.allowsQuantity
      && group.options.every((option) => option.priceDelta === 0 && !option.linkedProductId && option.priceOverride == null);
  }
  return group.kind === 'adicional' && group.pricingMode === 'somar' && !group.allowsQuantity;
}

function resolveModelId(group: ZeloMenuModifierGroupDraft, override?: ModifierModelId): ModifierModelId {
  return override && isModelCompatible(override, group) ? override : detectModel(group);
}

export function applyModel(
  model: GroupModel,
  group: ZeloMenuModifierGroupDraft,
): ZeloMenuModifierGroupDraft {
  return {
    ...group,
    kind: model.kind,
    pricingMode: model.pricingMode,
    allowsQuantity: model.allowsQuantity,
    minSelections: model.id === 'price_swap' ? Math.min(group.minSelections, 1) : group.minSelections,
    maxSelections: model.id === 'price_swap' ? 1 : group.maxSelections,
    maxPerOption: model.allowsQuantity ? group.maxPerOption : null,
  };
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function createEmptyModifierOption(order: number): ZeloMenuModifierOptionDraft {
  return { name: '', priceDelta: 0, active: true, order, linkedProductId: null, priceOverride: null };
}

/* ─── ModifierGroupsPanel (main export) ────────────────────────────────────── */

interface ModifierGroupsPanelProps {
  groups: ZeloMenuModifierGroupDraft[];
  products: ProdutoRow[];
  productName: string;
  onChange: (index: number, group: ZeloMenuModifierGroupDraft) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
}

export function ModifierGroupsPanel({
  groups,
  products,
  productName,
  onChange,
  onAdd,
  onDelete,
}: ModifierGroupsPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [modelOverrides, setModelOverrides] = useState<Record<string, ModifierModelId>>({});
  const justAddedRef = useRef(false);

  const groupKey = (group: ZeloMenuModifierGroupDraft, index: number) => group.id ?? `index:${index}`;

  const handleAdd = () => {
    justAddedRef.current = true;
    onAdd();
  };

  useEffect(() => {
    if (justAddedRef.current && groups.length > 0) {
      justAddedRef.current = false;
      setSelectedIndex(groups.length - 1);
    }
  }, [groups.length]);

  const handleDelete = (index: number) => {
    onDelete(index);
    setModelOverrides((previous) => {
      const next: Record<string, ModifierModelId> = {};
      Object.entries(previous).forEach(([key, value]) => {
        if (key === `index:${index}`) return;
        if (key.startsWith('index:')) {
          const previousIndex = Number(key.slice('index:'.length));
          next[`index:${previousIndex > index ? previousIndex - 1 : previousIndex}`] = value;
        } else {
          next[key] = value;
        }
      });
      return next;
    });
    if (selectedIndex === index) setSelectedIndex(null);
    else if (selectedIndex != null && selectedIndex > index) setSelectedIndex(selectedIndex - 1);
  };

  const selectedGroup =
    selectedIndex != null && selectedIndex < groups.length ? groups[selectedIndex] : null;

  return (
    <div className="space-y-3">
      <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-4">
        {/* List column */}
        <div className={selectedIndex != null ? 'hidden lg:block' : ''}>
          <GroupList
            groups={groups}
            selectedIndex={selectedIndex}
            modelOverrides={modelOverrides}
            onSelect={setSelectedIndex}
            onAdd={handleAdd}
          />
          {groups.length > 0 && (
            <SummaryBar
              groups={groups}
              open={summaryOpen}
              modelOverrides={modelOverrides}
              onToggle={() => setSummaryOpen((v) => !v)}
            />
          )}
        </div>

        {/* Detail column */}
        <div className={selectedIndex == null ? 'hidden lg:block' : ''}>
          {selectedGroup ? (
            <GroupDetail
              group={selectedGroup}
              products={products}
              productName={productName}
              modelId={resolveModelId(selectedGroup, modelOverrides[groupKey(selectedGroup, selectedIndex ?? 0)])}
              onModelSelect={(modelId) => {
                setModelOverrides((previous) => ({
                  ...previous,
                  [groupKey(selectedGroup, selectedIndex ?? 0)]: modelId,
                }));
              }}
              onChange={(g) => selectedIndex != null && onChange(selectedIndex, g)}
              onBack={() => setSelectedIndex(null)}
              onDelete={() => selectedIndex != null && handleDelete(selectedIndex)}
            />
          ) : (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] p-8 text-sm text-[var(--color-ink-muted)]">
              Selecione um grupo para editar
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── GroupList ────────────────────────────────────────────────────────────── */

function GroupList({
  groups,
  selectedIndex,
  modelOverrides,
  onSelect,
  onAdd,
}: {
  groups: ZeloMenuModifierGroupDraft[];
  selectedIndex: number | null;
  modelOverrides: Record<string, ModifierModelId>;
  onSelect: (index: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
          Grupos ({groups.length})
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="min-h-[44px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-white"
        >
          <Plus className="mr-1 inline h-3.5 w-3.5" />
          Novo grupo
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-4 text-center text-xs text-[var(--color-ink-muted)]">
          Nenhum adicional ou variação configurado.
        </p>
      ) : (
        groups.map((group, i) => {
          const model = resolveModelId(group, modelOverrides[group.id ?? `index:${i}`]);
          const modelInfo = GROUP_MODELS.find((m) => m.id === model);
          return (
            <button
              key={group.id ?? `g-${i}`}
              type="button"
              onClick={() => onSelect(i)}
              aria-pressed={selectedIndex === i}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                selectedIndex === i
                  ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                  : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-[var(--color-ink)]">
                  {group.name || 'Grupo sem nome'}
                </span>
                <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                  {group.options.length} {group.options.length === 1 ? 'opção' : 'opções'}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Tag>{group.minSelections > 0 ? 'Obrigatório' : 'Opcional'}</Tag>
                <Tag>{modelInfo?.title ?? model}</Tag>
                {!group.active && <Tag muted>Inativo</Tag>}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

/* ─── Tag ──────────────────────────────────────────────────────────────────── */

function Tag({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ${
        muted
          ? 'bg-[var(--color-surface-muted)] text-[var(--color-ink-muted)]'
          : 'bg-[var(--color-surface-muted)] text-[var(--color-ink-soft)]'
      }`}
    >
      {children}
    </span>
  );
}

/* ─── SummaryBar ───────────────────────────────────────────────────────────── */

function SummaryBar({
  groups,
  open,
  modelOverrides,
  onToggle,
}: {
  groups: ZeloMenuModifierGroupDraft[];
  open: boolean;
  modelOverrides: Record<string, ModifierModelId>;
  onToggle: () => void;
}) {
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 text-left text-xs text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)]"
      >
        <span className="font-semibold">
          {groups.length} {groups.length === 1 ? 'grupo configurado' : 'grupos configurados'}{' \u00b7 '}Ver como fica
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          {groups.map((group, i) => {
            const model = resolveModelId(group, modelOverrides[group.id ?? `index:${i}`]);
            const modelInfo = GROUP_MODELS.find((m) => m.id === model);
            return (
              <div key={group.id ?? `s-${i}`} className="flex items-center justify-between text-xs">
                <span className="truncate text-[var(--color-ink)]">
                  {group.name || 'Sem nome'}{' '}
                  <span className="text-[var(--color-ink-muted)]">
                    ({group.minSelections > 0 ? 'obrigatório' : 'opcional'})
                  </span>
                </span>
                <span className="shrink-0 text-[var(--color-ink-muted)]">
                  {modelInfo?.title ?? model}{' \u00b7 '}{group.options.length} opções
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── GroupDetail ──────────────────────────────────────────────────────────── */

function GroupDetail({
  group,
  products,
  productName,
  modelId,
  onModelSelect,
  onChange,
  onBack,
  onDelete,
}: {
  group: ZeloMenuModifierGroupDraft;
  products: ProdutoRow[];
  productName: string;
  modelId: ModifierModelId;
  onModelSelect: (modelId: ModifierModelId) => void;
  onChange: (group: ZeloMenuModifierGroupDraft) => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [productPickerIndex, setProductPickerIndex] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (productPickerIndex == null) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setProductPickerIndex(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [productPickerIndex]);

  const filteredProducts = products
    .filter((p) => p.nome.toLowerCase().includes(productSearch.toLowerCase()))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const currentModel = GROUP_MODELS.find((m) => m.id === modelId) ?? GROUP_MODELS[0];

  const handleModelSelect = (model: GroupModel) => {
    if (model.id === 'free_option') {
      const hasPaidOption = group.options.some(
        (option) => option.priceDelta !== 0 || option.linkedProductId || option.priceOverride != null,
      );
      if (hasPaidOption) {
        toast.error('Para usar este modelo, remova preços extras e produtos vinculados das opções.');
        return;
      }
      if (group.options.length === 0) {
        toast.info('Modelo selecionado. Adicione opções sem custo extra para concluir a configuração.');
      }
    }
    onModelSelect(model.id);
    onChange(applyModel(model, group));
  };

  const updateGroup = (patch: Partial<ZeloMenuModifierGroupDraft>) => {
    onChange({ ...group, ...patch });
  };

  const updateOption = (index: number, patch: Partial<ZeloMenuModifierOptionDraft>) => {
    onChange({
      ...group,
      options: group.options.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    });
  };

  const isObrigatorio = group.minSelections > 0;

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      {/* Back button (mobile only) */}
      <button
        type="button"
        onClick={onBack}
        className="flex min-h-[44px] items-center gap-1 text-sm font-semibold text-[var(--color-brand)] lg:hidden"
      >
        <ChevronLeft className="h-4 w-4" />
        Voltar
      </button>

      {/* Group name */}
      <label className="space-y-1.5">
        <span className={LABEL_CLS}>Nome do grupo</span>
        <input
          value={group.name}
          onChange={(e) => updateGroup({ name: e.target.value })}
          placeholder="Ex.: Escolha o recheio"
          className={INPUT_CLS}
        />
      </label>

      {/* Model cards */}
      <div>
        <p className={LABEL_CLS}>Tipo de grupo</p>
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
          {GROUP_MODELS.map((model) => {
            const selected = currentModel.id === model.id;
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => handleModelSelect(model)}
                aria-pressed={selected}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  selected
                    ? 'border-[var(--color-brand)] bg-[var(--color-surface)]'
                    : 'border-[var(--color-line)] bg-[var(--color-surface-muted)] hover:border-[var(--color-line-strong)]'
                }`}
              >
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">{model.title}</p>
                <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">{model.description}</p>
                <p className="mt-1.5 rounded-lg bg-[var(--color-canvas)] px-2 py-1 text-[11px] text-[var(--color-ink-soft)]">
                  {model.example(productName)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-model fields */}
      <div className="space-y-3 rounded-xl bg-[var(--color-surface-muted)] p-3">
        {/* Obrigatório toggle */}
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={isObrigatorio}
            onChange={(e) => updateGroup({ minSelections: e.target.checked ? 1 : 0 })}
            className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
          />
          Obrigatório
        </label>

        {/* price_add / free_option / quantity: max selections */}
        {currentModel.id !== 'price_swap' && (
          <label className="space-y-1.5">
            <span className={LABEL_CLS}>
              {currentModel.id === 'quantity' ? 'Quantas opções distintas?' : 'Quantas o cliente pode escolher?'}
            </span>
            <input
              type="number"
              min={1}
              value={group.maxSelections == null ? '' : String(group.maxSelections)}
              onChange={(e) =>
                updateGroup({ maxSelections: e.target.value === '' ? null : Number(e.target.value || 1) })
              }
              className={INPUT_CLS}
              placeholder="Sem limite"
            />
          </label>
        )}

        {/* quantity: max per option */}
        {currentModel.id === 'quantity' && (
          <label className="space-y-1.5">
            <span className={LABEL_CLS}>Máximo por opção</span>
            <input
              type="number"
              min={1}
              value={group.maxPerOption == null ? '' : String(group.maxPerOption)}
              onChange={(e) =>
                updateGroup({ maxPerOption: e.target.value === '' ? null : Number(e.target.value || 1) })
              }
              className={INPUT_CLS + ' max-w-[140px]'}
              placeholder="Sem limite"
            />
          </label>
        )}

        {/* Active toggle */}
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
          <input
            type="checkbox"
            checked={group.active}
            onChange={(e) => updateGroup({ active: e.target.checked })}
            className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
          />
          Grupo ativo no link
        </label>
      </div>

      {/* Advanced config */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink-soft)]"
        >
          {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Configurações avançadas
        </button>
        {showAdvanced && (
          <div className="mt-3 grid gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={LABEL_CLS}>Tipo</span>
              <select
                value={group.kind}
                onChange={(e) => {
                  const nextKind = e.target.value as ZeloMenuModifierGroupKind;
                  updateGroup({
                    kind: nextKind,
                    allowsQuantity: nextKind !== 'adicional' ? false : group.allowsQuantity,
                    maxPerOption: nextKind !== 'adicional' ? null : group.maxPerOption,
                  });
                }}
                className={INPUT_CLS}
              >
                <option value="adicional">Adicional</option>
                <option value="variacao">Variação</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className={LABEL_CLS}>Preço do grupo</span>
              <select
                value={group.pricingMode}
                onChange={(e) => {
                  const pricingMode = e.target.value as 'somar' | 'substituir';
                  updateGroup({
                    pricingMode,
                    minSelections: pricingMode === 'substituir' ? Math.min(group.minSelections, 1) : group.minSelections,
                    ...(pricingMode === 'substituir' ? { maxSelections: 1 } : {}),
                  });
                }}
                className={INPUT_CLS}
              >
                <option value="somar">Somar ao base</option>
                <option value="substituir">Substituir o base</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className={LABEL_CLS}>Mínimo</span>
              <input
                type="number"
                min={0}
                value={String(group.minSelections)}
                onChange={(e) => updateGroup({ minSelections: Number(e.target.value || 0) })}
                className={INPUT_CLS}
              />
            </label>

            <label className="space-y-1.5">
              <span className={LABEL_CLS}>Máximo</span>
              <input
                type="number"
                min={1}
                value={group.maxSelections == null ? '' : String(group.maxSelections)}
                onChange={(e) => {
                  const next = e.target.value === '' ? null : Number(e.target.value || 1);
                  updateGroup({
                    maxSelections: next,
                    allowsQuantity: next === 1 ? false : group.allowsQuantity,
                    maxPerOption: next === 1 ? null : group.maxPerOption,
                  });
                }}
                className={INPUT_CLS}
                placeholder="Sem limite"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)] sm:col-span-2">
              <input
                type="checkbox"
                checked={group.allowsQuantity}
                disabled={group.maxSelections === 1 || group.kind !== 'adicional'}
                onChange={(e) => {
                  const on = e.target.checked;
                  if (on && (group.maxSelections === 1 || group.kind !== 'adicional')) return;
                  updateGroup({
                    allowsQuantity: on,
                    maxPerOption: on ? group.maxPerOption : null,
                  });
                }}
                className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30 disabled:cursor-not-allowed disabled:opacity-40"
              />
              Permite quantidade por opção (ex.: 2x, 3x)
            </label>

            {group.allowsQuantity && (
              <label className="space-y-1.5">
                <span className={LABEL_CLS}>Máximo por opção</span>
                <input
                  type="number"
                  min={1}
                  value={group.maxPerOption == null ? '' : String(group.maxPerOption)}
                  onChange={(e) =>
                    updateGroup({
                      maxPerOption: e.target.value === '' ? null : Number(e.target.value || 1),
                    })
                  }
                  className={INPUT_CLS}
                  placeholder="Sem limite"
                />
              </label>
            )}
          </div>
        )}
      </div>

      {/* Options */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Opções</p>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...group,
                options: [...group.options, createEmptyModifierOption(group.options.length)],
              })
            }
            className="rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-muted)]"
          >
            Nova opção
          </button>
        </div>

        {group.options.map((option, optionIndex) => (
          <div
            key={option.id ?? `opt-${optionIndex}`}
            className="space-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-muted)] p-3"
          >
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]">
              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Nome</span>
                <input
                  value={option.name}
                  onChange={(e) => updateOption(optionIndex, { name: e.target.value })}
                  placeholder="Ex.: Catupiry"
                  className={INPUT_CLS}
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-semibold text-[var(--color-ink-muted)]">Adicional (R$)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={String(option.priceDelta)}
                  onChange={(e) => updateOption(optionIndex, { priceDelta: Number(e.target.value || 0) })}
                  className={INPUT_CLS}
                />
              </label>

              <div className="flex items-end justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
                  <input
                    type="checkbox"
                    checked={option.active}
                    onChange={(e) => updateOption(optionIndex, { active: e.target.checked })}
                    className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
                  />
                  Ativa
                </label>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...group,
                      options: group.options.filter((_, i) => i !== optionIndex),
                    })
                  }
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]"
                >
                  Remover
                </button>
              </div>
            </div>

            {/* Vincular a produto */}
            <div className="border-t border-[var(--color-line)] pt-2">
              <label className="flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
                <input
                  type="checkbox"
                  checked={!!option.linkedProductId}
                  onChange={(e) => {
                    const linking = e.target.checked;
                    updateOption(optionIndex, {
                      linkedProductId: linking ? (option.linkedProductId ?? products[0]?.id ?? null) : null,
                      priceOverride: linking ? option.priceOverride : null,
                    });
                    if (linking) setProductPickerIndex(optionIndex);
                  }}
                  className="h-4 w-4 rounded border-[var(--color-line-strong)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]/30"
                />
                Vincular a um produto do catálogo
              </label>

              {option.linkedProductId && (
                <div className="relative mt-2" ref={productPickerIndex === optionIndex ? pickerRef : undefined}>
                  <button
                    type="button"
                    onClick={() => {
                      setProductPickerIndex(productPickerIndex === optionIndex ? null : optionIndex);
                      setProductSearch('');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-3 py-2 text-left text-xs"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                    <span className="truncate text-[var(--color-ink)]">
                      {products.find((p) => p.id === option.linkedProductId)?.nome ?? 'Produto não encontrado'}
                    </span>
                  </button>

                  {productPickerIndex === optionIndex && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-white shadow-lg">
                      <div className="sticky top-0 border-b border-[var(--color-line)] bg-white p-2">
                        <input
                          autoFocus
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          placeholder="Buscar produto..."
                          className="w-full rounded-md border border-[var(--color-line)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--color-brand)]"
                        />
                      </div>
                      {filteredProducts.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-[var(--color-ink-faint)]">
                          Nenhum produto encontrado
                        </p>
                      ) : (
                        filteredProducts.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              updateOption(optionIndex, { linkedProductId: p.id });
                              setProductPickerIndex(null);
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--color-surface-muted)] ${
                              option.linkedProductId === p.id ? 'bg-[var(--color-brand-soft)] font-semibold' : ''
                            }`}
                          >
                            <span className="truncate">{p.nome}</span>
                            <span className="shrink-0 text-[var(--color-ink-muted)]">
                              R$ {Number(p.preco).toFixed(2).replace('.', ',')}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}

                  {option.linkedProductId && (
                    <label className="mt-1.5 flex items-center gap-2 text-xs text-[var(--color-ink-soft)]">
                      <span className="shrink-0">Preço (R$) no combo:</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={option.priceOverride == null ? '' : String(option.priceOverride)}
                        onChange={(e) =>
                          updateOption(optionIndex, {
                            priceOverride: e.target.value === '' ? null : Number(e.target.value || 0),
                          })
                        }
                        placeholder="Usar preço do produto"
                        className="w-32 rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-xs outline-none focus:border-[var(--color-brand)]"
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Delete */}
      <div className="border-t border-[var(--color-line)] pt-3">
        <button
          type="button"
          onClick={onDelete}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-[var(--color-alert)] hover:bg-[var(--color-alert-soft)]"
        >
          Remover grupo
        </button>
      </div>
    </div>
  );
}
