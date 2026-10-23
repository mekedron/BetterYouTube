<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fingerprint, forgetConversation, loadConversation, saveConversation } from '../../components/ai/cache';
  import { detectAgents, hasConnectorPermission } from '../../components/ai/connector';
  import { AGENT_NAMES, providerLabel } from '../../components/ai/labels';
  import { preparedStatus } from '../../components/ai/prepare';
  import { getProvider, providerConfig, resolveLanguage } from '../../components/ai/providers';
  import { Conversation, DEFAULT_INSTRUCTION } from '../../components/ai/summarize';
  import type { Stage } from '../../components/ai/summarize';
  import { ProviderError } from '../../components/ai/types';
  import type { ChatTurn, ProviderStatus } from '../../components/ai/types';
  import { t } from '../../components/format';
  import { renderMarkdown } from '../../components/markdown';
  import type { PageResponse, RuntimeMessage } from '../../components/protocol';
  import type { Settings } from '../../components/settings';

  let {
    settings = $bindable(),
    keys,
    tabId,
    videoId,
    onOpenSettings,
  }: {
    settings: Settings;
    keys: Record<string, string>;
    tabId: number | undefined;
    videoId: string | null;
    onOpenSettings: () => void;
  } = $props();

  const provider = $derived(getProvider(settings.ai.provider));
  const language = $derived(resolveLanguage(provider, settings.ai.language, browser.i18n.getUILanguage()));
  const instruction = $derived(settings.ai.prompt.trim() || DEFAULT_INSTRUCTION);
  const config = $derived(providerConfig(settings, keys, provider.id));
  const print = $derived(fingerprint(provider.id, config, language, instruction));
  // Agents the connector already found, to mention them on the first-run card.
  let foundAgents = $state<string[]>([]);
  void hasConnectorPermission().then(async (granted) => {
    if (!granted) return;
    const found = await detectAgents();
    if (found.ok) foundAgents = found.agents.map((a) => AGENT_NAMES[a.id]);
  });

  let status = $state<ProviderStatus | null>(null);
  let history = $state<ChatTurn[]>([]);
  let streaming = $state('');
  let pendingQuestion = $state('');
  let running = $state(false);
  let stage = $state<Stage | null>(null);
  let error = $state('');
  let question = $state('');

  let conversation: Conversation | null = null;
  // Closing the popup stops the model instead of leaving it running unseen.
  const abort = new AbortController();
  onDestroy(() => {
    abort.abort();
    conversation?.destroy();
  });

  const options = () => ({
    provider,
    config,
    language,
    signal: abort.signal,
    // Chrome reports download progress on every new session, even with the
    // model already on disk; only a real download is shown.
    onStage: (s: Stage) => {
      if (s.kind === 'downloading' && status === 'ready') return;
      stage = s;
    },
  });

  const summary = $derived(history[1]?.content ?? '');
  const followUps = $derived.by(() => {
    const pairs: Array<{ q: string; a: string }> = [];
    for (let i = 2; i + 1 < history.length; i += 2) pairs.push({ q: history[i].content, a: history[i + 1].content });
    return pairs;
  });

  // Loads the provider state and any saved summary whenever the video, the
  // provider, the language or the instruction changes.
  let loadedFor = '';
  $effect(() => {
    const key = `${videoId}|${print}`;
    if (!videoId || key === loadedFor) return;
    loadedFor = key;
    void prepare(videoId);
  });

  async function prepare(id: string) {
    conversation?.destroy();
    conversation = null;
    history = [];
    error = '';
    status = await provider.status(language, config);
    const saved = (await loadConversation(id, print)) ?? (await followPrepared(id));
    if (saved) {
      history = saved;
      conversation = Conversation.restore(options(), saved);
    } else if (settings.ai.consent === 'granted' && settings.ai.autoSummarize && status === 'ready') {
      void run();
    }
  }

  // Shows a summary the offscreen document is writing for this video (see
  // components/ai/prepare.ts) as it grows, and returns it once finished.
  // Closing the popup leaves that run going; it lands in the cache.
  async function followPrepared(id: string): Promise<ChatTurn[] | null> {
    let prepared = await preparedStatus(id, print);
    if (prepared?.state !== 'running') return prepared?.state === 'done' ? prepared.history : null;
    running = true;
    try {
      while (prepared?.state === 'running' && !abort.signal.aborted) {
        streaming = prepared.text;
        stage = prepared.stage;
        await new Promise((resolve) => setTimeout(resolve, 200));
        prepared = await preparedStatus(id, print);
      }
    } finally {
      streaming = '';
      stage = null;
      running = false;
    }
    return prepared?.state === 'done' ? prepared.history : null;
  }

  async function run() {
    if (!videoId || tabId === undefined || running) return;
    const id = videoId;
    running = true;
    error = '';
    streaming = '';
    stage = { kind: 'reading' };
    browser.runtime.sendMessage({ type: 'summary-started', videoId: id } satisfies RuntimeMessage).catch(() => {});
    try {
      const message: RuntimeMessage = { type: 'get-video-context' };
      const response = (await browser.tabs.sendMessage(tabId, message)) as PageResponse | undefined;
      if (!response?.ok) {
        error = response?.error === 'no-transcript' ? t('errNoTranscript') : t('errFailed');
        return;
      }
      conversation?.destroy();
      conversation = new Conversation(options());
      for await (const chunk of conversation.summarize(response.data, instruction)) streaming += chunk;
      history = conversation.history;
      await saveConversation(id, print, history);
      status = 'ready';
    } catch (e) {
      if (!abort.signal.aborted) error = modelError(e);
    } finally {
      streaming = '';
      running = false;
      stage = null;
    }
  }

  // Provider errors carry the API's own words, such as an invalid key.
  function modelError(e: unknown): string {
    return e instanceof ProviderError ? `${t('errModel')} ${e.message}` : t('errModel');
  }

  async function ask(event: SubmitEvent) {
    event.preventDefault();
    const q = question.trim();
    if (!q || !conversation || running || !videoId) return;
    const id = videoId;
    question = '';
    pendingQuestion = q;
    running = true;
    error = '';
    try {
      for await (const chunk of conversation.ask(q)) streaming += chunk;
      history = conversation.history;
      await saveConversation(id, print, history);
    } catch (e) {
      if (!abort.signal.aborted) error = modelError(e);
    } finally {
      pendingQuestion = '';
      streaming = '';
      running = false;
      stage = null;
    }
  }

  async function again() {
    if (!videoId) return;
    await forgetConversation(videoId);
    history = [];
    void run();
  }

  function turnOn() {
    settings.ai.consent = 'granted';
    if (status === 'ready' || status === 'needs-download') void run();
    else onOpenSettings();
  }

  const stageText = $derived.by(() => {
    if (!stage) return '';
    if (stage.kind === 'downloading') return t('stageDownloading', Math.round(stage.progress * 100));
    if (stage.kind === 'part') return t('stagePart', stage.index, { total: stage.count });
    if (stage.kind === 'reading') return t('stageReading');
    return t('stageWriting');
  });
