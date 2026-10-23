<p align="center">
  <img src="public/icon/128.png" alt="BetterYouTube icon" width="128" height="128" />
</p>

# BetterYouTube – Slop Filter

It's not your attention span. It's the padding.

A browser extension for Chrome and Firefox that dims the videos built to waste
your time in YouTube recommendations: low-view filler, tiny content farms, AI
slop and Shorts nobody liked. The videos worth your time stand out again.

Website and live demo: <https://mekedron.github.io/BetterYouTube/>

## What it does

- **Few views.** Dims videos at or below a view count you choose (50K by
  default) on Home, in the "Up next" column and, if you turn it on, in search.
- **Small channels.** Dims videos from channels under a subscriber count you
  choose (50K by default). Cards don't show that number, so the extension asks
  YouTube once per channel and keeps the answer for a week. Channels you
  subscribe to are never dimmed.
- **Shorts.** Hides Shorts shelves on Home. In the Shorts player it covers,
  mutes and pauses a Short with fewer likes than you set (1K by default), so you
  scroll past it.
- **Video summaries.** On a video page the popup gives a short summary of the
  video from its transcript, and answers follow-up questions about it. The
  viewer picks who writes it:
  - Chrome's built-in AI (Gemini Nano), the default: on the device, no key, a
    one-time model download; writes in English, Spanish, Japanese, German or
    French. Optionally it loads the model, or writes the summary, as soon as a
    video stays open for 3 seconds.
  - A coding agent already on the computer (Claude Code, Codex, Gemini CLI)
    through the connector in `docs/connector/`, installed with one command.
  - A cloud API with the viewer's own key: OpenAI, Anthropic, Google Gemini,
    OpenRouter, or any OpenAI-compatible server such as Ollama.
- **Dim or hide**, per page area, with one switch to pause everything.
- A count of filtered videos on the toolbar icon.
- English and Russian; light and dark follow the system.

Videos are dimmed rather than hidden by default, because views are a rough
signal: a great new video starts at zero too. Hovering a dimmed video brings it
back.

## How it works

YouTube keeps the data the filter needs (view counts, channel ids, Shorts like
counts, the signed-in session) in its own page JavaScript, which an isolated
content script cannot see. So the extension runs two content scripts on
`www.youtube.com`:

- `entrypoints/youtube-page.content.ts` runs in the page's world and does the
  filtering. It waits for a config before touching anything.
- `entrypoints/youtube.content.ts` is the bridge. It reads the settings from
  extension storage, passes them to the page script, and reports per-tab counts
  to the popup and the background worker (for the badge).

The two talk through DOM events with JSON payloads; see
`components/protocol.ts`. Settings live in `components/settings.ts`, one
section per feature.

Summaries:

- `components/videoContext.ts` (page world) reads the title, channel, length
  and transcript. The transcript comes from the same `get_panel` request as
  YouTube's "Show transcript" button.
- `components/ai/summarize.ts` builds the prompts and runs the summary and
  follow-ups. A transcript longer than the model's context window is read in
  parts, and the summary is written from the parts' notes.
- `components/ai/types.ts` is the provider contract; `providers.ts` lists the
  providers. `chromeBuiltin.ts` is the on-device model, `apiProviders.ts` the
  cloud APIs (called straight from the extension; they all allow it), and
  `connector.ts` the coding agents through the native-messaging connector
  (`docs/connector/`, protocol in `connectorProtocol.ts`). API keys stay in
  `storage.local` (`secrets.ts`) and never reach the YouTube page.
- The popup's Summary tab (`entrypoints/popup/Summary.svelte`) runs it and
  keeps finished conversations in `storage.session` (`components/ai/cache.ts`).

## Development

Requirements: Node 22 (`.nvmrc`) and pnpm 10.

```bash
pnpm install
pnpm dev              # Chrome with the extension loaded and hot reload
pnpm dev:firefox      # Firefox
pnpm compile          # svelte-check + tsc
pnpm build            # .output/chrome-mv3/
pnpm build:firefox    # .output/firefox-mv3/
pnpm zip              # store zip for Chrome
pnpm zip:firefox      # store zip and sources zip for Firefox
pnpm demo             # build, then copy the popup into docs/demo/ for the site
```

### Translations

- Extension: add `public/_locales/<code>/messages.json` with the same keys as
  `public/_locales/en/messages.json`. The browser picks the language itself, and
  the site's popup demo picks up the new locale automatically.
- Site: add an entry to `docs/i18n.js`. The language menu is built from it.

### Load the build by hand

- Chrome, Edge, Brave: open `chrome://extensions`, turn on Developer mode,
  click **Load unpacked** and pick `.output/chrome-mv3/`.
- Firefox: open `about:debugging#/runtime/this-firefox`, click **Load Temporary
  Add-on** and pick `.output/firefox-mv3/manifest.json`.

## Releases

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`. It builds the
Chrome and Firefox zips, attaches them to a GitHub Release, submits the Chrome
zip to the Chrome Web Store, and submits to Firefox Add-ons once its secrets are
set. The site in `docs/` deploys to GitHub Pages from `main` with
`.github/workflows/pages.yml`.

## Privacy

No servers, no analytics, no accounts. See [PRIVACY.md](PRIVACY.md).

## Support

Built by one indie developer. If it gives you back some evenings,
[buy me a coffee](https://buymeacoffee.com/mekedron).

## License

[MIT](LICENSE)
