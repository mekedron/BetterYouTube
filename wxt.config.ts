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
    // `matches`, so no host permission is requested.
    permissions: ['storage'],
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
