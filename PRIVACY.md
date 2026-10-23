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

The extension talks only to youtube.com, from inside the YouTube page you
already have open:

- a request for a channel's public page header, to read its subscriber count;
- when you are signed in, a request for YouTube's sidebar, to learn which
  channels you subscribe to, so they are never dimmed;
- when you ask for a summary, a request for the video's transcript, the same
  one YouTube's "Show transcript" button makes.

These are the same requests YouTube's own page makes. Their answers stay in
your browser. The extension has no server, no analytics and no ads.

## AI summaries

Summaries are written by Chrome's built-in AI model (Gemini Nano), which runs
on your device. The transcript, the video's title and your questions go to that
model inside the browser and nowhere else. Chrome downloads the model once,
after you turn summaries on. You can turn summaries off in the popup's General
tab.

## Permissions

- `storage`: to save your settings.
- Access to `https://www.youtube.com/*` through its content scripts. It does
  not run on any other site.

## Contact

Questions: open an issue at <https://github.com/mekedron/BetterYouTube/issues>.
