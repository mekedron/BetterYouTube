import { CONFIG_EVENT, COMMAND_EVENT, HELLO_EVENT, REQUEST_EVENT, RESPONSE_EVENT, STATS_EVENT } from '../components/protocol';
import type { PageCommand, PageConfig, PageRequest, TabStats } from '../components/protocol';
import { parseCount } from '../components/parseCount';
import { readVideoContext } from '../components/videoContext';
import { AiJudge } from '../components/feedAiPage';

// Runs in YouTube's own JavaScript world: it needs `ytcfg`, the data models
// YouTube keeps on its custom elements, and same-origin innertube requests.
// It does nothing until the bridge content script sends the viewer's config.
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    startFilter();
  },
});

// Narrow views of the YouTube globals and element properties this script reads.
interface YtConfig {
  INNERTUBE_CONTEXT?: { client: { hl?: string } & Record<string, unknown> } & Record<string, unknown>;
  LOGGED_IN?: boolean;
  SESSION_INDEX?: number;
  DELEGATED_SESSION_ID?: string;
}
type YtElement = Element & {
  data?: any;
  componentProps?: { data?: () => any };
};

function ytcfg(): YtConfig | undefined {
  return (window as unknown as { ytcfg?: { data_?: YtConfig } }).ytcfg?.data_;
}

