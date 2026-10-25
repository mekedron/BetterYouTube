import { fingerprint, loadConversation, saveConversation } from '../components/ai/cache';
import { chromeBuiltin } from '../components/ai/chromeBuiltin';
import { PREPARE_DELAY_MS } from '../components/ai/prepare';
import type { PrepareMessage } from '../components/ai/prepare';
import { providerConfig, resolveLanguage } from '../components/ai/providers';
import { DEFAULT_PROMPT } from '../components/ai/summarize';
import { loadApiKeys } from '../components/ai/secrets';
import { DEFAULT_CRITERIA, judgeVideos, KEY_SLOT } from '../components/feedAi';
import type { VideoFacts, Verdicts } from '../components/feedAi';
import type { JudgeResult, PageResponse, RuntimeMessage, TabInfo } from '../components/protocol';
import { loadSettings, onSettingsChanged } from '../components/settings';

// Shows how many videos the filter dims or hides in each YouTube tab on the
// toolbar icon. The badge belongs to the tab, so the browser clears it when
// the tab navigates away or closes.
export default defineBackground(() => {
  const counts = new Map<number, number>();
  let showBadge = true;

  loadSettings().then((s) => {
    showBadge = s.badge && s.enabled;
    redrawAll();
  });
  onSettingsChanged((s) => {
    showBadge = s.badge && s.enabled;
    redrawAll();
  });

  browser.action.setBadgeBackgroundColor({ color: '#4b5563' }).catch(() => {});

  function draw(tabId: number) {
    const count = counts.get(tabId) ?? 0;
    const text = showBadge && count > 0 ? (count > 999 ? '999+' : String(count)) : '';
    browser.action.setBadgeText({ tabId, text }).catch(() => {});
  }

  function redrawAll() {
    for (const tabId of counts.keys()) draw(tabId);
  }

  browser.runtime.onMessage.addListener((message: RuntimeMessage | PrepareMessage, sender, sendResponse) => {
    // Answers through sendResponse, which every browser version supports.
    if (message?.type === 'judge-videos') {
      void judge(message.videos).then(sendResponse);
      return true;
    }
    const tabId = sender.tab?.id;
    if (message?.type === 'tab-stats' && tabId !== undefined) {
      counts.set(tabId, message.stats.filteredCards);
      draw(tabId);
    } else if (message?.type === 'video-opened' && tabId !== undefined) {
      schedulePrepare(tabId, message.videoId);
    } else if (message?.type === 'summary-started') {
      startedByPopup.add(message.videoId);
    } else if (message?.type === 'prepared-done') {
      void saveConversation(message.videoId, message.print, message.history);
    }
    return undefined;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    counts.delete(tabId);
    clearTimeout(prepareTimers.get(tabId));
    prepareTimers.delete(tabId);
  });

  // ---- The feed's AI mode (see components/feedAi.ts) ----
  //
  // Verdicts are kept for the browser session, per service, criteria and
  // depth, so a video seen again on another page is not paid for twice.

  const VERDICTS_KEY = 'feed-verdicts';
  const MAX_VERDICTS = 5000;
  // One copy in memory, so requests from several tabs at once add to the
  // same record instead of overwriting each other's.
  let memory: { print: string; verdicts: Verdicts } | null = null;

  async function remembered(print: string) {
    if (memory?.print === print) return memory;
    const stored = (await browser.storage.session.get(VERDICTS_KEY))[VERDICTS_KEY] as typeof memory | undefined;
    if (memory?.print === print) return memory;
    memory = stored?.print === print ? stored : { print, verdicts: {} };
    return memory;
  }

  async function judge(videos: VideoFacts[]): Promise<JudgeResult> {
    try {
      const { feed } = await loadSettings();
      const key = (await loadApiKeys())[KEY_SLOT[feed.ai.service]] ?? '';
      const criteria = feed.ai.criteria.trim() || DEFAULT_CRITERIA;
      const record = await remembered(JSON.stringify([feed.ai.service, feed.ai.depth, criteria]));
      const missing = videos.filter((v) => !(v.id in record.verdicts));
      if (missing.length) {
        Object.assign(record.verdicts, await judgeVideos(feed.ai.service, key, criteria, missing));
        const ids = Object.keys(record.verdicts);
        for (const id of ids.slice(0, Math.max(0, ids.length - MAX_VERDICTS))) delete record.verdicts[id];
        await browser.storage.session.set({ [VERDICTS_KEY]: record });
      }
      const verdicts: Verdicts = {};
      for (const v of videos) if (v.id in record.verdicts) verdicts[v.id] = record.verdicts[v.id];
      return { ok: true, verdicts };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ---- Getting the built-in model ready (see components/ai/prepare.ts) ----

  const prepareTimers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Videos the popup is already summarizing itself. */
  const startedByPopup = new Set<string>();

  function schedulePrepare(tabId: number, videoId: string) {
    clearTimeout(prepareTimers.get(tabId));
    // Firefox has no offscreen documents, and no built-in model either.
    if (!browser.offscreen) return;
    prepareTimers.set(
      tabId,
      setTimeout(() => {
        prepareTimers.delete(tabId);
        void prepare(tabId, videoId).catch(() => {});
      }, PREPARE_DELAY_MS),
    );
  }

  async function prepare(tabId: number, videoId: string) {
    const settings = await loadSettings();
    const { ai } = settings;
    if (ai.consent !== 'granted' || ai.provider !== chromeBuiltin.id || ai.prepare === 'off') return;
    // The viewer may have moved on while the delay ran.
    const info = (await browser.tabs.sendMessage(tabId, { type: 'get-tab-stats' } satisfies RuntimeMessage)) as TabInfo;
    if (info?.videoId !== videoId) return;

    const language = resolveLanguage(chromeBuiltin, ai.language, browser.i18n.getUILanguage());
    if (ai.prepare === 'model') {
      await openOffscreen();
      await send({ type: 'offscreen-warm', language });
      return;
    }

    const instruction = ai.prompt.trim() || DEFAULT_PROMPT;
    const print = fingerprint(chromeBuiltin.id, providerConfig(settings, {}, chromeBuiltin.id), language, instruction);
    if (startedByPopup.has(videoId) || (await loadConversation(videoId, print))) return;
    const context = (await browser.tabs.sendMessage(tabId, { type: 'get-video-context' } satisfies RuntimeMessage)) as
      | PageResponse
      | undefined;
    if (!context?.ok) return;
    await openOffscreen();
    await send({ type: 'offscreen-summarize', videoId, print, language, instruction, video: context.data });
  }

  function send(message: PrepareMessage) {
    return browser.runtime.sendMessage(message).catch(() => {});
  }

  let opening: Promise<void> | null = null;
  function openOffscreen(): Promise<void> {
    opening ??= (async () => {
      if (await browser.offscreen.hasDocument()) return;
      await browser.offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: [browser.offscreen.Reason.WORKERS],
        justification: "Runs Chrome's built-in AI model to get video summaries ready before the popup opens.",
      });
    })().finally(() => (opening = null));
    return opening;
  }
});
