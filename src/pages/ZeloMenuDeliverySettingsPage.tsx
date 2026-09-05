import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Loader2, Save } from 'lucide-react';
import {
  createDeliveryDraft,
  deliveryDraftToSettings,
  EMPTY_DELIVERY_ADDRESS,
  EMPTY_DELIVERY_SETTINGS,
  formatPostalCode,
  parseDecimal,
  validateDeliveryDraft,
  type DeliverySettings,
  type DeliverySettingsDraft,
} from '../domain/deliverySettings';
import {
  geocodeDeliveryStore,
  getDeliverySettings,
  lookupDeliveryCep,
  updateDeliverySettings,
} from '../services/zelomenuAdminApi';
import { DeliveryCoveragePreview } from '../components/zelomenu/DeliveryCoveragePreview';
import { DeliveryQuoteQueue } from '../components/zelomenu/DeliveryQuoteQueue';
import { ZeloMenuDeliverySettingsCard } from '../components/zelomenu/ZeloMenuDeliverySettingsCard';
import { ZeloMenuDeliveryNeighborhoodSettingsCard } from '../components/zelomenu/ZeloMenuDeliveryNeighborhoodSettingsCard';
import { DeliveryCustomScheduleDisclosure } from '../components/zelomenu/DeliveryCustomScheduleDisclosure';

type ZeloMenuDeliverySettingsPageProps = {
  onBack: () => void;
};

