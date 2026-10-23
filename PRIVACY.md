# Privacy

BetterYouTube collects no personal data and sends nothing to its developer.

## What it stores

- **Your settings.** They are kept in your browser's extension storage
  (`storage.sync`). If you sign in to your browser, the browser syncs them
  between your own devices. Nobody else can read them.
- **Video summaries and your follow-up questions.** They are kept in the
  browser's session storage until you close the browser, so reopening the
  popup shows them again. "Summarize again" deletes the one for that video.
- **Channel subscriber counts.** To spot small channels, the extension asks
  YouTube for a channel's public subscriber count and keeps it for a week in
  youtube.com's local storage on your computer. "Recheck channel sizes" in the
  popup deletes these counts.

## What it sends, and where

Apart from the AI you choose for summaries (see below), the extension talks
only to youtube.com, from inside the YouTube page you already have open:

- a request for a channel's public page header, to read its subscriber count;
- when you are signed in, a request for YouTube's sidebar, to learn which
  channels you subscribe to, so they are never dimmed;
- when you ask for a summary, a request for the video's transcript, the same
  one YouTube's "Show transcript" button makes.

These are the same requests YouTube's own page makes. Their answers stay in
your browser. The extension has no server, no analytics and no ads.

## AI summaries

You choose who writes a summary. Whichever you choose gets the video's
transcript, title, channel name and length, your instruction, and your
follow-up questions. Nothing else is sent, and nothing goes to the developer.

- **Chrome's built-in AI** (the default) runs on your device. Chrome downloads
  its model once, after you turn summaries on.
- **A coding agent on your computer** (Claude Code, Codex or Gemini CLI) is
  reached through the BetterYouTube connector, a small program you install
  yourself. The agent then talks to its own service under your account, as it
  does when you use it in a terminal. The connector starts the agent with its
  tools turned off, in an empty temporary folder.
- **A cloud API with your key** (OpenAI, Anthropic, Google Gemini, OpenRouter,
  or any OpenAI-compatible server you name) receives the request directly from
  your browser. Your key is stored only in this browser's local extension
  storage and is sent only to that provider.

You can turn summaries off in the popup's General tab.

## Permissions

- `storage`: to save your settings and API keys.
- `nativeMessaging` (optional, asked for only when you connect a coding agent):
  to talk to the BetterYouTube connector.
- Access to `https://www.youtube.com/*` through its content scripts. It does
  not run on any other site.

## Contact

Questions: open an issue at <https://github.com/mekedron/BetterYouTube/issues>.
