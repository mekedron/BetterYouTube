<script lang="ts">
  import { saveApiKey } from '../../components/ai/secrets';
  import { DEFAULT_CRITERIA, HOST_PERMISSION, KEY_SLOT } from '../../components/feedAi';
  import type { FeedAiService } from '../../components/feedAi';
  import { t } from '../../components/format';
  import type { Settings } from '../../components/settings';

  // The feed's AI mode: which decision service judges the videos, its key,
  // how much it sees, the viewer's criteria and how strict it is.
  let { settings = $bindable(), keys = $bindable() }: { settings: Settings; keys: Record<string, string> } =
    $props();

  const NAMES: Record<FeedAiService, string> = { openai: 'OpenAI Decisions', jev: 'TypeSafe Jev' };
  const KEY_PAGES: Record<FeedAiService, string> = {
    openai: 'https://platform.openai.com/api-keys',
    jev: 'https://console.typesafe.ai/keys',
  };

  const ai = $derived(settings.feed.ai);
  const slot = $derived(KEY_SLOT[ai.service]);
  let keyDraft = $state('');
  let keyTimer = 0;
  $effect(() => {
    keyDraft = keys[slot] ?? '';
  });

  function onKeyInput() {
    clearTimeout(keyTimer);
    const key = keyDraft.trim();
    const target = slot;
    keyTimer = window.setTimeout(async () => {
      keys = { ...keys, [target]: key };
      await saveApiKey(target, key);
    }, 500);
  }

  // Jev's API needs a host permission; the browser grants it only from a click.
  let allowed = $state(true);
  $effect(() => {
    const origin = HOST_PERMISSION[ai.service];
    if (!origin) {
      allowed = true;
      return;
    }
    void browser.permissions.contains({ origins: [origin] }).then((granted) => (allowed = granted));
  });

  async function allow() {
    const origin = HOST_PERMISSION[ai.service];
    if (origin) allowed = await browser.permissions.request({ origins: [origin] }).catch(() => false);
  }

  function pick(service: FeedAiService) {
    settings.feed.ai.service = service;
    const origin = HOST_PERMISSION[service];
    // Asked right in the click, while the browser still counts it as one.
    if (origin) void browser.permissions.request({ origins: [origin] }).then((granted) => (allowed = granted)).catch(() => {});
  }
</script>

<div class="row stacked">
  <div class="title">{t('feedAiService')}</div>
  <div class="segmented" role="radiogroup" aria-label={t('feedAiService')}>
    {#each ['openai', 'jev'] as const as service (service)}
      <label>
        <input type="radio" name="feed-ai-service" checked={ai.service === service} onclick={() => pick(service)} />{NAMES[service]}
      </label>
    {/each}
  </div>
  {#if !allowed}
    <div class="hint">{t('feedAiAllowHint')}</div>
    <button type="button" class="ghost" onclick={allow}>{t('feedAiAllow')}</button>
  {/if}
  <div class="field">
    <span class="label-row">
      {t('apiKey')}
      <a href={KEY_PAGES[ai.service]} target="_blank" rel="noreferrer">{t('getKey')}</a>
    </span>
    <input type="password" autocomplete="off" spellcheck="false" bind:value={keyDraft} oninput={onKeyInput} />
    <div class="hint">{t('feedAiKeyHint', undefined, { name: NAMES[ai.service] })}</div>
  </div>
</div>

<div class="row stacked">
  <div class="title">{t('feedAiDepth')}</div>
  <div class="segmented" role="radiogroup" aria-label={t('feedAiDepth')}>
    <label><input type="radio" bind:group={settings.feed.ai.depth} value="card" />{t('feedAiDepthCard')}</label>
    <label><input type="radio" bind:group={settings.feed.ai.depth} value="full" />{t('feedAiDepthFull')}</label>
  </div>
  <div class="hint">{ai.depth === 'card' ? t('feedAiDepthCardHint') : t('feedAiDepthFullHint')}</div>
</div>

<div class="row stacked">
  <div class="prompt-head">
    <span class="title">{t('feedAiCriteria')}</span>
    {#if ai.criteria}
      <button type="button" class="link" onclick={() => (settings.feed.ai.criteria = '')}>{t('aiPromptReset')}</button>
    {:else}
      <button type="button" class="link" onclick={() => (settings.feed.ai.criteria = DEFAULT_CRITERIA)}>{t('aiPromptEdit')}</button>
    {/if}
  </div>
  <textarea rows="6" bind:value={settings.feed.ai.criteria} placeholder={DEFAULT_CRITERIA}></textarea>
  <div class="hint">{t('feedAiCriteriaHint')}</div>
</div>

<div class="row stacked">
  <div class="title">{t('feedAiStrictness')}</div>
  <div class="segmented" role="radiogroup" aria-label={t('feedAiStrictness')}>
    <label><input type="radio" bind:group={settings.feed.ai.strictness} value="lenient" />{t('feedAiLenient')}</label>
    <label><input type="radio" bind:group={settings.feed.ai.strictness} value="balanced" />{t('feedAiBalanced')}</label>
    <label><input type="radio" bind:group={settings.feed.ai.strictness} value="strict" />{t('feedAiStrict')}</label>
  </div>
</div>

<style>
  .row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
  }
  .row + .row {
    border-top: 1px solid var(--border);
  }
  .title {
    color: var(--fg);
    font: 500 13.5px/1.3 var(--font);
  }
  .hint {
    color: var(--muted);
    font: 400 12px/1.4 var(--font);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    color: var(--body);
    font: 400 12.5px/1.3 var(--font);
  }
  .label-row {
    display: flex;
    justify-content: space-between;
  }
  .label-row a {
    color: var(--accent-ink);
    text-decoration: none;
  }
  input[type='password'],
  textarea {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    background: var(--panel);
    color: var(--fg);
    font: 400 12.5px/1.4 var(--font);
  }
  textarea {
    resize: vertical;
    padding: 8px 10px;
    border-radius: 9px;
  }
  input:focus,
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  .prompt-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: 500 12px/1 var(--font);
    cursor: pointer;
  }
  .link:hover {
    color: var(--fg);
  }
  .segmented {
    display: inline-flex;
    align-self: flex-start;
    padding: 2px;
    border-radius: 9px;
    background: var(--chip);
  }
  .segmented label {
    padding: 5px 11px;
    border-radius: 7px;
    color: var(--muted);
    font: 500 12.5px/1 var(--font);
    cursor: pointer;
    user-select: none;
  }
  .segmented input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .segmented label:has(input:checked) {
    background: var(--raised);
    color: var(--fg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .segmented label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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
  .ghost:hover {
    background: var(--chip);
  }
</style>
