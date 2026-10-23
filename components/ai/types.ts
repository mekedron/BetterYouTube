// The contract every AI provider implements. The summary flow in
// summarize.ts talks only to these types, so a provider that calls a cloud
// API with the viewer's key, or one that reaches a local coding agent, plugs
// in next to Chrome's built-in model without touching the popup.

export type ProviderStatus =
  /** Works right now. */
  | 'ready'
  /** Works after a one-time download that needs a click from the viewer. */
  | 'needs-download'
  /** That download is in progress. */
  | 'downloading'
  /** Not available in this browser or on this device. */
  | 'unsupported';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionOptions {
  /** Standing instructions for the whole conversation. */
  system: string;
  /** Earlier turns to restore, oldest first. */
  history: ChatTurn[];
  /** Output language as a BCP 47 code from the provider's `languages`. */
  language: string;
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
  status(language: string): Promise<ProviderStatus>;
  createSession(options: SessionOptions): Promise<AiSession>;
}
