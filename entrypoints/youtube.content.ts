import { CONFIG_EVENT, COMMAND_EVENT, HELLO_EVENT, STATS_EVENT } from '../components/protocol';
import type { PageCommand, PageConfig, RuntimeMessage, TabStats } from '../components/protocol';
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

    const onMessage = (message: RuntimeMessage) => {
      if (message?.type === 'get-tab-stats') return Promise.resolve(stats);
      if (message?.type === 'clear-channel-cache') {
        sendCommand({ type: 'clear-channel-cache' });
        return Promise.resolve(true);
      }
      return undefined;
    };
    browser.runtime.onMessage.addListener(onMessage);

    ctx.onInvalidated(() => {
      stopWatching();
      document.removeEventListener(HELLO_EVENT, onHello);
      document.removeEventListener(STATS_EVENT, onStats);
      browser.runtime.onMessage.removeListener(onMessage);
    });
  },
});
