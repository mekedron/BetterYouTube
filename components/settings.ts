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
  ai: {
    /** Whether the viewer answered the first-run question about summaries. */
    consent: 'unasked' | 'granted' | 'declined';
    /** The provider that writes summaries; see components/ai/providers.ts. */
    provider: string;
    /** 'auto' follows the browser language when the provider supports it. */
    language: string;
    /** The viewer's own prompt, used instead of the built-in one; empty means the built-in one. */
    prompt: string;
    /** Start the summary as soon as the popup opens on a video. */
    autoSummarize: boolean;
    /**
     * What Chrome's built-in model does when a video stays open for a few
     * seconds: nothing, load itself into memory, or write the summary so the
     * popup opens with it ready. See components/ai/prepare.ts.
     */
    prepare: 'off' | 'model' | 'summary';
    /** Per-provider choices. API keys are not here; see components/ai/secrets.ts. */
    providers: Record<'chrome-builtin' | 'agent' | 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'custom', ProviderSettings>;
  };
  badge: boolean;
}

export interface ProviderSettings {
  /** Empty until the viewer picks one or the provider's default is filled in. */
  model: string;
  effort: 'default' | 'low' | 'medium' | 'high';
  baseUrl: string;
  agent: 'claude' | 'codex' | 'gemini';
}

const PROVIDER_DEFAULTS: ProviderSettings = { model: '', effort: 'default', baseUrl: '', agent: 'claude' };

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
  ai: {
    consent: 'unasked',
    provider: 'chrome-builtin',
    language: 'auto',
    prompt: '',
    autoSummarize: true,
    prepare: 'off',
    providers: {
      'chrome-builtin': PROVIDER_DEFAULTS,
      // Haiku answers a summary in about a second through Claude Code.
      agent: { ...PROVIDER_DEFAULTS, model: 'haiku', effort: 'low' },
      openai: PROVIDER_DEFAULTS,
      anthropic: PROVIDER_DEFAULTS,
      gemini: PROVIDER_DEFAULTS,
      openrouter: PROVIDER_DEFAULTS,
      custom: { ...PROVIDER_DEFAULTS, baseUrl: 'http://127.0.0.1:11434/v1' },
    },
  },
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
  if (!['unasked', 'granted', 'declined'].includes(s.ai.consent)) s.ai.consent = 'unasked';
  if (!['off', 'model', 'summary'].includes(s.ai.prepare)) s.ai.prepare = 'off';
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
