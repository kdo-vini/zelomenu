const FAVORITES_KEY = 'zelomenu.home.favorites.v1';
const RECENT_BUSINESSES_KEY = 'zelomenu.home.recent-businesses.v1';
const PERSONALIZATION_EVENT = 'zelomenu:home-personalization-change';
const MAX_RECENT_BUSINESSES = 6;

function readIds(key: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
    window.dispatchEvent(new Event(PERSONALIZATION_EVENT));
  } catch {
    // LocalStorage can be blocked by private browsing or browser policies.
  }
}

export function getFavoriteBusinessIds(): string[] {
  return readIds(FAVORITES_KEY);
}

export function isBusinessFavorite(id: string): boolean {
  return getFavoriteBusinessIds().includes(id);
}

export function toggleBusinessFavorite(id: string): boolean {
  const current = getFavoriteBusinessIds();
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  writeIds(FAVORITES_KEY, next);
  return next.includes(id);
}

export function getRecentBusinessIds(): string[] {
  return readIds(RECENT_BUSINESSES_KEY);
}

export function rememberBusinessVisit(id: string): void {
  const next = [id, ...getRecentBusinessIds().filter((item) => item !== id)].slice(0, MAX_RECENT_BUSINESSES);
  writeIds(RECENT_BUSINESSES_KEY, next);
}

export function subscribeToPersonalization(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(PERSONALIZATION_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(PERSONALIZATION_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
