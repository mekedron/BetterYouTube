import { anthropic, custom, gemini, openai, openrouter } from './apiProviders';
import { chromeBuiltin } from './chromeBuiltin';
import { connector } from './connector';
import type { AiProvider, ProviderConfig } from './types';
import type { Settings } from '../settings';

// Every provider the viewer can pick, by the id stored in settings.ai.provider,
// in the order the settings list them.
export const PROVIDERS: AiProvider[] = [chromeBuiltin, connector, openai, anthropic, gemini, openrouter, custom];

export function getProvider(id: string): AiProvider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** The provider's settings joined with its stored API key. */
export function providerConfig(settings: Settings, keys: Record<string, string>, id: string): ProviderConfig {
  const saved = settings.ai.providers[id as keyof Settings['ai']['providers']];
  return {
    model: saved?.model ?? '',
    effort: saved?.effort ?? 'default',
    baseUrl: saved?.baseUrl ?? '',
    agent: saved?.agent ?? 'claude',
    apiKey: keys[id] ?? '',
  };
}

/** Languages offered for providers that write in any language. */
export const COMMON_LANGUAGES = ['en', 'ru', 'uk', 'es', 'de', 'fr', 'it', 'pt', 'pl', 'nl', 'tr', 'ja', 'ko', 'zh'];

/**
 * The output language for a provider: the saved choice when the provider
 * supports it, else the browser language, else English.
 */
export function resolveLanguage(provider: AiProvider, saved: string, browserLanguage: string): string {
  const supports = (code: string) => !provider.languages || provider.languages.includes(code);
  if (saved !== 'auto' && supports(saved)) return saved;
  const base = browserLanguage.toLowerCase().split('-')[0];
  return supports(base) ? base : 'en';
}
