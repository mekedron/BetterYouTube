<script lang="ts">
  import { onMount } from 'svelte';
  import { AUDIENCE_STEPS, LIKE_STEPS, t } from '../../components/format';
  import type { RuntimeMessage, TabStats } from '../../components/protocol';
  import { loadSettings, saveSettings } from '../../components/settings';
  import type { Settings } from '../../components/settings';
  import StepSlider from './StepSlider.svelte';
  import Switch from './Switch.svelte';

  const WEBSITE = 'https://mekedron.github.io/BetterYouTube/';
  const SUPPORT = 'https://buymeacoffee.com/mekedron';
  const version = browser.runtime.getManifest().version;

  let settings = $state<Settings | null>(null);
  // null: the active tab is not a YouTube page (or not loaded yet).
  let stats = $state<TabStats | null>(null);
  let tabId: number | undefined;
  let cacheNote = $state('');

  const TABS = ['feed', 'shorts', 'general'] as const;
  type Tab = (typeof TABS)[number];
  const TAB_LABELS = { feed: 'tabFeed', shorts: 'tabShorts', general: 'tabGeneral' } as const;
  const TAB_KEY = 'popup-tab';

  function savedTab(): Tab {
    try {
      const value = localStorage.getItem(TAB_KEY);
      return TABS.includes(value as Tab) ? (value as Tab) : 'feed';
    } catch {
      return 'feed';
    }
  }

  let tab = $state<Tab>(savedTab());

  function selectTab(id: Tab) {
    tab = id;
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {}
  }

  // Every edit is saved; the content scripts pick it up from storage.
  let lastSaved = '';
  $effect(() => {
    if (!settings) return;
    const json = JSON.stringify(settings);
    if (json === lastSaved) return;
    lastSaved = json;
    void saveSettings($state.snapshot(settings) as Settings);
  });

  async function refreshStats() {
    if (tabId === undefined) return;
    try {
      const message: RuntimeMessage = { type: 'get-tab-stats' };
      stats = (await browser.tabs.sendMessage(tabId, message)) ?? null;
    } catch {
      stats = null;
    }
  }

  async function clearChannelCache() {
    if (tabId === undefined || stats === null) {
      cacheNote = t('clearCacheNoTab');
      return;
    }
    const message: RuntimeMessage = { type: 'clear-channel-cache' };
    await browser.tabs.sendMessage(tabId, message).catch(() => {});
    cacheNote = t('clearCacheDone');
  }

  onMount(() => {
    loadSettings().then((loaded) => {
      lastSaved = JSON.stringify(loaded);
      settings = loaded;
    });
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      tabId = tab?.id;
      void refreshStats();
    });
    const poll = setInterval(refreshStats, 1000);
    return () => clearInterval(poll);
  });
</script>

