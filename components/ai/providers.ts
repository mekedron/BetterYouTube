import { chromeBuiltin } from './chromeBuiltin';
import type { AiProvider } from './types';

// Every provider the viewer can pick, by the id stored in settings.ai.provider.
export const PROVIDERS: AiProvider[] = [chromeBuiltin];

export function getProvider(id: string): AiProvider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

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