</script>

<div class="summary">
  {#if !videoId}
    <div class="card note">{t('notVideo')}</div>
  {:else if settings.ai.consent === 'unasked'}
    <div class="card intro">
      <div class="intro-title">{t('aiIntroTitle')}</div>
      {#if provider.id === 'chrome-builtin' && status !== 'unsupported'}
        <p>{t('aiIntroText')}</p>
        {#if status === 'needs-download'}<p class="muted">{t('aiIntroDownload')}</p>{/if}
        {#if foundAgents.length}<p class="muted">{t('aiAlsoAgents', undefined, { list: foundAgents.join(', ') })}</p>{/if}
      {:else}
        <p>{t('aiIntroTextOther')}</p>
      {/if}
      <div class="actions">
        <button type="button" class="primary" onclick={turnOn}>
          {status === 'ready' || status === 'needs-download' ? t('aiTurnOn') : t('aiSetUp')}
        </button>
        <button type="button" class="ghost" onclick={() => (settings.ai.consent = 'declined')}>{t('aiNotNow')}</button>
      </div>
    </div>
  {:else if settings.ai.consent === 'declined'}
    <div class="card note">
      <p>{t('aiOff')}</p>
      <button type="button" class="ghost" onclick={turnOn}>{t('aiTurnOn')}</button>
    </div>
  {:else if status === 'needs-setup' || status === 'unsupported'}
    <div class="card note">
      <p>{status === 'unsupported' ? t('aiUnsupported') : t('aiNeedsSetup', undefined, { name: providerLabel(provider.id) })}</p>
      <button type="button" class="ghost" onclick={onOpenSettings}>{t('aiOpenSettings')}</button>
    </div>
  {:else}
    <div class="card result" aria-live="polite">
      {#if summary}
        <div class="md">{@html renderMarkdown(summary)}</div>
      {:else if streaming && !pendingQuestion}
        <div class="md">{@html renderMarkdown(streaming)}</div>
      {:else if !running && !error}
        {#if status === 'needs-download'}<p class="muted">{t('aiNeedsDownload')}</p>{/if}
        <button type="button" class="primary" onclick={run}>
          {status === 'needs-download' ? t('aiDownload') : t('summarize')}
        </button>
      {/if}

      {#each followUps as turn, i (i)}
        <div class="q">{turn.q}</div>
        <div class="md">{@html renderMarkdown(turn.a)}</div>
      {/each}
      {#if pendingQuestion}
        <div class="q">{pendingQuestion}</div>
        {#if streaming}<div class="md">{@html renderMarkdown(streaming)}</div>{/if}
      {/if}

      {#if running && !streaming}
        <div class="stage"><span class="spinner"></span>{stageText}</div>
      {/if}
      {#if error}<div class="error">{error}</div>{/if}
    </div>

    {#if summary}
      <form class="ask" onsubmit={ask}>
        <input type="text" bind:value={question} placeholder={t('askPlaceholder')} disabled={running} />
        <button type="submit" class="primary" disabled={running || !question.trim()}>{t('ask')}</button>
      </form>
      <button type="button" class="link" onclick={again} disabled={running}>{t('summarizeAgain')}</button>
    {/if}
  {/if}
</div>

<style>
  .summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card {
    padding: 12px;
    border-radius: 14px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--body);
    font: 400 13px/1.5 var(--font);
  }
  .card p {
    margin: 0 0 10px;
  }
  .note p:last-child,
  .intro p:last-of-type {
    margin-bottom: 0;
  }
  .note {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }
  .intro-title {
    margin-bottom: 6px;
    color: var(--fg);
    font: 650 14px/1.3 var(--font);
  }
  .muted {
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .result {
    max-height: 280px;
    overflow-y: auto;
  }
  .md :global(p) {
    margin: 0 0 8px;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 8px;
    padding-left: 18px;
  }
  .md :global(li) {
    margin: 0 0 4px;
  }
  .md :global(li::marker) {
    color: var(--accent);
  }
  .md :global(strong) {
    color: var(--fg);
    font-weight: 600;
  }
  .q {
    margin: 12px 0 6px;
    padding: 7px 10px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--fg);
    font-weight: 500;
  }
  .stage {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--track);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error {
    margin-top: 6px;
    color: var(--danger);
  }
  .ask {
    display: flex;
    gap: 6px;
  }
  .ask input {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: var(--panel);
    color: var(--fg);
    font: 400 13px/1.2 var(--font);
  }
  .ask input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .primary,
  .ghost,
  .link {
    padding: 8px 12px;
    border-radius: 9px;
    font: 600 12.5px/1 var(--font);
    cursor: pointer;
  }
  .primary {
    border: 0;
    background: var(--accent);
    color: #1a1205;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ghost {
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--fg);
  }
  .link {
    align-self: flex-start;
    padding: 2px 4px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-weight: 500;
  }
  .link:hover:not(:disabled) {
    color: var(--fg);
  }
</style>
