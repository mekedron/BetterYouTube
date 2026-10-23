import { t } from '../format';
import type { AgentId } from './connectorProtocol';

// Display names for providers and agents.

const PROVIDER_LABELS = {
  'chrome-builtin': 'providerChromeBuiltin',
  agent: 'providerAgent',
  openai: 'providerOpenai',
  anthropic: 'providerAnthropic',
  gemini: 'providerGemini',
  openrouter: 'providerOpenrouter',
  custom: 'providerCustom',
} as const;

export function providerLabel(id: string): string {
  return t(PROVIDER_LABELS[id as keyof typeof PROVIDER_LABELS] ?? 'providerChromeBuiltin');
}

export const AGENT_NAMES: Record<AgentId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
};

/** Where to create an API key, per provider. */
export const KEY_PAGES: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
};