<main class:paused={settings && !settings.enabled}>
  <header>
    <img src="/icon/48.png" alt="" width="28" height="28" />
    <h1>BetterYouTube</h1>
    {#if settings}
      <span class="master-label">{settings.enabled ? t('on') : t('off')}</span>
      <Switch bind:checked={settings.enabled} label={t('masterLabel')} />
    {/if}
  </header>

  {#if settings?.enabled && stats && (stats.filteredCards > 0 || stats.skippedShorts > 0)}
    <div class="stats">
      <div class="stat">
        <b>{stats.filteredCards}</b>
        <span>{t('statFiltered')}</span>
      </div>
      <div class="stat">
        <b>{stats.skippedShorts}</b>
        <span>{t('statShorts')}</span>
      </div>
    </div>
  {:else}
    <div class="status">
      <span class="dot" class:live={settings?.enabled && stats}></span>
      {#if settings && !settings.enabled}
        {t('statusPaused')}
      {:else if stats === null}
        {t('statusNotYouTube')}
      {:else}
        {t('statusNothing')}
      {/if}
    </div>
  {/if}

  {#if settings}
    <div class="tabs" role="tablist">
      {#each TABS as id (id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === id}
          onclick={() => selectTab(id)}
        >
          {t(TAB_LABELS[id])}
        </button>
      {/each}
    </div>

    <div class="body" inert={!settings.enabled} role="tabpanel">
      {#if tab === 'feed'}
        <div class="card">
          <div class="row">
            <div class="text">
              <div class="title">{t('lowViewsTitle')}</div>
              <div class="hint">{t('lowViewsHint', settings.feed.lowViews.maxViews)}</div>
            </div>
            <Switch bind:checked={settings.feed.lowViews.enabled} label={t('lowViewsTitle')} />
          </div>
          {#if settings.feed.lowViews.enabled}
            <div class="extra">
              <StepSlider
                bind:value={settings.feed.lowViews.maxViews}
                steps={AUDIENCE_STEPS}
                label={t('lowViewsTitle')}
              />
            </div>
          {/if}

          <div class="row">
            <div class="text">
              <div class="title">{t('smallChannelsTitle')}</div>
              <div class="hint">{t('smallChannelsHint', settings.feed.smallChannels.minSubscribers)}</div>
            </div>
            <Switch bind:checked={settings.feed.smallChannels.enabled} label={t('smallChannelsTitle')} />
          </div>
          {#if settings.feed.smallChannels.enabled}
            <div class="extra">
              <StepSlider
                bind:value={settings.feed.smallChannels.minSubscribers}
                steps={AUDIENCE_STEPS}
                label={t('smallChannelsTitle')}
              />
              <label class="check">
                <input type="checkbox" bind:checked={settings.feed.smallChannels.exemptSubscriptions} />
                <span>{t('exemptSubscriptions')}</span>
              </label>
            </div>
          {/if}
        </div>

        <div class="card">
          <div class="row stacked">
            <div class="title">{t('areasTitle')}</div>
            <div class="chips">
              <label class="chip"><input type="checkbox" bind:checked={settings.feed.areas.home} />{t('areaHome')}</label>
              <label class="chip"><input type="checkbox" bind:checked={settings.feed.areas.watch} />{t('areaWatch')}</label>
              <label class="chip"><input type="checkbox" bind:checked={settings.feed.areas.search} />{t('areaSearch')}</label>
            </div>
          </div>
          <div class="row">
            <div class="title">{t('actionTitle')}</div>
            <div class="segmented" role="radiogroup" aria-label={t('actionTitle')}>
              <label><input type="radio" bind:group={settings.feed.action} value="dim" />{t('actionDim')}</label>
              <label><input type="radio" bind:group={settings.feed.action} value="hide" />{t('actionHide')}</label>
            </div>
          </div>
        </div>
      {:else if tab === 'shorts'}
        <div class="card">
          <div class="row">
            <div class="text">
              <div class="title">{t('homeShortsTitle')}</div>
              <div class="hint">{t('homeShortsHint')}</div>
            </div>
            <Switch bind:checked={settings.feed.hideHomeShorts} label={t('homeShortsTitle')} />
          </div>
        </div>
        <div class="card">
          <div class="row">
            <div class="text">
              <div class="title">{t('shortsTitle')}</div>
              <div class="hint">{t('shortsHint', settings.shorts.minLikes)}</div>
            </div>
            <Switch bind:checked={settings.shorts.enabled} label={t('shortsTitle')} />
          </div>
          {#if settings.shorts.enabled}
            <div class="extra">
              <StepSlider bind:value={settings.shorts.minLikes} steps={LIKE_STEPS} label={t('shortsTitle')} />
              <label class="check">
                <input type="checkbox" bind:checked={settings.shorts.skipHiddenLikes} />
                <span>{t('skipHiddenLikes')}</span>
              </label>
            </div>
          {/if}
        </div>
      {:else}
        <div class="card">
          <div class="row">
            <div class="text">
              <div class="title">{t('badgeTitle')}</div>
              <div class="hint">{t('badgeHint')}</div>
            </div>
            <Switch bind:checked={settings.badge} label={t('badgeTitle')} />
          </div>
        </div>
        <div class="card">
          <div class="row stacked">
            <div class="hint">{cacheNote || t('clearCacheHint')}</div>
            <button type="button" class="ghost" onclick={clearChannelCache}>{t('clearCache')}</button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <footer>
    <span>v{version}</span>
    <span class="links">
      <a href={WEBSITE} target="_blank" rel="noreferrer">{t('website')}</a>
      <a href={SUPPORT} target="_blank" rel="noreferrer">{t('support')}</a>
    </span>
  </footer>
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 14px 12px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header img {
    border-radius: 8px;
  }
  h1 {
    flex: 1;
    margin: 0;
    font: 650 15px/1.2 var(--font);
    letter-spacing: -0.01em;
  }
  .master-label {
    color: var(--muted);
    font: 500 12px/1 var(--font);
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 58px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--muted);
    font: 500 12.5px/1.35 var(--font);
  }
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--track);
  }
  .dot.live {
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 58px;
    padding: 9px 12px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--border);
  }
  .stat b {
    color: var(--fg);
    font: 700 20px/1.1 var(--font);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .stat:first-child b {
    color: var(--accent-ink);
  }
  .stat span {
    color: var(--muted);
    font: 500 11.5px/1.2 var(--font);
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 11px;
    background: var(--chip);
  }
  .tabs button {
    flex: 1;
    padding: 7px 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--muted);
    font: 550 12.5px/1 var(--font);
    cursor: pointer;
  }
  .tabs button:hover {
    color: var(--fg);
  }
  .tabs button[aria-selected='true'] {
    background: var(--raised);
    color: var(--fg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .tabs button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 330px;
    transition: opacity 0.18s ease;
  }
  main.paused .body {
    opacity: 0.45;
  }

  .card {
    border-radius: 14px;
    background: var(--panel);
    border: 1px solid var(--border);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 10px 12px;
  }
  .row + .row,
  .extra + .row {
    border-top: 1px solid var(--border);
  }
  .row.stacked {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .row.stacked .ghost {
    align-self: flex-start;
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    flex: 1;
    color: var(--fg);
    font: 550 13.5px/1.3 var(--font);
  }
  .hint {
    margin-top: 2px;
    color: var(--muted);
    font: 400 12px/1.35 var(--font);
  }
  .extra {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 12px 12px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--body);
    font: 400 12.5px/1.3 var(--font);
    cursor: pointer;
  }
  .check input {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--accent);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    color: var(--body);
    font: 500 12.5px/1 var(--font);
    cursor: pointer;
    user-select: none;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }
  .chip input,
  .segmented input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .chip:has(input:checked) {
    border-color: transparent;
    background: var(--accent-soft);
    color: var(--accent-ink);
  }
  .chip:has(input:focus-visible),
  .segmented label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .segmented {
    display: inline-flex;
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
  .segmented label:has(input:checked) {
    background: var(--raised);
    color: var(--fg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  .ghost {
    flex: none;
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

  footer {
    display: flex;
    justify-content: space-between;
    padding: 0 4px;
    color: var(--muted);
    font: 400 11.5px/1 var(--font);
  }
  .links {
    display: flex;
    gap: 12px;
  }
  footer a {
    color: var(--muted);
    text-decoration: none;
  }
  footer a:hover {
    color: var(--fg);
  }
</style>
