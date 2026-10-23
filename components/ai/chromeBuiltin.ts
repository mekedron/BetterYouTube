import type { AiProvider, AiSession, ProviderStatus, SessionOptions } from './types';

// Chrome's built-in model (Gemini Nano) through the Prompt API. It runs on the
// viewer's device: nothing leaves the browser, and there is no key or account.
// The model is downloaded once per browser profile; Chrome starts that
// download only from a click.

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelSession {
  promptStreaming(input: string, options?: { signal?: AbortSignal }): ReadableStream<string>;
  measureContextUsage(input: string): Promise<number>;
  readonly contextUsage: number;
  readonly contextWindow: number;
  destroy(): void;
}

interface LanguageModelStatic {
  availability(options?: object): Promise<Availability>;
  create(options?: object): Promise<LanguageModelSession>;
}

function api(): LanguageModelStatic | undefined {
  return (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
}

/** Output languages Chrome accepts for this model. */
const LANGUAGES = ['en', 'es', 'ja', 'de', 'fr'];

// Only the output language is declared. Transcripts come in any language, and
// declaring an input language Chrome does not list makes the model unavailable.
function expectations(language: string) {
  return { expectedOutputs: [{ type: 'text', languages: [language] }] };
}

class ChromeSession implements AiSession {
  constructor(private session: LanguageModelSession) {}

  async *ask(text: string, signal?: AbortSignal): AsyncIterable<string> {
    const reader = this.session.promptStreaming(text, { signal }).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async measure(text: string) {
    const tokens = await this.session.measureContextUsage(text);
    return { tokens, room: this.session.contextWindow - this.session.contextUsage };
  }

  destroy() {
    this.session.destroy();
  }
}

export const chromeBuiltin: AiProvider = {
  id: 'chrome-builtin',
  languages: LANGUAGES,

  async status(language): Promise<ProviderStatus> {
    const model = api();
    if (!model) return 'unsupported';
    try {
      const availability = await model.availability(expectations(language));
      if (availability === 'available') return 'ready';
      if (availability === 'downloadable') return 'needs-download';
      if (availability === 'downloading') return 'downloading';
    } catch {}
    return 'unsupported';
  },

  async createSession(options: SessionOptions): Promise<AiSession> {
    const model = api();
    if (!model) throw new Error('unsupported');
    const session = await model.create({
      ...expectations(options.language),
      initialPrompts: [{ role: 'system', content: options.system }, ...options.history],
      signal: options.signal,
      monitor(monitor: EventTarget) {
        monitor.addEventListener('downloadprogress', (event) => {
          options.onDownloadProgress?.((event as ProgressEvent).loaded);
        });
      },
    });
    return new ChromeSession(session);
  },
};
