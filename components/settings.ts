// Settings live in storage.sync so they follow the viewer between browsers.
// Each feature owns one top-level section; a new feature adds a section and a
// default here, and normalizeSettings fills it in for viewers who saved older
// settings.

export interface Settings {
  enabled: boolean;
  feed: {
    lowViews: { enabled: boolean; maxViews: number };
    smallChannels: { enabled: boolean; minSubscribers: number; exemptSubscriptions: boolean };
    areas: { home: boolean; watch: boolean; search: boolean };
    action: 'dim' | 'hide';
    hideHomeShorts: boolean;
  };
  shorts: { enabled: boolean; minLikes: number; skipHiddenLikes: boolean };
  badge: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  feed: {
    lowViews: { enabled: true, maxViews: 50_000 },
    smallChannels: { enabled: true, minSubscribers: 50_000, exemptSubscriptions: true },
    areas: { home: true, watch: true, search: false },
    action: 'dim',
    hideHomeShorts: true,
  },
  shorts: { enabled: true, minLikes: 1_000, skipHiddenLikes: true },
  badge: true,
};

const SETTINGS_KEY = 'settings:v1';

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Keeps the shape and types of `defaults`, taking each value from `saved`
// only when it has the same type, so a stale or hand-edited entry can never
// break the content script.
function mergeInto<T>(defaults: T, saved: unknown): T {
  if (!isPlain(defaults) || !isPlain(saved)) {
    return typeof saved === typeof defaults ? (saved as T) : defaults;
  }
  const out: Plain = {};
  for (const [key, value] of Object.entries(defaults)) {
    out[key] = key in saved ? mergeInto(value, saved[key]) : value;
  }
  return out as T;
}

export function normalizeSettings(saved: unknown): Settings {
  const s = mergeInto(DEFAULT_SETTINGS, saved);
  if (s.feed.action !== 'dim' && s.feed.action !== 'hide') s.feed.action = 'dim';
  return s;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export function saveSettings(settings: Settings): Promise<void> {
  return browser.storage.sync.set({ [SETTINGS_KEY]: settings });
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'sync' && SETTINGS_KEY in changes) listener(normalizeSettings(changes[SETTINGS_KEY].newValue));
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
