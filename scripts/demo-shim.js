// Stands in for the extension APIs when the real popup runs inside the
// landing page's demo iframe. Settings stay in memory and every change is
// posted to the landing page, which filters its sample feed with them.
(() => {
  // ?lang= picks one of the extension's locales; anything else falls back
  // to English, as the extension itself does.
  const requested = new URLSearchParams(location.search).get('lang');
  const lang = requested && window.__BYT_MESSAGES__[requested] ? requested : 'en';
  const messages = window.__BYT_MESSAGES__[lang];
  let stored;
  let stats = { filteredCards: 0, skippedShorts: 0 };

  // The landing page reports how many sample videos the settings filter.
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'byt-demo-stats') stats = event.data.stats;
  });

  window.chrome = {
    runtime: {
      id: 'demo',
      getManifest: () => ({ version: window.__BYT_VERSION__ }),
      onMessage: { addListener() {}, removeListener() {} },
    },
    i18n: {
      getMessage: (key) => messages[key]?.message ?? '',
      getUILanguage: () => lang,
    },
    storage: {
      sync: {
        get: async (key) => ({ [key]: stored }),
        set: async (items) => {
          stored = Object.values(items)[0];
          parent.postMessage({ type: 'byt-demo-settings', settings: stored }, '*');
        },
      },
      local: { get: async () => ({}), set: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {}, removeListener() {} },
    },
    permissions: { contains: async () => false, request: async () => false },
    tabs: {
      query: async () => [{ id: 1 }],
      // The demo has no video tab, so the popup shows its settings tabs only.
      sendMessage: async (_tabId, message) => (message?.type === 'get-tab-stats' ? { ...stats, videoId: null } : true),
    },
  };
})();