function startFilter() {
  const FILTERED_CLASS = 'byt-filtered';
  const HIDE_MODE_CLASS = 'byt-hide-mode';
  const HOME_SHORTS_CLASS = 'byt-hide-home-shorts';
  const PENDING_CLASS = 'byt-short-pending';
  const BLOCKED_CLASS = 'byt-short-blocked';

  let config: PageConfig | null = null;

  // Card containers, one selector list per page area, so channel pages,
  // subscriptions and history are never touched.
  const AREA_SELECTORS = {
    home: ['ytd-browse[page-subtype="home"] ytd-rich-item-renderer'],
    watch: [
      'ytd-watch-next-secondary-results-renderer yt-lockup-view-model',
      'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer',
    ],
    search: [
      'ytd-search ytd-item-section-renderer ytd-video-renderer',
      'ytd-search ytd-item-section-renderer yt-lockup-view-model',
    ],
  } as const;

  function cardSelector(): string {
    const areas = config!.settings.feed.areas;
    return (Object.keys(AREA_SELECTORS) as Array<keyof typeof AREA_SELECTORS>)
      .filter((area) => areas[area])
      .flatMap((area) => AREA_SELECTORS[area])
      .join(',');
  }

  // Texts that can hold the view count, across the current lockup layout and
  // the older ytd-*-renderer layout YouTube still serves in some experiments.
  const META_SELECTORS = [
    '.ytContentMetadataViewModelMetadataText',
    '#metadata-line span',
    '.inline-metadata-item',
  ].join(',');

  // "views" in the UI languages the account may use. Live streams say
  // "watching" / "смотрят" instead and are deliberately not matched.
  const VIEWS_WORD = /view|просмотр|перегляд|katselu|visning|aufruf|vue|visualiz|wyświetl|weergave/i;

  // The card's view count, or null when it shows none (mixes, playlists,
  // live streams, ads), so those are never filtered by views.
  function viewsOf(card: Element): number | null {
    for (const el of card.querySelectorAll(META_SELECTORS)) {
      const label = el.getAttribute('aria-label') || '';
      const text = el.textContent || '';
      const source = VIEWS_WORD.test(label) ? label : VIEWS_WORD.test(text) ? text : null;
      if (source) return parseCount(source);
    }
    return null;
  }

  // ---- Channel size ----
  //
  // Cards do not show the channel's subscriber count, so the script asks
  // YouTube for each channel once and keeps the answer for a week. The request
  // is the channel's empty "Search" tab: about 35 KB, against 1.5 MB for the
  // channel's home tab, and it still carries the header with the count.

  const CHANNEL_TAB_SEARCH = 'EgZzZWFyY2jyBgQKAloA';
  const SUBS_CACHE_KEY = 'betteryoutube:channel-subs';
  const SUBS_TTL_MS = 7 * 24 * 3600 * 1000;
  const MAX_PARALLEL_REQUESTS = 4;

  // Channel id -> [subscriber count, or null when hidden; fetch time in ms].
  type SubsEntry = [number | null, number];
  let subsCache = loadSubsCache();
  const subsQueue: string[] = [];
  const subsRequested = new Set<string>();
  let subsInFlight = 0;
  // Channels the viewer is subscribed to; null until the list has loaded.
  let mySubscriptions: Set<string> | null = null;
  let subscriptionsRequested = false;

  function loadSubsCache(): Map<string, SubsEntry> {
    const now = Date.now();
    try {
      const entries = Object.entries(JSON.parse(localStorage.getItem(SUBS_CACHE_KEY) || '{}')) as Array<
        [string, SubsEntry]
      >;
      return new Map(entries.filter(([, [, at]]) => now - at < SUBS_TTL_MS));
    } catch {
      return new Map();
    }
  }

  let saveTimer = 0;
  function saveSubsCache() {
    if (saveTimer) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      try {
        localStorage.setItem(SUBS_CACHE_KEY, JSON.stringify(Object.fromEntries(subsCache)));
      } catch {}
    }, 1000);
  }

  function clearSubsCache() {
    subsCache = new Map();
    subsRequested.clear();
    subsQueue.length = 0;
    try {
      localStorage.removeItem(SUBS_CACHE_KEY);
    } catch {}
    schedule();
  }

  // The channel id (UC…) of a card, read from the card's data model: the
  // avatar or the channel name in its metadata links to the channel page.
  function channelIdOf(card: YtElement): string | null {
    const lockup = (card.matches('yt-lockup-view-model') ? card : card.querySelector('yt-lockup-view-model')) as
      | YtElement
      | null;
    let model: any = null;
    try {
      model = lockup?.componentProps?.data?.() ?? null;
    } catch {}
    model ??= card.data?.content?.lockupViewModel ?? card.data;
    return findChannelId(model?.metadata ?? model, 0);
  }

  function findChannelId(node: any, depth: number): string | null {
    if (!node || typeof node !== 'object' || depth > 20) return null;
    const id = node.browseEndpoint?.browseId;
    if (typeof id === 'string' && id.startsWith('UC')) return id;
    for (const value of Object.values(node)) {
      const found = findChannelId(value, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // Signed-in innertube requests carry this header; YouTube's own client
  // builds it the same way from the SAPISID cookie.
  async function authHeaders(): Promise<Record<string, string>> {
    const cfg = ytcfg() || {};
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const sapisid = document.cookie.match(/(?:^|; )(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)?.[1];
    if (sapisid) {
      const ts = Math.floor(Date.now() / 1000);
      const origin = location.origin;
      const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${origin}`));
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      headers.authorization = `SAPISIDHASH ${ts}_${hex}`;
      headers['x-origin'] = origin;
      headers['x-goog-authuser'] = String(cfg.SESSION_INDEX ?? 0);
      if (cfg.DELEGATED_SESSION_ID) headers['x-goog-pageid'] = cfg.DELEGATED_SESSION_ID;
    }
    return headers;
  }

  async function innertube(endpoint: string, body: object, { english = false, signedIn = false } = {}) {
    const context = structuredClone(ytcfg()!.INNERTUBE_CONTEXT!);
    // English labels keep the subscriber count parseable whatever the UI language.
    if (english) context.client.hl = 'en';
    const headers = signedIn ? await authHeaders() : { 'content-type': 'application/json' };
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ context, ...body }),
    });
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
    return res.json();
  }

  // Subscriber count from the channel header, null when the channel hides it.
  async function fetchChannelSubs(channelId: string): Promise<number | null> {
    const data = await innertube('browse', { browseId: channelId, params: CHANNEL_TAB_SEARCH }, { english: true });
    const rows: any[] =
      data.header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel
        ?.metadataRows || [];
    for (const part of rows.flatMap((row) => row.metadataParts || [])) {
      const text: string = part.text?.content || '';
      if (/subscriber/i.test(text)) return /\d/.test(text) ? parseCount(text) : 0;
    }
    return null;
  }

  function requestSubs(channelId: string) {
    if (subsRequested.has(channelId)) return;
    subsRequested.add(channelId);
    subsQueue.push(channelId);
    pumpSubsQueue();
  }

  function pumpSubsQueue() {
    while (subsInFlight < MAX_PARALLEL_REQUESTS && subsQueue.length) {
      const channelId = subsQueue.shift()!;
      subsInFlight++;
      const cache = subsCache;
      fetchChannelSubs(channelId)
        .then((subs) => {
          // A cache cleared while the request ran stays cleared.
          if (cache !== subsCache) return;
          subsCache.set(channelId, [subs, Date.now()]);
          saveSubsCache();
          schedule();
        })
        // A failed request is not cached and not retried until the next page load.
        .catch(() => {})
        .finally(() => {
          subsInFlight--;
          pumpSubsQueue();
        });
    }
  }

  // The signed-in sidebar guide lists every subscribed channel. Signed out or
  // on failure the set stays empty, so no channel is exempt.
  async function loadMySubscriptions() {
    const ids = new Set<string>();
    try {
      if (ytcfg()?.LOGGED_IN) {
        const guide = await innertube('guide', {}, { signedIn: true });
        const section = guide.items?.find((i: any) => i.guideSubscriptionsSectionRenderer);
        for (const [, id] of JSON.stringify(section || {}).matchAll(/"browseId":"(UC[\w-]{22})"/g)) {
          ids.add(id);
        }
      }
    } catch {}
    mySubscriptions = ids;
    schedule();
  }

  // ---- AI mode (see components/feedAi.ts) ----

  // The video page's description, tags, category and date: the player
  // request is about 7 KB, against half a megabyte for the watch page data.
  async function lookUpVideo(videoId: string) {
    const data = await innertube('player', { videoId }, { english: true });
    const details = data.videoDetails ?? {};
    const micro = data.microformat?.playerMicroformatRenderer ?? {};
    return {
      description: String(details.shortDescription ?? '').slice(0, 500),
      tags: ((details.keywords ?? []) as string[]).slice(0, 10),
      category: String(micro.category ?? ''),
      published: String(micro.publishDate ?? '').slice(0, 10),
    };
  }

  const aiJudge = new AiJudge({
    subscribersOf: (card) => {
      const channelId = channelIdOf(card);
      return channelId ? (subsCache.get(channelId)?.[0] ?? null) : null;
    },
    lookUp: lookUpVideo,
    changed: schedule,
  });

  // Whether the card's channel is below the subscriber minimum; null while
  // its count loads. A card with no channel, or a hidden count, passes.
  function isSmallChannel(card: YtElement): boolean | null {
    const rule = config!.settings.feed.smallChannels;
    const channelId = channelIdOf(card);
    if (!channelId) return false;
    const cached = subsCache.get(channelId);
    if (!cached) {
      requestSubs(channelId);
      return null;
    }
    return cached[0] !== null && cached[0] < rule.minSubscribers;
  }

  // YouTube reuses card elements for different videos while scrolling and
  // navigating, so every pass recomputes the class instead of caching a verdict.
  // Returns how many cards are filtered on the page on screen.
  function updateCards(): number {
    const feed = config!.settings.feed;
    const selector = cardSelector();
    const matched = new Set<Element>(selector ? document.querySelectorAll(selector) : []);
    // Cards of an area that was just switched off keep no stale class.
    for (const card of document.querySelectorAll(`.${FILTERED_CLASS}`)) {
      if (!matched.has(card)) card.classList.remove(FILTERED_CLASS);
    }
    if (!matched.size) return 0;

    // Innertube requests need the client context from the page's config.
    const canAsk = Boolean(ytcfg()?.INNERTUBE_CONTEXT);
    // 'both' applies the free rules first, and asks the AI only about the
    // videos they let through.
    const rules = feed.mode !== 'ai';
    const ai = feed.mode !== 'rules';
    if (ai) aiJudge.configure(feed.ai);
    const exempting =
      feed.exemptSubscriptions && canAsk && (ai || feed.lowViews.enabled || feed.smallChannels.enabled);
    if (exempting && !subscriptionsRequested) {
      subscriptionsRequested = true;
      void loadMySubscriptions();
    }
    let filtered = 0;
    for (const card of matched) {
      let filter = false;
      // Until the subscription list has loaded, no card is filtered: a
      // subscribed channel's video must not flash dimmed.
      if (exempting && (!mySubscriptions || mySubscriptions.has(channelIdOf(card as YtElement) ?? ''))) {
        card.classList.remove(FILTERED_CLASS);
        continue;
      }
      // A card the rules have not decided on yet is not sent to the AI.
      let undecided = false;
      if (rules && feed.lowViews.enabled) {
        const views = viewsOf(card);
        filter = views !== null && views <= feed.lowViews.maxViews;
      }
      if (rules && !filter && feed.smallChannels.enabled && canAsk) {
        const small = isSmallChannel(card as YtElement);
        filter = small === true;
        undecided = small === null;
      }
      if (ai && !filter && !undecided) filter = aiJudge.filter(card as YtElement) ?? false;
      card.classList.toggle(FILTERED_CLASS, filter);
      // YouTube keeps earlier pages in the DOM, hidden; the count covers
      // only the page on screen.
      if (filter && !card.closest('ytd-page-manager > [hidden]')) filtered++;
    }
    return filtered;
  }

  // ---- Shorts player: cover Shorts with few likes ----
  //
  // The script never scrolls the feed: the viewer's own scrolling would race
  // with it and jump over a good Short. A low-like Short is covered, muted and
  // paused instead, and the viewer scrolls past it as usual. A new Short is
  // also covered and muted while its like count loads, so a covered one never
  // flashes or plays sound.

  // Video id -> like count, or null when the like button shows no number.
  const shortLikesById = new Map<string, number | null>();
  const skippedShortIds = new Set<string>();
  // The <video> element the script silences, and what to restore on release.
  let heldVideo: HTMLVideoElement | null = null;
  let heldVideoWasMuted = false;
  let heldVideoPausedByUs = false;
  let note: HTMLDivElement | null = null;

  // Like count of the Short `videoId`, read from the player's data model.
  // undefined: not loaded yet (the single reel renderer still holds the
  // previous Short's data for a few hundred ms after the URL changes).
  // null: the button shows no number (zero likes or a hidden count).
  function shortLikes(videoId: string): number | null | undefined {
    const data = (document.querySelector('ytd-shorts ytd-reel-video-renderer') as YtElement | null)?.data;
    const like = data?.reelPlayerOverlayRenderer?.playerOverlay?.reelPlayerOverlayViewModel?.actionBar?.reelActionBarViewModel?.buttonViewModels?.find(
      (b: any) => b.likeButtonViewModel,
    )?.likeButtonViewModel;
    const button = like?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel;
    if (button?.onTap?.innertubeCommand?.likeEndpoint?.target?.videoId !== videoId) return undefined;
    const title: string = button.title || '';
    return /\d/.test(title) ? parseCount(title) : null;
  }

  function showNote(text: string) {
    if (!note) {
      note = document.createElement('div');
      note.id = 'byt-shorts-note';
    }
    if (!note.isConnected) document.body.appendChild(note);
    note.textContent = text;
  }

  // state: null (play normally), 'pending' (count loading) or 'blocked'.
  function setShortState(state: null | 'pending' | 'blocked') {
    const root = document.documentElement;
    root.classList.toggle(PENDING_CLASS, state === 'pending');
    root.classList.toggle(BLOCKED_CLASS, state === 'blocked');

    const video = state ? document.querySelector<HTMLVideoElement>('ytd-shorts video') : null;
    if (heldVideo && heldVideo !== video) {
      heldVideo.muted = heldVideoWasMuted;
      // Resume only when a kept Short follows; leaving Shorts stays paused.
      if (heldVideoPausedByUs && location.pathname.startsWith('/shorts/')) {
        heldVideo.play().catch(() => {});
      }
      heldVideo = null;
    }
    if (!video) return;
    if (!heldVideo) {
      heldVideo = video;
      heldVideoWasMuted = video.muted;
      heldVideoPausedByUs = false;
    }
    // The player restores its own mute state and restarts playback when it
    // loads or loops a Short, so both are reapplied on every pass.
    video.muted = true;
    if (state === 'blocked' && !video.paused) {
      video.pause();
      heldVideoPausedByUs = true;
    }
  }

  function checkShort() {
    if (!config) return;
    const rule = config.settings.shorts;
    const id = location.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
    if (!id || !config.settings.enabled || !rule.enabled) {
      setShortState(null);
      return;
    }
    if (!shortLikesById.has(id)) {
      const likes = shortLikes(id);
      if (likes === undefined) {
        setShortState('pending');
        return;
      }
      shortLikesById.set(id, likes);
    }
    const likes = shortLikesById.get(id)!;
    const blocked = likes === null ? rule.skipHiddenLikes : likes < rule.minLikes;
    if (blocked) {
      showNote(
        likes === null
          ? config.strings.shortNoLikes
          : config.strings.shortHiddenLikes.replace('{n}', likes.toLocaleString(navigator.language)),
      );
      if (!skippedShortIds.has(id)) {
        skippedShortIds.add(id);
        scheduleStats();
      }
    }
    setShortState(blocked ? 'blocked' : null);
  }

  // ---- Styles ----

  const CSS = `
    .${FILTERED_CLASS} {
      opacity: 0.2 !important;
      filter: grayscale(1) !important;
      transition: opacity 0.15s ease;
    }
    .${FILTERED_CLASS}:hover { opacity: 0.5 !important; }
    html.${HIDE_MODE_CLASS} .${FILTERED_CLASS} { display: none !important; }

    /* Shorts on the home page: the shelf sections and any Shorts cell in the grid. */
    html.${HOME_SHORTS_CLASS} ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
    html.${HOME_SHORTS_CLASS} ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2),
    html.${HOME_SHORTS_CLASS} ytd-browse[page-subtype="home"] ytd-rich-section-renderer:has(ytd-reel-shelf-renderer),
    html.${HOME_SHORTS_CLASS} ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2),
    html.${HOME_SHORTS_CLASS} ytd-browse[page-subtype="home"] ytd-rich-item-renderer[is-slim-media],
    html.${HOME_SHORTS_CLASS} ytd-browse[page-subtype="home"] ytd-reel-shelf-renderer {
      display: none !important;
    }

    /* A Short whose like count is loading, or one with too few likes: the
       feed slot holding the player (the player and the slot's own thumbnail)
       and the ambient glow behind it. opacity, unlike visibility, cannot be
       undone by the player's own descendants. */
    html.${PENDING_CLASS} ytd-shorts .reel-video-in-sequence-new:has(ytd-reel-video-renderer),
    html.${BLOCKED_CLASS} ytd-shorts .reel-video-in-sequence-new:has(ytd-reel-video-renderer),
    html.${PENDING_CLASS} ytd-shorts #cinematic-shorts-scrim,
    html.${BLOCKED_CLASS} ytd-shorts #cinematic-shorts-scrim {
      opacity: 0 !important;
    }
    /* Nothing invisible can be liked or subscribed to by accident. The
       renderer itself still takes pointer events, so the wheel reaches it and
       bubbles through the feed exactly as over a visible Short. */
    html.${PENDING_CLASS} ytd-shorts ytd-reel-video-renderer *,
    html.${BLOCKED_CLASS} ytd-shorts ytd-reel-video-renderer * {
      pointer-events: none !important;
    }

    #byt-shorts-note {
      display: none;
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 10000;
      padding: 10px 16px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.08);
      color: #aaa;
      font: 500 15px/1.4 Roboto, Arial, sans-serif;
      pointer-events: none;
    }
    html.${BLOCKED_CLASS} #byt-shorts-note { display: block; }
  `;

  const style = document.createElement('style');
  style.id = 'byt-style';
  style.textContent = CSS;

  // Re-attached on every pass in case the page rebuilds <head>.
  function ensureStyle() {
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
  }

  // ---- Stats for the popup and the toolbar badge ----

  let filteredCards = 0;
  let lastSentStats = '';
  let statsTimer = 0;
  function scheduleStats() {
    if (statsTimer) return;
    statsTimer = window.setTimeout(() => {
      statsTimer = 0;
      const stats: TabStats = {
        filteredCards,
        skippedShorts: skippedShortIds.size,
        aiError: config && config.settings.feed.mode !== 'rules' ? aiJudge.error : null,
      };
      const json = JSON.stringify(stats);
      if (json === lastSentStats) return;
      lastSentStats = json;
      document.dispatchEvent(new CustomEvent(STATS_EVENT, { detail: json }));
    }, 500);
  }

  // ---- Wiring ----

  function update() {
    if (!config) return;
    const root = document.documentElement;
    const on = config.settings.enabled;
    ensureStyle();
    root.classList.toggle(HIDE_MODE_CLASS, on && config.settings.feed.action === 'hide');
    root.classList.toggle(HOME_SHORTS_CLASS, on && config.settings.feed.hideHomeShorts);
    if (on) {
      filteredCards = updateCards();
    } else {
      for (const card of document.querySelectorAll(`.${FILTERED_CLASS}`)) card.classList.remove(FILTERED_CLASS);
      filteredCards = 0;
    }
    checkShort();
    scheduleStats();
  }

  // The player mutates the DOM many times a second; one pass per 150 ms is
  // enough to catch new cards before they are noticed.
  let timer = 0;
  function schedule() {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      update();
    }, 150);
  }

  document.addEventListener(CONFIG_EVENT, (event) => {
    try {
      config = JSON.parse((event as CustomEvent<string>).detail) as PageConfig;
    } catch {
      return;
    }
    update();
  });

  document.addEventListener(COMMAND_EVENT, (event) => {
    let command: PageCommand;
    try {
      command = JSON.parse((event as CustomEvent<string>).detail);
    } catch {
      return;
    }
    if (command.type === 'clear-channel-cache') clearSubsCache();
  });

  document.addEventListener(REQUEST_EVENT, (event) => {
    let request: PageRequest;
    try {
      request = JSON.parse((event as CustomEvent<string>).detail);
    } catch {
      return;
    }
    if (request.type !== 'get-video-context') return;
    void readVideoContext(request.requestId).then((response) => {
      document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify(response) }));
    });
  });

  function start() {
    // Covers infinite scroll, lazy-loaded recommendations and recycled cards.
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label', 'page-subtype', 'href'],
    });
    // Shorts data can arrive without a DOM change the observer would see; a
    // short interval keeps the covered gap before a kept Short brief.
    setInterval(checkShort, 100);
    schedule();
  }

  // SPA navigation between pages without a reload.
  for (const ev of ['yt-navigate-finish', 'yt-page-data-updated', 'popstate']) {
    window.addEventListener(ev, schedule);
  }

  // At document-start the <html> element may not exist yet.
  if (document.documentElement) {
    start();
  } else {
    new MutationObserver((_, obs) => {
      if (!document.documentElement) return;
      obs.disconnect();
      start();
    }).observe(document, { childList: true });
  }

  // The bridge may have started first and missed this script; asking makes
  // the order of the two content scripts irrelevant.
  document.dispatchEvent(new CustomEvent(HELLO_EVENT));
}
