import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, GripVertical, Loader2, Search, ShoppingCart, Sparkles, Star, Store, X } from 'lucide-react';
import { Reorder } from 'motion/react';
import { ImageCropField } from './ImageCropField';
import {
  generateZeloMenuWelcome,
  getZeloMenuSettings,
  updateZeloMenuSettings,
  type ZeloMenuStoreSettings,
} from '../../services/zelomenuAdminApi';
import { deleteOwnedZeloMenuBrandingImage, uploadOwnedZeloMenuBrandingImage } from '../../services/zelomenuBrandingImages';
import { supabase } from '../../services/supabaseClient';

const MAX_WELCOME = 400;
const MAX_DESCRIPTION = 180;


// "Cardápio digital" store-settings panel. Mirrors zelochat's
// ZeloMenuSettingsCard. Self-contained: no required props — the API client
// reads the Supabase session itself, so this is a drop-in `<ZeloMenuSettingsCard />`.
//
// (zelochat wrapped this in a shared <SectionCard>; this app has no such
// component, so the icon+title header is inlined to match the look.)
export type ZeloMenuSettingsTab = 'visual' | 'highlights';

export function ZeloMenuSettingsCard({ activeTab = 'visual' }: { activeTab?: ZeloMenuSettingsTab }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [settings, setSettings] = useState<ZeloMenuStoreSettings | null>(null);
  // local draft state
  const [welcomeText, setWelcomeText] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [brandingBusy, setBrandingBusy] = useState(false);
  const [featuredEnabled, setFeaturedEnabled] = useState(false);
  const [featuredIds, setFeaturedIds] = useState<number[]>([]);
  const [recommendationsEnabled, setRecommendationsEnabled] = useState(false);
  const [recommendationIds, setRecommendationIds] = useState<number[]>([]);
  const [categorySuggestions, setCategorySuggestions] = useState<Record<string, number[]>>({});
  const [categoryOrder, setCategoryOrder] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [recSearch, setRecSearch] = useState('');
  const [recPickerOpen, setRecPickerOpen] = useState(false);
  const recPickerRef = useRef<HTMLDivElement>(null);
  const [catPickerCategory, setCatPickerCategory] = useState<string | null>(null);
  const [catSearch, setCatSearch] = useState('');
  const catPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await getZeloMenuSettings();
        if (!active) return;
        setSettings(s);
        setLogoUrl(s.logoUrl);
        setCoverUrl(s.coverUrl);
        setDescription(s.description ?? '');
        setWelcomeText(s.welcomeText ?? '');
        setFeaturedEnabled(s.featuredEnabled);
        setFeaturedIds(s.featuredProductIds);
        setRecommendationsEnabled(s.recommendationsEnabled);
        setRecommendationIds(s.recommendationProductIds);
        setCategorySuggestions(s.categorySuggestions ?? {});
        // Reconcilia a ordem salva com o catálogo atual: descarta categorias que
        // não existem mais (renomeadas/excluídas no PDV) e anexa as novas no fim,
        // pra lista de arrastar sempre refletir o cardápio de verdade.
        {
          const savedOrder = s.categoryOrder.filter((c) => s.availableCategories.includes(c));
          const missing = s.availableCategories.filter((c) => !savedOrder.includes(c));
          setCategoryOrder([...savedOrder, ...missing]);
        }
      } catch {
        // silencioso — card mostra spinner e some
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  // Close product picker when clicking outside
  useEffect(() => {
    if (!productPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setProductPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [productPickerOpen]);

  useEffect(() => {
    if (!recPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (recPickerRef.current && !recPickerRef.current.contains(e.target as Node)) {
        setRecPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [recPickerOpen]);

  useEffect(() => {
    if (!catPickerCategory) return;
    const handler = (e: MouseEvent) => {
      if (catPickerRef.current && !catPickerRef.current.contains(e.target as Node)) {
        setCatPickerCategory(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [catPickerCategory]);

  function toggleProduct(id: number) {
    setFeaturedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleRecommendation(id: number) {
    setRecommendationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleCategorySuggestion(category: string, id: number) {
    setCategorySuggestions((prev) => {
      const current = prev[category] ?? [];
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= 3
          ? current
          : [...current, id];
      return { ...prev, [category]: next };
    });
  }

  async function generateWelcome() {
    if (!settings) return;
    try {
      setGenerating(true);
      setError(null);
      const text = await generateZeloMenuWelcome({
        companyName: settings.companyName,
        companySpecialty: settings.companySpecialty,
        categories: settings.availableCategories,
      });
      setWelcomeText(text.slice(0, MAX_WELCOME));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui gerar o texto. Tente de novo.');
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    try {
      setSaving(true);
      setError(null);
      await updateZeloMenuSettings({
        logoUrl,
        coverUrl,
        description: description.trim() || null,
        welcomeText: welcomeText.trim() || null,
        featuredEnabled,
        featuredProductIds: featuredIds,
        recommendationsEnabled,
        recommendationProductIds: recommendationIds,
        categorySuggestions,
        categoryOrder,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não consegui salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (!settings) return null;

  const filteredProducts = productSearch.trim()
    ? settings.availableProducts.filter((p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.categoryName.toLowerCase().includes(productSearch.toLowerCase()),
      )
    : settings.availableProducts;

  const recFilteredProducts = recSearch.trim()
    ? settings.availableProducts.filter((p) =>
        p.name.toLowerCase().includes(recSearch.toLowerCase()) ||
        p.categoryName.toLowerCase().includes(recSearch.toLowerCase()),
      )
    : settings.availableProducts;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-5 py-4">
        <Store className="h-4 w-4 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
        <h3 className="text-[14px] font-semibold text-[var(--color-ink)]">Cardápio digital</h3>
      </div>
      <div className="p-5">
        <div className="space-y-6">

          {activeTab === 'visual' ? (
            <>
          {/* ── Public business card identity ── */}
          <div>
            <div className="mb-3">
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Card da empresa no ZeloMenu</p>
              <p className="text-[12px] text-[var(--color-ink-muted)]">Defina a descrição e as imagens que aparecem na vitrine pública.</p>
            </div>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder="Ex.: Massas artesanais, marmitas e lanches feitos com carinho."
              rows={2}
              className="mb-4 w-full resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)]"
            />
            <p className="-mt-3 mb-4 text-right text-[11px] text-[var(--color-ink-muted)]">{description.length}/{MAX_DESCRIPTION}</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
                <p className="mb-2 text-[12px] font-semibold text-[var(--color-ink)]">Logo</p>
                <ImageCropField
                  value={logoUrl}
                  busy={brandingBusy}
                  onError={setError}
                  onChange={async (file) => {
                    const { data } = await supabase.auth.getUser();
                    if (!data.user?.id) throw new Error('Sessão expirada. Entre novamente.');
                    setBrandingBusy(true);
                    try {
                      setLogoUrl(await uploadOwnedZeloMenuBrandingImage(data.user.id, 'logo', file, logoUrl));
                    } finally {
                      setBrandingBusy(false);
                    }
                  }}
                  onRemove={async () => {
                    const previous = logoUrl;
                    setLogoUrl(null);
                    await deleteOwnedZeloMenuBrandingImage(previous).catch(() => undefined);
                  }}
                />
              </div>
              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
                <p className="mb-2 text-[12px] font-semibold text-[var(--color-ink)]">Foto de capa</p>
                <ImageCropField
                  value={coverUrl}
                  busy={brandingBusy}
                  aspect={3/2}
                  onError={setError}
                  onChange={async (file) => {
                    const { data } = await supabase.auth.getUser();
                    if (!data.user?.id) throw new Error('Sessão expirada. Entre novamente.');
                    setBrandingBusy(true);
                    try {
                      setCoverUrl(await uploadOwnedZeloMenuBrandingImage(data.user.id, 'cover', file, coverUrl));
                    } finally {
                      setBrandingBusy(false);
                    }
                  }}
                  onRemove={async () => {
                    const previous = coverUrl;
                    setCoverUrl(null);
                    await deleteOwnedZeloMenuBrandingImage(previous).catch(() => undefined);
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── Public card preview ── */}
          <div>
            <p className="mb-3 text-[13px] font-semibold text-[var(--color-ink)]">Prévia do card público</p>
            <div className="max-w-sm overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-sm">
              <div className="relative aspect-[3/2] overflow-hidden bg-gradient-to-br from-purple-100 to-purple-50">
                {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="flex flex-col gap-3 p-4">
                <div className="flex min-w-0 items-center gap-[10px]">
                  <div className="h-[42px] w-[42px] shrink-0 overflow-hidden rounded-[13px] border border-white/80 shadow-[0_5px_14px_rgba(29,17,65,0.12)]">
                    {logoUrl ? (
                      <img src={logoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[var(--color-brand-soft)] text-[11px] font-bold text-[var(--color-brand-deep)]">
                        {settings.companyName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-[var(--color-ink)]">{settings.companyName || 'Nome da empresa'}</p>
                    <p className="mt-[2px] line-clamp-2 text-[13px] leading-snug text-[var(--color-ink-muted)]">{description || 'Cardápio digital'}</p>
                  </div>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 text-[12px] text-[var(--color-ink-muted)]">
                  <span className="truncate">{settings.companySpecialty || settings.companyName || 'Restaurante'}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-purple-600">
                    <Star size={13} strokeWidth={2} />
                    5.0
                  </span>
                </div>
                <a className="mt-auto inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[13px] border border-purple-100 bg-purple-50 text-[13px] font-extrabold text-purple-700 transition-colors hover:bg-purple-600 hover:text-white">
                  Abrir cardápio
                  <ArrowRight size={17} strokeWidth={2.5} />
                </a>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">Salve as configurações para publicar as alterações na vitrine.</p>
          </div>

          {/* ── Welcome text ── */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Texto de boas-vindas</p>
              <button
                type="button"
                onClick={() => void generateWelcome()}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold text-[var(--color-brand-deep)] hover:bg-[var(--color-brand-soft)] disabled:opacity-50"
                style={{ transition: 'background 0.15s' }}
              >
                {generating
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  : <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />}
                {generating ? 'Gerando…' : 'Gerar com IA'}
              </button>
            </div>
            <textarea
              value={welcomeText}
              onChange={(e) => setWelcomeText(e.target.value.slice(0, MAX_WELCOME))}
              placeholder="Uma frase de boas-vindas para seus clientes…"
              rows={3}
              className="w-full resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)] focus:border-[var(--color-brand)]"
              style={{ transition: 'border-color 0.15s' }}
            />
            <p className="mt-1 text-right text-[11px] text-[var(--color-ink-muted)]">
              {welcomeText.length}/{MAX_WELCOME}
            </p>
          </div>

            </>
          ) : (
            <>
          {/* ── Featured products ── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">Seção de Destaques</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">Aparece no topo do cardápio, antes das categorias</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={featuredEnabled}
                onClick={() => setFeaturedEnabled((v) => !v)}
                className="relative h-6 w-11 rounded-full transition-colors"
                style={{ background: featuredEnabled ? 'var(--color-brand)' : 'var(--color-line-strong)' }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: featuredEnabled ? 'translateX(20px)' : 'translateX(2px)' }}
                />
              </button>
            </div>

            {featuredEnabled ? (
              <div className="space-y-2">
                {/* Product picker trigger */}
                <div className="relative" ref={pickerRef}>
                  <button
                    type="button"
                    onClick={() => setProductPickerOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Star className="h-4 w-4 shrink-0 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
                      <span className="truncate text-[13px] text-[var(--color-ink)]">
                        {featuredIds.length === 0
                          ? 'Selecionar produtos…'
                          : `${featuredIds.length} produto${featuredIds.length !== 1 ? 's' : ''} selecionado${featuredIds.length !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)] transition-transform"
                      style={{ transform: productPickerOpen ? 'rotate(180deg)' : '' }}
                      strokeWidth={2}
                    />
                  </button>

                  {productPickerOpen ? (
                    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
                      {/* Search */}
                      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={2} />
                        <input
                          autoFocus
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          placeholder="Buscar produto…"
                          className="flex-1 bg-transparent text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)]"
                        />
                        {productSearch ? (
                          <button type="button" onClick={() => setProductSearch('')}>
                            <X className="h-3.5 w-3.5 text-[var(--color-ink-muted)]" strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                      {/* List */}
                      <div className="max-h-52 overflow-y-auto">
                        {filteredProducts.length === 0 ? (
                          <p className="px-4 py-3 text-[13px] text-[var(--color-ink-muted)]">Nenhum produto encontrado</p>
                        ) : (
                          filteredProducts.map((p) => {
                            const checked = featuredIds.includes(p.id);
                            return (
                              <label
                                key={p.id}
                                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-canvas)]"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleProduct(p.id)}
                                  className="h-4 w-4 accent-[var(--color-brand)]"
                                />
                                <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{p.name}</span>
                                <span className="shrink-0 text-[11px] text-[var(--color-ink-muted)]">{p.categoryName}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <div className="border-t border-[var(--color-line)] px-4 py-2">
                        <button
                          type="button"
                          onClick={() => setProductPickerOpen(false)}
                          className="text-[12px] font-medium text-[var(--color-brand-deep)]"
                        >
                          Fechar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Selected pills */}
                {featuredIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {featuredIds.map((id) => {
                      const name = settings.availableProducts.find((p) => p.id === id)?.name;
                      if (!name) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-brand-deep)]"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => toggleProduct(id)}
                            aria-label={`Remover ${name}`}
                          >
                            <X className="h-3 w-3" strokeWidth={2.5} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ── Checkout recommendations (cross-sell) ── */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">Sugestões no checkout</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">Ofereça bebidas, sobremesas ou acompanhamentos na hora de fechar o pedido.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={recommendationsEnabled}
                onClick={() => setRecommendationsEnabled((v) => !v)}
                className="relative h-6 w-11 rounded-full transition-colors"
                style={{ background: recommendationsEnabled ? 'var(--color-brand)' : 'var(--color-line-strong)' }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: recommendationsEnabled ? 'translateX(20px)' : 'translateX(2px)' }}
                />
              </button>
            </div>

            {recommendationsEnabled ? (
              <div className="space-y-2">
                {/* Product picker trigger */}
                <div className="relative" ref={recPickerRef}>
                  <button
                    type="button"
                    onClick={() => setRecPickerOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-left"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <ShoppingCart className="h-4 w-4 shrink-0 text-[var(--color-brand-deep)]" strokeWidth={1.8} />
                      <span className="truncate text-[13px] text-[var(--color-ink)]">
                        {recommendationIds.length === 0
                          ? 'Selecionar produtos…'
                          : `${recommendationIds.length} produto${recommendationIds.length !== 1 ? 's' : ''} selecionado${recommendationIds.length !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)] transition-transform"
                      style={{ transform: recPickerOpen ? 'rotate(180deg)' : '' }}
                      strokeWidth={2}
                    />
                  </button>

                  {recPickerOpen ? (
                    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
                      {/* Search */}
                      <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
                        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={2} />
                        <input
                          autoFocus
                          value={recSearch}
                          onChange={(e) => setRecSearch(e.target.value)}
                          placeholder="Buscar produto…"
                          className="flex-1 bg-transparent text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)]"
                        />
                        {recSearch ? (
                          <button type="button" onClick={() => setRecSearch('')}>
                            <X className="h-3.5 w-3.5 text-[var(--color-ink-muted)]" strokeWidth={2} />
                          </button>
                        ) : null}
                      </div>
                      {/* List */}
                      <div className="max-h-52 overflow-y-auto">
                        {recFilteredProducts.length === 0 ? (
                          <p className="px-4 py-3 text-[13px] text-[var(--color-ink-muted)]">Nenhum produto encontrado</p>
                        ) : (
                          recFilteredProducts.map((p) => {
                            const checked = recommendationIds.includes(p.id);
                            return (
                              <label
                                key={p.id}
                                className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-canvas)]"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleRecommendation(p.id)}
                                  className="h-4 w-4 accent-[var(--color-brand)]"
                                />
                                <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{p.name}</span>
                                <span className="shrink-0 text-[11px] text-[var(--color-ink-muted)]">{p.categoryName}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <div className="border-t border-[var(--color-line)] px-4 py-2">
                        <button
                          type="button"
                          onClick={() => setRecPickerOpen(false)}
                          className="text-[12px] font-medium text-[var(--color-brand-deep)]"
                        >
                          Fechar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Selected pills */}
                {recommendationIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {recommendationIds.map((id) => {
                      const name = settings.availableProducts.find((p) => p.id === id)?.name;
                      if (!name) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-brand-deep)]"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => toggleRecommendation(id)}
                            aria-label={`Remover ${name}`}
                          >
                            <X className="h-3 w-3" strokeWidth={2.5} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* ── Sugestões por categoria ── */}
          {settings.availableCategories.length > 0 ? (
            <div>
              <div className="mb-3">
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">Sugestões por categoria</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">Ofereça acompanhamentos específicos para cada categoria do cardápio (até 3 por categoria).</p>
              </div>
              <div className="space-y-3">
                {settings.availableCategories.map((cat) => {
                  const catProductIds = categorySuggestions[cat] ?? [];
                  const catProducts = settings.availableProducts.filter((p) => p.categoryName === cat);
                  const isOpen = catPickerCategory === cat;
                  const filtered = catSearch.trim()
                    ? catProducts.filter((p) => p.name.toLowerCase().includes(catSearch.toLowerCase()))
                    : catProducts;
                  return (
                    <div key={cat} className="rounded-xl border border-[var(--color-line)] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[13px] font-semibold text-[var(--color-ink)]">{cat}</p>
                        <span className="text-[11px] text-[var(--color-ink-muted)]">{catProductIds.length}/3</span>
                      </div>
                      <div className="relative" ref={isOpen ? catPickerRef : undefined}>
                        <button
                          type="button"
                          onClick={() => {
                            setCatPickerCategory(isOpen ? null : cat);
                            setCatSearch('');
                          }}
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-left"
                        >
                          <span className="text-[12px] text-[var(--color-ink)]">
                            {catProductIds.length === 0 ? 'Selecionar produtos…' : `${catProductIds.length} produto${catProductIds.length !== 1 ? 's' : ''} selecionado${catProductIds.length !== 1 ? 's' : ''}`}
                          </span>
                          <ChevronDown
                            className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)] transition-transform"
                            style={{ transform: isOpen ? 'rotate(180deg)' : '' }}
                            strokeWidth={2}
                          />
                        </button>
                        {isOpen ? (
                          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
                            <div className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2">
                              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={2} />
                              <input
                                autoFocus
                                value={catSearch}
                                onChange={(e) => setCatSearch(e.target.value)}
                                placeholder="Buscar…"
                                className="flex-1 bg-transparent text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-muted)]"
                              />
                              {catSearch ? (
                                <button type="button" onClick={() => setCatSearch('')}>
                                  <X className="h-3.5 w-3.5 text-[var(--color-ink-muted)]" strokeWidth={2} />
                                </button>
                              ) : null}
                            </div>
                            <div className="max-h-40 overflow-y-auto">
                              {filtered.length === 0 ? (
                                <p className="px-4 py-3 text-[13px] text-[var(--color-ink-muted)]">Nenhum produto encontrado</p>
                              ) : (
                                filtered.map((p) => {
                                  const checked = catProductIds.includes(p.id);
                                  const atLimit = !checked && catProductIds.length >= 3;
                                  return (
                                    <label
                                      key={p.id}
                                      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--color-canvas)] ${atLimit ? 'opacity-40' : ''}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={atLimit}
                                        onChange={() => toggleCategorySuggestion(cat, p.id)}
                                        className="h-4 w-4 accent-[var(--color-brand)]"
                                      />
                                      <span className="min-w-0 flex-1 text-[13px] text-[var(--color-ink)]">{p.name}</span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      {catProductIds.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {catProductIds.map((id) => {
                            const name = settings.availableProducts.find((p) => p.id === id)?.name;
                            if (!name) return null;
                            return (
                              <span
                                key={id}
                                className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-soft)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-brand-deep)]"
                              >
                                {name}
                                <button
                                  type="button"
                                  onClick={() => toggleCategorySuggestion(cat, id)}
                                  aria-label={`Remover ${name}`}
                                >
                                  <X className="h-3 w-3" strokeWidth={2.5} />
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* ── Category order ── */}
          {categoryOrder.length > 1 ? (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Ordem das categorias</p>
              <p className="mb-3 text-[12px] text-[var(--color-ink-muted)]">Arraste para reorganizar como as categorias aparecem no cardápio.</p>
              <Reorder.Group
                axis="y"
                values={categoryOrder}
                onReorder={setCategoryOrder}
                className="space-y-2"
              >
                {categoryOrder.map((cat) => (
                  <Reorder.Item
                    key={cat}
                    value={cat}
                    className="flex cursor-grab items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 active:cursor-grabbing"
                    whileDrag={{ scale: 1.02, boxShadow: '0 4px 16px rgba(0,0,0,0.10)' }}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" strokeWidth={1.8} />
                    <span className="text-[13px] font-medium text-[var(--color-ink)]">{cat}</span>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </div>
          ) : null}

            </>
          )}

          {/* ── Save ── */}
          {error ? (
            <p className="text-[12.5px] text-[var(--color-alert)]">{error}</p>
          ) : null}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--color-brand)' }}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : saved ? (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            ) : null}
            {saving ? 'Salvando…' : saved ? 'Salvo!' : 'Salvar configurações'}
          </button>
        </div>
      </div>
    </div>
  );
}
