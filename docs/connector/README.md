# BetterYouTube connector

The connector lets the BetterYouTube extension summarize videos with the coding
agents you already have on your computer: Claude Code, Codex or Gemini CLI. A
browser extension cannot start programs by itself, so this small helper does it
for the extension, through the browser's native messaging.

## What it does and does not do

- It answers only the BetterYouTube extension. The browser enforces this: the
  connector's manifest names the extension, and no other extension or web page
  can talk to it.
- It can do two things: list which of `claude`, `codex` and `gemini` are
  installed, and run one of them on a prompt (the video's transcript and your
  question) and stream the answer back.
- It runs each agent in an empty temporary folder with its tools turned off,
  because a transcript is text from the internet:
  - Claude Code runs with no tools at all.
  - Codex runs with its shell and other tools switched off, inside its
    read-only sandbox.
  - Gemini CLI runs in read-only plan mode. It can still use its read-only
    tools, such as reading files; it cannot change anything.
- On macOS, Gemini CLI reads its API key from the login keychain on every
  run, and macOS asks for your password each time. Choose "Always Allow" in
  that dialog once, or pick another agent.
- It uses your agents' own logins and subscriptions. It has no key of its own,
  sends nothing anywhere else, and keeps nothing after a run.
- A run that takes longer than 5 minutes, or sends nothing for 90 seconds, is
  stopped.

## Install

Requires macOS or Linux and Node.js 18 or newer.

```sh
curl -fsSL https://mekedron.github.io/BetterYouTube/connector/install.sh | sh
```

Then reopen the extension popup. Install again after you install a new agent
or move one: the connector remembers your `PATH` from the moment you install
it, because browsers start helpers with a minimal one.

For a development build loaded from a folder, also allow its extension id
(shown on `chrome://extensions`):

```sh
curl -fsSL https://mekedron.github.io/BetterYouTube/connector/install.sh | sh -s -- --extension-id <id>
```

A Chromium browser started with `--user-data-dir` looks for the connector in
that directory only. Name it to install there too:

```sh
curl -fsSL https://mekedron.github.io/BetterYouTube/connector/install.sh | sh -s -- --browser-dir <user data dir>
```

## Uninstall

```sh
curl -fsSL https://mekedron.github.io/BetterYouTube/connector/install.sh | sh -s -- --uninstall
```

## Where the files go

- `~/.betteryoutube/connector/host.mjs`: the connector itself.
- `~/.betteryoutube/connector/run.sh`: starts it with your `PATH`.
- `dev.mekedron.betteryoutube.json` in the `NativeMessagingHosts` folder of each
  browser found on the computer (Chrome, Chrome Beta and Canary, Chromium,
  Brave, Edge, Vivaldi, Arc, Firefox). This file tells the browser where the
  connector is and which extension may use it.

Windows is not supported yet.
