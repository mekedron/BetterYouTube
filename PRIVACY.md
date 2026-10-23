# Privacy

BetterYouTube collects no personal data and sends nothing to its developer.

## What it stores

- **Your settings.** They are kept in your browser's extension storage
  (`storage.sync`). If you sign in to your browser, the browser syncs them
  between your own devices. Nobody else can read them.
- **Channel subscriber counts.** To spot small channels, the extension asks
  YouTube for a channel's public subscriber count and keeps it for a week in
  youtube.com's local storage on your computer. "Recheck channel sizes" in the
  popup deletes these counts.

## What it sends, and where

The extension talks only to youtube.com, from inside the YouTube page you
already have open:

- a request for a channel's public page header, to read its subscriber count;
- when you are signed in, a request for YouTube's sidebar, to learn which
  channels you subscribe to, so they are never dimmed.

These are the same requests YouTube's own page makes. Their answers stay in
your browser. The extension has no server, no analytics and no ads.

## Permissions

- `storage`: to save your settings.
- Access to `https://www.youtube.com/*` through its content scripts. It does
  not run on any other site.

## Contact

Questions: open an issue at <https://github.com/mekedron/BetterYouTube/issues>.
