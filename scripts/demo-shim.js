// Stands in for the extension APIs when the real popup runs inside the
// landing page's demo iframe. Settings stay in memory and every change is
// posted to the landing page, which filters its sample feed with them.
// Clicking a sample video makes it the "open tab", and a stand-in for
// Chrome's built-in model writes the summary the landing page supplies.
(() => {
  // ?lang= picks one of the extension's locales; anything else falls back
  // to English, as the extension itself does.
  const requested = new URLSearchParams(location.search).get('lang');
  const lang = requested && window.__BYT_MESSAGES__[requested] ? requested : 'en';
  const messages = window.__BYT_MESSAGES__[lang];
  // Summaries start switched on, so a click on a video shows one at once.
  let stored = { ai: { consent: 'granted' } };
  let stats = { filteredCards: 0, skippedShorts: 0 };
  // The sample video the visitor opened: { video, summary, followUp }.
  let open = null;
  const session = new Map();

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'byt-demo-stats') stats = event.data.stats;
    if (event.data?.type === 'byt-demo-video') open = event.data;
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Streams a fixed text word by word, like the model would.
  function stream(text) {
    return new ReadableStream({
      async start(controller) {
        await sleep(700);
        for (const word of text.match(/\S+\s*/g) ?? []) {
          await sleep(28);
          controller.enqueue(word);
        }
        controller.close();
      },
    });
  }

  const languageModel = {
    availability: async () => 'available',
    create: async () => ({
      contextWindow: 9216,
      contextUsage: 0,
      measureContextUsage: async () => 200,
      // The first prompt carries the transcript; later ones are follow-ups.
      promptStreaming: (input) => stream(input.includes('\nTranscript:\n') ? open?.summary ?? '' : open?.followUp ?? ''),
      destroy() {},
    }),
  };
  Object.defineProperty(window, 'LanguageModel', { value: languageModel, configurable: true, writable: true });

  window.chrome = {
    runtime: {
      id: 'demo',
      getManifest: () => ({ version: window.__BYT_VERSION__ }),
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage: async () => undefined,
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
      session: {
        get: async (key) => (session.has(key) ? { [key]: session.get(key) } : {}),
        set: async (items) => {
          for (const [key, value] of Object.entries(items)) session.set(key, value);
        },
        remove: async (key) => {
          session.delete(key);
        },
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    permissions: { contains: async () => false, request: async () => false },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (_tabId, message) => {
        if (message?.type === 'get-tab-stats') return { ...stats, videoId: open?.video.videoId ?? null };
        if (message?.type === 'get-video-context') return { ok: true, data: { ...open.video, transcript: '' } };
        return true;
      },
    },
  };
})();
