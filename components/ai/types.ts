// The contract every AI provider implements. The summary flow in
// summarize.ts talks only to these types, so the popup works the same with
// Chrome's built-in model, a cloud API and the viewer's key, or a coding agent
// on the viewer's computer.

import type { AgentId } from './connectorProtocol';

export type ProviderStatus =
  /** Works right now. */
  | 'ready'
  /** Works after a one-time download that needs a click from the viewer. */
  | 'needs-download'
  /** That download is in progress. */
  | 'downloading'
  /** Needs something from the viewer first: a key, a model, the connector. */
  | 'needs-setup'
  /** Not available in this browser or on this device. */
  | 'unsupported';

export type Effort = 'default' | 'low' | 'medium' | 'high';

/** A provider's settings, from settings.ai.providers plus the stored key. */
export interface ProviderConfig {
  model: string;
  effort: Effort;
  /** OpenAI-compatible endpoint, for the custom provider. */
  baseUrl: string;
  /** Which coding agent the connector runs. */
  agent: AgentId;
  /** Kept in storage.local only, never in synced settings. */
  apiKey: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionOptions {
  /** Standing instructions for the whole conversation. */
  system: string;
  /** Earlier turns to restore, oldest first. */
  history: ChatTurn[];
  /** Output language as a BCP 47 code; providers with `languages` accept only those. */
  language: string;
  config: ProviderConfig;
  /** Model download progress, 0..1, when the provider has to download. */
  onDownloadProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface AiSession {
  /** Sends a user turn and yields the reply as it is written, chunk by chunk. */
  ask(text: string, signal?: AbortSignal): AsyncIterable<string>;
  /**
   * How many more tokens of input fit, and how many `text` would take.
   * The summary flow splits a transcript that does not fit.
   */
  measure(text: string): Promise<{ tokens: number; room: number }>;
  destroy(): void;
}

export interface AiProvider {
  id: string;
  /** Output languages the provider supports, or null for any. */
  languages: string[] | null;
  /** True when the provider uses an API key. */
  needsKey: boolean;
  status(language: string, config: ProviderConfig): Promise<ProviderStatus>;
  createSession(options: SessionOptions): Promise<AiSession>;
  /** Model ids to offer in settings; empty when the provider cannot list them. */
  listModels?(config: ProviderConfig): Promise<string[]>;
  /** The model to use when the viewer has not picked one, chosen from listModels. */
  pickDefaultModel?(models: string[]): string;
}

/** An error with a message meant for the viewer, such as "Invalid API key". */
export class ProviderError extends Error {}
