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
transcript, title, channel name and length, your prompt, and your
follow-up questions. Nothing else is sent, and nothing goes to the developer.

- **Chrome's built-in AI** (the default) runs on your device. Chrome downloads
  its model once, after you turn summaries on. If you choose so in the
  settings, it also loads the model or writes the summary when a video stays
  open for a few seconds, before you open the popup. That too stays on your
  device.
- **A coding agent on your computer** (Claude Code, Codex or Gemini CLI) is
  reached through the BetterYouTube connector, a small program you install
  yourself. The agent then talks to its own service under your account, as it
  does when you use it in a terminal. The connector starts the agent in an
  empty temporary folder. Claude Code and Codex get no tools. Gemini CLI has
  no switch for that, so it runs in its read-only mode: it cannot change
  files or run commands, but it could read files if a transcript told it to.
  Its answer is only shown to you.
- **A cloud API with your key** (OpenAI, Anthropic, Google Gemini, OpenRouter,
  or any OpenAI-compatible server you name) receives the request directly from
  your browser. Your key is stored only in this browser's local extension
  storage and is sent only to that provider.

You can turn summaries off in the popup's General tab.

## AI mode for the feed

It is off unless you choose "AI" on the Feed tab. Then the extension sends the
videos in your recommendations to the decision service you pick, OpenAI
Decisions or TypeSafe Jev, with your own API key: each video's title, what its
card shows (channel, views, age, length), the channel's subscriber count when
the extension already knows it, and your description of what is worth your
time. With "Card and video page" it also sends each video's description, tags,
category and publish date, which it reads from YouTube first. The service's
answers are kept in the browser's session storage until you close the browser.
Your key is stored only in this browser's local extension storage and is sent
only to that service.

## Permissions

- `storage`: to save your settings and API keys.
- `offscreen` (Chrome): to run the built-in AI while the popup is closed,
  only when you ask for summaries to be prepared in advance.
- `nativeMessaging` (optional, asked for only when you connect a coding agent):
  to talk to the BetterYouTube connector.
- Access to `https://api.typesafe.ai/*` (optional, asked for only when you pick
  TypeSafe Jev for the AI mode): its API accepts an extension's requests only
  with this permission.
- Access to `https://www.youtube.com/*` through its content scripts. It does
  not run on any other site.

## Contact

Questions: open an issue at <https://github.com/mekedron/BetterYouTube/issues>.
