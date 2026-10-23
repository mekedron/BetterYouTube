import { CONFIG_EVENT, COMMAND_EVENT, HELLO_EVENT, REQUEST_EVENT, RESPONSE_EVENT, STATS_EVENT } from '../components/protocol';
import type { PageCommand, PageConfig, PageRequest, PageResponse, RuntimeMessage, TabInfo, TabStats } from '../components/protocol';
import { loadSettings, onSettingsChanged } from '../components/settings';
import type { Settings } from '../components/settings';

// The bridge between the extension and the filter in the page world: it hands
// the page script the viewer's settings, and reports what the filter did to
// the popup and the toolbar badge.
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_start',
  main(ctx) {
    let settings: Settings | null = null;
    let stats: TabStats = { filteredCards: 0, skippedShorts: 0 };

    const strings = {
      shortHiddenLikes: browser.i18n.getMessage('pageShortFewLikes'),
      shortNoLikes: browser.i18n.getMessage('pageShortNoLikes'),
    };

    function sendConfig() {
      if (!settings) return;
      const config: PageConfig = { settings, strings };
      document.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: JSON.stringify(config) }));
    }

    function sendCommand(command: PageCommand) {
      document.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: JSON.stringify(command) }));
    }

    loadSettings().then((loaded) => {
      settings = loaded;
      sendConfig();
    });
    const stopWatching = onSettingsChanged((changed) => {
      settings = changed;
      sendConfig();
    });

    const onHello = () => sendConfig();
    const onStats = (event: Event) => {
      try {
        stats = JSON.parse((event as CustomEvent<string>).detail);
      } catch {
        return;
      }
      const message: RuntimeMessage = { type: 'tab-stats', stats };
      browser.runtime.sendMessage(message).catch(() => {});
    };
    document.addEventListener(HELLO_EVENT, onHello);
    document.addEventListener(STATS_EVENT, onStats);

    // Questions to the page script, answered by RESPONSE_EVENT with the same id.
    const pending = new Map<string, (response: PageResponse) => void>();
    const onResponse = (event: Event) => {
      let response: PageResponse;
      try {
        response = JSON.parse((event as CustomEvent<string>).detail);
      } catch {
        return;
      }
      pending.get(response.requestId)?.(response);
      pending.delete(response.requestId);
    };
    document.addEventListener(RESPONSE_EVENT, onResponse);

    function askPage(type: PageRequest['type']): Promise<PageResponse> {
      const requestId = crypto.randomUUID();
      return new Promise((resolve) => {
        pending.set(requestId, resolve);
        const request: PageRequest = { requestId, type };
        document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify(request) }));
      });
    }

    // Answers through sendResponse, which every browser version supports;
    // older Chrome ignores a promise returned from the listener.
    const onMessage = (message: RuntimeMessage, _sender: unknown, sendResponse: (response: unknown) => void) => {
      if (message?.type === 'get-tab-stats') {
        const videoId = location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
        const info: TabInfo = { ...stats, videoId };
        sendResponse(info);
      } else if (message?.type === 'clear-channel-cache') {
        sendCommand({ type: 'clear-channel-cache' });
        sendResponse(true);
      } else if (message?.type === 'get-video-context') {
        void askPage('get-video-context').then(sendResponse);
        return true;
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);

    // Tells the background script which video is open, so it can get the
    // built-in model ready when the viewer asked for that.
    let lastVideo: string | null = null;
    const onNavigate = () => {
      const videoId = location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;
      if (!videoId || videoId === lastVideo) return;
      lastVideo = videoId;
      const message: RuntimeMessage = { type: 'video-opened', videoId };
      browser.runtime.sendMessage(message).catch(() => {});
    };
    onNavigate();
    document.addEventListener('yt-navigate-finish', onNavigate);

    ctx.onInvalidated(() => {
      stopWatching();
      document.removeEventListener(HELLO_EVENT, onHello);
      document.removeEventListener(STATS_EVENT, onStats);
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      browser.runtime.onMessage.removeListener(onMessage);
      document.removeEventListener('yt-navigate-finish', onNavigate);
    });
  },
});
