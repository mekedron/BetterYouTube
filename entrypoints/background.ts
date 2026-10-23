import type { RuntimeMessage } from '../components/protocol';
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

  browser.runtime.onMessage.addListener((message: RuntimeMessage, sender) => {
    const tabId = sender.tab?.id;
    if (message?.type !== 'tab-stats' || tabId === undefined) return undefined;
    counts.set(tabId, message.stats.filteredCards);
    draw(tabId);
    return undefined;
  });

  browser.tabs.onRemoved.addListener((tabId) => counts.delete(tabId));
});
