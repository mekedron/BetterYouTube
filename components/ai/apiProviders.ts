import { HistorySession } from './historySession';
import type { StreamReply } from './historySession';
import { ensureOk, postWithFallback, readSse } from './http';
import type { AiProvider, ChatTurn, Effort, ProviderConfig, ProviderStatus } from './types';

// Cloud providers called straight from the extension with the viewer's own
// API key. All of them answer cross-origin requests from extensions, so no
// host permission is needed. The key goes only to the provider's own API.

/** Input kept well under every listed model's context window. */
const CONTEXT_TOKENS = 100_000;
const MAX_REPLY_TOKENS = 4096;

function apiStatus(needsKey: boolean) {
  return async (_language: string, config: ProviderConfig): Promise<ProviderStatus> => {
    if (needsKey && !config.apiKey) return 'needs-setup';
    if (!config.model) return 'needs-setup';
    return 'ready';
  };
}

function session(stream: (config: ProviderConfig) => StreamReply) {
  return async (options: { system: string; history: ChatTurn[]; config: ProviderConfig }) =>
    new HistorySession(options.system, options.history, stream(options.config), CONTEXT_TOKENS);
}

/** The newest-looking id among those matching `test`; ids sort by version when compared naturally. */
function newest(models: string[], test: (id: string) => boolean): string {
  const matches = models.filter(test);
  matches.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  return matches[0] ?? models[0] ?? '';
}

// ---- OpenAI-compatible: OpenAI, OpenRouter, and any custom endpoint ----

function openAiCompatible(baseUrl: (c: ProviderConfig) => string, extraHeaders: Record<string, string> = {}) {
  const headers = (c: ProviderConfig) => ({
    'content-type': 'application/json',
    ...(c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {}),
    ...extraHeaders,
  });

  const stream =
    (c: ProviderConfig): StreamReply =>
    async function* (system, turns, signal) {
      const res = await postWithFallback(
        `${baseUrl(c)}/chat/completions`,
        { headers: headers(c), signal },
        { model: c.model, stream: true, messages: [{ role: 'system', content: system }, ...turns] },
        c.effort === 'default' ? null : { reasoning_effort: c.effort },
      );
      await ensureOk(res);
      for await (const data of readSse(res, signal)) {
        if (data === '[DONE]') return;
        const event = JSON.parse(data);
        if (event.error) throw new Error(event.error.message ?? 'error');
        const text = event.choices?.[0]?.delta?.content;
        if (text) yield text;
      }
    };

  const listModels = async (c: ProviderConfig) => {
    const res = await fetch(`${baseUrl(c)}/models`, { headers: headers(c) });
    await ensureOk(res);
    const body = await res.json();
    return ((body.data ?? []) as Array<{ id: string }>).map((m) => m.id).sort();
  };

  return { stream, listModels };
}

const openAiApi = openAiCompatible(() => 'https://api.openai.com/v1');

export const openai: AiProvider = {
  id: 'openai',
  languages: null,
  needsKey: true,
  status: apiStatus(true),
  createSession: session(openAiApi.stream),
  // Only text chat models; the list also holds audio, image and embedding ones.
  listModels: async (c) =>
    (await openAiApi.listModels(c)).filter(
      (id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|image|transcribe|search|embedding/.test(id),
    ),
  pickDefaultModel: (models) => newest(models, (id) => /^gpt-[\d.]+-mini$/.test(id)),
};

const openRouterApi = openAiCompatible(() => 'https://openrouter.ai/api/v1', {
  'HTTP-Referer': 'https://mekedron.github.io/BetterYouTube/',
  'X-Title': 'BetterYouTube',
});

export const openrouter: AiProvider = {
  id: 'openrouter',
  languages: null,
  needsKey: true,
  status: apiStatus(true),
  createSession: session(openRouterApi.stream),
  listModels: openRouterApi.listModels,
  pickDefaultModel: (models) => newest(models, (id) => /^google\/gemini-[\d.]+-flash$/.test(id)),
};

const customApi = openAiCompatible((c) => c.baseUrl.replace(/\/+$/, ''));

export const custom: AiProvider = {
  id: 'custom',
  languages: null,
  needsKey: false,
  status: async (_language, c) => (c.baseUrl && c.model ? 'ready' : 'needs-setup'),
  createSession: session(customApi.stream),
  listModels: (c) => (c.baseUrl ? customApi.listModels(c) : Promise.resolve([])),
  pickDefaultModel: (models) => models[0] ?? '',
};

// ---- Anthropic ----

const ANTHROPIC = 'https://api.anthropic.com/v1';

function anthropicHeaders(c: ProviderConfig) {
  return {
    'content-type': 'application/json',
    'x-api-key': c.apiKey,
    'anthropic-version': '2023-06-01',
    // The key belongs to the viewer and stays in their browser.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

const anthropicStream =
  (c: ProviderConfig): StreamReply =>
  async function* (system, turns, signal) {
    const res = await postWithFallback(
      `${ANTHROPIC}/messages`,
      { headers: anthropicHeaders(c), signal },
      { model: c.model, max_tokens: MAX_REPLY_TOKENS, stream: true, system, messages: turns },
      c.effort === 'default' ? null : { output_config: { effort: c.effort } },
    );
    await ensureOk(res);
    for await (const data of readSse(res, signal)) {
      const event = JSON.parse(data);
      if (event.type === 'error') throw new Error(event.error?.message ?? 'error');
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') yield event.delta.text;
    }
  };

export const anthropic: AiProvider = {
  id: 'anthropic',
  languages: null,
  needsKey: true,
  status: apiStatus(true),
  createSession: session(anthropicStream),
  listModels: async (c) => {
    const res = await fetch(`${ANTHROPIC}/models?limit=1000`, { headers: anthropicHeaders(c) });
    await ensureOk(res);
    return (((await res.json()).data ?? []) as Array<{ id: string }>).map((m) => m.id);
  },
  pickDefaultModel: (models) => newest(models, (id) => /haiku/.test(id)),
};

// ---- Google Gemini ----

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

const geminiStream =
  (c: ProviderConfig): StreamReply =>
  async function* (system, turns, signal) {
    const res = await postWithFallback(
      `${GEMINI}/models/${encodeURIComponent(c.model)}:streamGenerateContent?alt=sse`,
      { headers: { 'content-type': 'application/json', 'x-goog-api-key': c.apiKey }, signal },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.content }] })),
      },
      c.effort === 'default' ? null : { generationConfig: { thinkingConfig: { thinkingLevel: c.effort } } },
    );
    await ensureOk(res);
    for await (const data of readSse(res, signal)) {
      const event = JSON.parse(data);
      if (event.error) throw new Error(event.error.message ?? 'error');
      for (const part of event.candidates?.[0]?.content?.parts ?? []) {
        if (part.text && !part.thought) yield part.text;
      }
    }
  };

export const gemini: AiProvider = {
  id: 'gemini',
  languages: null,
  needsKey: true,
  status: apiStatus(true),
  createSession: session(geminiStream),
  listModels: async (c) => {
    const res = await fetch(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': c.apiKey } });
    await ensureOk(res);
    const models = ((await res.json()).models ?? []) as Array<{ name: string; supportedGenerationMethods?: string[] }>;
    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((id) => /^gemini/.test(id) && !/image|tts|embedding|audio|live/.test(id));
  },
  pickDefaultModel: (models) => newest(models, (id) => /^gemini-[\d.]+-flash$/.test(id)),
};

export const EFFORTS: Effort[] = ['default', 'low', 'medium', 'high'];
