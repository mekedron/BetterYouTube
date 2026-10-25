<script lang="ts">
  import { EFFORTS } from '../../components/ai/apiProviders';
  import {
    AGENT_MODELS,
    detectAgents,
    installCommand,
    requestConnectorPermission,
  } from '../../components/ai/connector';
  import type { Detection } from '../../components/ai/connector';
  import { AGENT_NAMES, KEY_PAGES, providerLabel } from '../../components/ai/labels';
  import { getProvider, providerConfig } from '../../components/ai/providers';
  import { saveApiKey } from '../../components/ai/secrets';
  import type { ProviderStatus } from '../../components/ai/types';
  import { t } from '../../components/format';
  import type { ProviderSettings, Settings } from '../../components/settings';

  // The settings of the selected provider: key, model, effort, and for the
  // coding-agent provider, connecting to the connector.
  let { settings = $bindable(), keys = $bindable() }: { settings: Settings; keys: Record<string, string> } =
    $props();

  const id = $derived(settings.ai.provider as keyof Settings['ai']['providers']);
  const provider = $derived(getProvider(id));
  const own = $derived<ProviderSettings>(settings.ai.providers[id]);

  const EFFORT_LABELS = { default: 'effortDefault', low: 'effortLow', medium: 'effortMedium', high: 'effortHigh' } as const;

  // ---- Chrome built-in ----
  let builtinStatus = $state<ProviderStatus | null>(null);

  // ---- API key and models ----
  let keyDraft = $state('');
  let models = $state<string[]>([]);
  let modelsState = $state<'idle' | 'loading' | 'failed'>('idle');
  let modelsError = $state('');
  // fetch() fails with a TypeError, not an HTTP status, when a server refuses
  // the extension's origin, as Ollama does unless OLLAMA_ORIGINS allows it.
  let modelsUnreachable = $state(false);
  const OLLAMA_COMMAND = 'launchctl setenv OLLAMA_ORIGINS "chrome-extension://*,moz-extension://*"';
  const isLocal = $derived(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(settings.ai.providers.custom.baseUrl));
  let keyTimer = 0;

  // ---- Coding agent ----
  let detection = $state<Detection | null>(null);
  let checking = $state(false);
  let stillFailing = $state(false);
  let copied = $state(false);
  const command = installCommand();

  let preparedFor = '';
  $effect(() => {
    if (id === preparedFor) return;
    preparedFor = id;
    keyDraft = keys[id] ?? '';
    models = [];
    modelsState = 'idle';
    if (id === 'chrome-builtin') {
      void provider.status('en', providerConfig(settings, keys, id)).then((s) => (builtinStatus = s));
    } else if (id === 'agent') {
      void refreshAgents(false);
    } else {
      void loadModels();
    }
  });

  async function loadModels() {
    const config = providerConfig(settings, keys, id);
    if (!provider.listModels || (provider.needsKey && !config.apiKey)) return;
    modelsState = 'loading';
    modelsUnreachable = false;
    try {
      models = await provider.listModels(config);
      modelsState = 'idle';
      if (!own.model && provider.pickDefaultModel) settings.ai.providers[id].model = provider.pickDefaultModel(models);
    } catch (e) {
      modelsState = 'failed';
      modelsError = e instanceof Error ? e.message : String(e);
      modelsUnreachable = e instanceof TypeError;
    }
  }

  function onKeyInput() {
    clearTimeout(keyTimer);
    const key = keyDraft.trim();
    keyTimer = window.setTimeout(async () => {
      keys = { ...keys, [id]: key };
      await saveApiKey(id, key);
      void loadModels();
    }, 500);
  }

  async function refreshAgents(refresh: boolean) {
    checking = true;
    const before = detection;
    try {
      detection = await detectAgents(refresh);
    } finally {
      checking = false;
    }
    stillFailing = refresh && !!before && !before.ok && !detection.ok && before.reason === detection.reason;
    // Keep the chosen agent among the ones the connector found.
    if (detection.ok && detection.agents.length && !detection.agents.some((a) => a.id === own.agent)) {
      settings.ai.providers.agent.agent = detection.agents[0].id;
    }
  }

  async function allow() {
    if (await requestConnectorPermission()) await refreshAgents(true);
  }

  async function copyCommand(text = command) {
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

{#if id === 'chrome-builtin'}
  <div class="hint">
    {builtinStatus === 'unsupported'
      ? t('builtinUnsupported')
      : builtinStatus === 'ready'
        ? t('builtinReady')
        : t('builtinNeedsDownload')}
  </div>
{:else if id === 'agent'}
  <div class="hint">{t('agentIntro')}</div>
  {#if !detection}
    <div class="hint">…</div>
  {:else if !detection.ok && detection.reason === 'no-permission'}
    <button type="button" class="ghost" onclick={allow}>{t('agentAllow')}</button>
  {:else if !detection.ok && (detection.reason === 'not-installed' || detection.reason === 'not-allowed' || detection.reason === 'outdated')}
    <div class="hint">
      {detection.reason === 'outdated'
        ? t('agentOutdated')
        : detection.reason === 'not-allowed'
          ? t('agentNotAllowed')
          : t('agentInstall')}
    </div>
    <div class="command">
      <code>{command}</code>
      <button type="button" class="link" onclick={() => copyCommand()}>{copied ? t('agentCopied') : t('agentCopy')}</button>
    </div>
    <button type="button" class="ghost" disabled={checking} onclick={() => refreshAgents(true)}>
      {checking ? t('agentChecking') : t('agentCheck')}
    </button>
    {#if stillFailing && !checking}<div class="hint error">{t('agentStillFailing')}</div>{/if}
  {:else if !detection.ok}
    <div class="hint error">{t('agentFailed', undefined, { error: detection.message ?? '' })}</div>
    <button type="button" class="ghost" disabled={checking} onclick={() => refreshAgents(true)}>
      {checking ? t('agentChecking') : t('agentCheck')}
    </button>
    {#if stillFailing && !checking}<div class="hint error">{t('agentStillFailing')}</div>{/if}
  {:else if detection.agents.length === 0}
    <div class="hint">{t('agentNone')}</div>
    <button type="button" class="ghost" disabled={checking} onclick={() => refreshAgents(true)}>
      {checking ? t('agentChecking') : t('agentCheck')}
    </button>
    {#if stillFailing && !checking}<div class="hint error">{t('agentStillFailing')}</div>{/if}
  {:else}
    <div class="field">
      <span>{t('agentPick')}</span>
      <select bind:value={settings.ai.providers.agent.agent}>
        {#each detection.agents as agent (agent.id)}
          <option value={agent.id}>{AGENT_NAMES[agent.id]}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <span>{t('model')}</span>
      <input
        type="text"
        list="agent-models"
        bind:value={settings.ai.providers.agent.model}
        placeholder={t('effortDefault')}
      />
      <datalist id="agent-models">
        {#each AGENT_MODELS[own.agent] as model (model)}<option value={model}></option>{/each}
      </datalist>
    </div>
  {/if}
{:else}
  {#if id === 'custom'}
    <div class="field stacked">
      <span>{t('baseUrl')}</span>
      <input type="url" bind:value={settings.ai.providers.custom.baseUrl} onchange={loadModels} />
      <div class="hint">{t('baseUrlHint')}</div>
    </div>
  {/if}
  <div class="field stacked">
    <span class="label-row">
      {t('apiKey')}
      {#if KEY_PAGES[id]}<a href={KEY_PAGES[id]} target="_blank" rel="noreferrer">{t('getKey')}</a>{/if}
    </span>
    <input type="password" autocomplete="off" spellcheck="false" bind:value={keyDraft} oninput={onKeyInput} />
    <div class="hint">{t('apiKeyHint', undefined, { name: providerLabel(id) })}</div>
  </div>
  <div class="field">
    <span>{t('model')}</span>
    {#if models.length}
      <select bind:value={settings.ai.providers[id].model}>
        {#if own.model && !models.includes(own.model)}<option value={own.model}>{own.model}</option>{/if}
        {#each models as model (model)}<option value={model}>{model}</option>{/each}
      </select>
    {:else}
      <input type="text" bind:value={settings.ai.providers[id].model} placeholder={t('modelPlaceholder')} />
    {/if}
  </div>
  {#if modelsState === 'loading'}<div class="hint">{t('modelsLoading')}</div>{/if}
  {#if modelsState === 'failed'}<div class="hint error">{t('modelsFailed', undefined, { error: modelsError })}</div>{/if}
  {#if modelsState === 'failed' && modelsUnreachable && id === 'custom' && isLocal}
    <div class="hint">{t('ollamaOrigins')}</div>
    <div class="command">
      <code>{OLLAMA_COMMAND}</code>
      <button type="button" class="link" onclick={() => copyCommand(OLLAMA_COMMAND)}>{copied ? t('agentCopied') : t('agentCopy')}</button>
    </div>
    <button type="button" class="ghost" onclick={loadModels}>{t('agentCheck')}</button>
  {/if}
{/if}

{#if id !== 'chrome-builtin' && (id !== 'agent' || (detection?.ok && detection.agents.length))}
  <div class="field">
    <span>{t('effort')}</span>
    <select bind:value={settings.ai.providers[id].effort}>
      {#each EFFORTS as effort (effort)}<option value={effort}>{t(EFFORT_LABELS[effort])}</option>{/each}
    </select>
  </div>
  <div class="hint">{t('effortHint')}</div>
{/if}

<style>
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--body);
    font: 400 12.5px/1.3 var(--font);
  }
  .field.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 5px;
  }
  .label-row {
    display: flex;
    justify-content: space-between;
  }
  .label-row a {
    color: var(--accent-ink);
    text-decoration: none;
  }
  input,
  select {
    min-width: 0;
    max-width: 62%;
    padding: 6px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--panel);
    color: var(--fg);
    font: 500 12.5px/1.2 var(--font);
  }
  .stacked input {
    max-width: none;
  }
  input:focus,
  select:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .hint {
    color: var(--muted);
    font: 400 12px/1.4 var(--font);
  }
  .hint.error {
    color: var(--danger);
  }
  .command {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--chip);
  }
  code {
    flex: 1;
    min-width: 0;
    color: var(--fg);
    font: 500 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
  }
  .ghost {
    align-self: flex-start;
    padding: 7px 11px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: transparent;
    color: var(--fg);
    font: 500 12.5px/1 var(--font);
    cursor: pointer;
  }
  .ghost:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .link {
    flex: none;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-ink);
    font: 600 12px/1.45 var(--font);
    cursor: pointer;
  }
</style>