export function ZeloMenuDeliverySettingsPage({ onBack }: ZeloMenuDeliverySettingsPageProps) {
  const [draft, setDraft] = useState<DeliverySettingsDraft>(() => createDeliveryDraft(EMPTY_DELIVERY_SETTINGS));
  const [snapshot, setSnapshot] = useState<DeliverySettingsDraft>(() => createDeliveryDraft(EMPTY_DELIVERY_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [cepLoading, setCepLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const validation = useMemo(() => validateDeliveryDraft({ ...draft, enabled: true }), [draft]);
  const deliverySettings = useMemo(() => deliveryDraftToSettings(draft), [draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot);

  useEffect(() => {
    let active = true;
    void getDeliverySettings()
      .then((settings) => {
        if (!active) return;
        const nextDraft = createDeliveryDraft(settings);
        setDraft(nextDraft);
        setSnapshot(nextDraft);
      })
      .catch(() => {
        if (!active) return;
        setLoadError('Não foi possível carregar a configuração de entrega. Você pode preencher uma nova configuração.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  function requestBack() {
    if (dirty && !window.confirm('Existem alterações não salvas. Sair mesmo assim?')) return;
    onBack();
  }

  function updateAddress(field: 'postalCode' | 'number' | 'complement', value: string) {
    setSaved(false);
    setSaveError(null);
    if (field === 'postalCode') {
      const formatted = formatPostalCode(value);
      const previous = draft.address.postalCode.replace(/\D/g, '');
      const next = formatted.replace(/\D/g, '');
      if (previous !== next) {
        setDraft((current) => ({
          ...current,
          address: {
            ...current.address,
            postalCode: formatted,
            street: '',
            neighborhood: '',
            city: '',
            state: '',
            latitude: null,
            longitude: null,
            locationVersion: null,
          },
          geocodingStatus: 'stale',
        }));
        return;
      }
      setDraft((current) => ({ ...current, address: { ...current.address, postalCode: formatted } }));
      return;
    }

    setDraft((current) => ({
      ...current,
      address: { ...current.address, [field]: value },
      geocodingStatus: field === 'number' ? 'stale' : current.geocodingStatus,
    }));
  }

  async function handleLookupCep() {
    const digits = draft.address.postalCode.replace(/\D/g, '');
    if (digits.length !== 8) {
      setSaveError('Informe um CEP válido com 8 dígitos para buscar o endereço.');
      return;
    }

    setCepLoading(true);
    setSaveError(null);
    try {
      const lookup = await lookupDeliveryCep(digits);
      setDraft((current) => ({
        ...current,
        address: {
          ...current.address,
          postalCode: formatPostalCode(lookup.postalCode),
          street: lookup.street,
          neighborhood: lookup.neighborhood,
          city: lookup.city,
          state: lookup.state,
          latitude: null,
          longitude: null,
          locationVersion: null,
        },
        geocodingStatus: 'stale',
      }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível buscar esse CEP.');
    } finally {
      setCepLoading(false);
    }
  }

  function updateRange(index: number, field: 'maxDistanceKm' | 'price', value: string) {
    setSaved(false);
    setSaveError(null);
    setDraft((current) => ({
      ...current,
      ranges: current.ranges.map((range, rangeIndex) => (
        rangeIndex === index ? { ...range, [field]: value } : range
      )),
    }));
  }

  function updateEstimatedDeliveryMinutes(value: string) {
    setSaved(false);
    setSaveError(null);
    setDraft((current) => ({ ...current, estimatedDeliveryMinutes: value }));
  }

  function addRange() {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      ranges: [...current.ranges, { maxDistanceKm: '', price: '' }],
    }));
  }

  function removeRange(index: number) {
    setSaved(false);
    setDraft((current) => ({ ...current, ranges: current.ranges.filter((_, rangeIndex) => rangeIndex !== index) }));
  }

  function updateMode(mode: 'distance' | 'neighborhood') {
    setSaved(false);
    setSaveError(null);
    setDraft((current) => ({ ...current, mode }));
  }

  function updateNeighborhood(index: number, field: 'name' | 'price', value: string) {
    setSaved(false);
    setSaveError(null);
    setDraft((current) => ({
      ...current,
      neighborhoods: current.neighborhoods.map((neighborhood, neighborhoodIndex) => (
        neighborhoodIndex === index ? { ...neighborhood, [field]: value } : neighborhood
      )),
    }));
  }

  function toggleNeighborhood(index: number) {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      neighborhoods: current.neighborhoods.map((neighborhood, neighborhoodIndex) => (
        neighborhoodIndex === index ? { ...neighborhood, active: !neighborhood.active } : neighborhood
      )),
    }));
  }

  function addNeighborhood() {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      neighborhoods: [...current.neighborhoods, { name: '', price: '', active: true }],
    }));
  }

  function removeNeighborhood(index: number) {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      neighborhoods: current.neighborhoods.filter((_, neighborhoodIndex) => neighborhoodIndex !== index),
    }));
  }

  async function save() {
    if (validation.general) {
      setSaveError(validation.general);
      return;
    }

    const baseSettings = deliveryDraftToSettings(draft);
    if (draft.mode === 'distance' && !baseSettings.address) {
      setSaveError('Complete o endereço da loja antes de salvar.');
      return;
    }
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    let geocodingStarted = false;
    try {
      let address = baseSettings.address ? { ...baseSettings.address } : { ...EMPTY_DELIVERY_ADDRESS };
      let nextSettings: DeliverySettings = {
        ...baseSettings,
        enabled: true,
        address,
      };

      if (draft.mode === 'distance' && (
        address.latitude == null
        || address.longitude == null
        || nextSettings.geocodingStatus !== 'ready'
      )) {
        geocodingStarted = true;
        setGeocoding(true);
        const location = await geocodeDeliveryStore({
          postalCode: address.postalCode,
          street: address.street,
          number: address.number,
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
        });
        address = {
          ...address,
          latitude: location.latitude,
          longitude: location.longitude,
          locationVersion: location.locationVersion,
        };
        nextSettings = {
          ...nextSettings,
          geocodingStatus: 'ready',
          address,
        };
        setDraft(createDeliveryDraft(nextSettings));
      }

      const response = await updateDeliverySettings(nextSettings);
      const savedSettings = response.settings ?? nextSettings;
      const nextDraft = createDeliveryDraft(savedSettings);
      setDraft(nextDraft);
      setSnapshot(nextDraft);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2400);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar a configuração. Tente novamente.');
      if (geocodingStarted) setDraft((current) => ({ ...current, geocodingStatus: 'error' }));
    } finally {
      setGeocoding(false);
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-28 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-9">
      <header className="flex items-start gap-3">
        <button
          type="button"
          onClick={requestBack}
          className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40"
          aria-label="Voltar para configurações"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-[var(--color-ink)] sm:text-2xl">Configurar entrega</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[var(--color-ink-muted)] sm:text-sm">
            Escolha como sua loja calcula a entrega e configure apenas o modelo selecionado.
          </p>
        </div>
      </header>

      {loadError && (
        <p className="mt-5 rounded-xl border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] px-4 py-3 text-sm leading-relaxed text-[var(--color-warn)]" role="status">
          {loadError}
        </p>
      )}

      <section className="mt-5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-4 shadow-[0_8px_18px_rgba(36,31,54,0.04)] sm:px-5">
        <label className="block max-w-xl">
          <span className="mb-1.5 block text-[12px] font-bold text-[var(--color-ink-soft)]">Modelo de entrega</span>
          <select
            value={draft.mode}
            onChange={(event) => updateMode(event.target.value as 'distance' | 'neighborhood')}
            disabled={loading || saving}
            className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm font-semibold text-[var(--color-ink)] outline-none transition-colors focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/10 sm:max-w-md"
          >
            <option value="distance">Por rota / distância</option>
            <option value="neighborhood">Por bairro</option>
          </select>
        </label>
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
          {draft.mode === 'neighborhood'
            ? 'O cliente escolherá um bairro cadastrado. A taxa será o preço definido para esse bairro.'
            : 'O cliente informa o CEP e o sistema calcula a rota até a loja.'}
        </p>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(390px,0.95fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(480px,1fr)] lg:items-start lg:gap-6">
        <div className="space-y-4">
          {draft.mode === 'neighborhood' ? (
            <ZeloMenuDeliveryNeighborhoodSettingsCard
              draft={draft}
              validation={validation}
              onNeighborhoodChange={updateNeighborhood}
              onToggleNeighborhood={toggleNeighborhood}
              onAddNeighborhood={addNeighborhood}
              onRemoveNeighborhood={removeNeighborhood}
              onEstimatedDeliveryMinutesChange={updateEstimatedDeliveryMinutes}
            />
          ) : (
            <>
              <ZeloMenuDeliverySettingsCard
                draft={draft}
                validation={validation}
                cepLoading={cepLoading}
                onLookupCep={() => void handleLookupCep()}
                onAddressChange={updateAddress}
                onEstimatedDeliveryMinutesChange={updateEstimatedDeliveryMinutes}
                onRangeChange={updateRange}
                onAddRange={addRange}
                onRemoveRange={removeRange}
              />
              <DeliveryCustomScheduleDisclosure
                pricingRules={draft.pricingRules}
                ranges={draft.ranges.map((r) => ({
                  maxDistanceM: Math.round((parseDecimal(r.maxDistanceKm) || 0) * 1000),
                  price: r.price,
                  label: (parseDecimal(r.maxDistanceKm) || 0).toFixed(2).replace('.', ',') + ' km',
                }))}
                enabled={draft.enabled}
                onRulesChange={(rules) => {
                  setSaved(false);
                  setSaveError(null);
                  setDraft((prev) => ({ ...prev, pricingRules: rules }));
                }}
              />
            </>
          )}
        </div>

        {draft.mode === 'distance' ? (
          <div className="lg:sticky lg:top-5">
            <DeliveryCoveragePreview
              ranges={deliverySettings.ranges}
              address={deliverySettings.address}
              estimatedDeliveryMinutes={deliverySettings.estimatedDeliveryMinutes}
              loading={loading || geocoding}
            />
          </div>
        ) : <div aria-hidden="true" />}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 mt-5 border-t border-[var(--color-line)] bg-[var(--color-canvas)]/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="min-h-5 flex-1 text-xs" aria-live="polite">
            {geocoding && <span className="text-[var(--color-ink-muted)]">Localizando a loja…</span>}
            {!geocoding && saved && <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-success)]"><Check className="h-4 w-4" />Configuração salva.</span>}
            {!geocoding && saveError && <span className="text-[var(--color-alert)]">{saveError}</span>}
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading || saving || !!validation.general || !dirty}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] px-5 text-sm font-bold text-white transition-colors hover:bg-[var(--color-brand-deep)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto sm:min-w-56"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />}
            {geocoding ? 'Localizando…' : saving ? 'Salvando…' : 'Salvar configuração'}
          </button>
        </div>
      </div>

      {draft.mode === 'distance' ? <div className="mt-8"><DeliveryQuoteQueue /></div> : null}
    </div>
  );
}
