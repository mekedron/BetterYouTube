import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: ({ browser }) => ({
    name: 'BetterYouTube – Slop Filter',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    homepage_url: 'https://mekedron.github.io/BetterYouTube/',
    // Settings only. The content scripts reach youtube.com through their
    // `matches`, and most AI APIs answer extensions' cross-origin requests,
    // so no host permission is required.
    // `offscreen` (Chrome only) runs the built-in model while the popup is
    // closed, when the viewer asks for summaries to be prepared in advance.
    permissions: browser === 'firefox' ? ['storage'] : ['storage', 'offscreen'],
    // Asked for only when the viewer connects a coding agent on their
    // computer (see components/ai/connector.ts).
    optional_permissions: ['nativeMessaging'],
    // Asked for only when the viewer picks TypeSafe Jev for the feed's AI
    // mode: its API does not answer extensions' cross-origin requests.
    optional_host_permissions: ['https://api.typesafe.ai/*'],
    action: { default_title: 'BetterYouTube – Slop Filter' },
    // Firefox runs the page-world content script (world: MAIN) from 128 on,
    // and requires the data-collection declaration for new add-ons.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'betteryoutube@mekedron.dev',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
