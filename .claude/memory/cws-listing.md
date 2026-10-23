---
name: cws-listing
description: BetterYouTube Chrome Web Store item id, publisher account, and why CI cannot publish yet
metadata:
  type: project
---

The Chrome Web Store item is `dbbghiihkgjghkgbhflpnhajdbfpgnag`, under the publisher "Nikita Rabykin" in the dashboard at `chrome.google.com/u/1/webstore/devconsole` (Google account index 1 in the agent Chrome). Version 0.1.0 was submitted for review on 2026-10-23 with auto-publish on.

The repo secret `CHROME_EXTENSION_ID` is set; `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` are not. The OAuth client secret in 1Password (vault InputStash, item "Chrome Web Store OAuth Client ID") is stale: Google answers `invalid_client`. The working copy lives only in the InputStash repo's GitHub secrets (rotated 2026-07-04).

**Why:** release.yml skips the store upload until all four secrets exist.
**How to apply:** before relying on `git tag` to ship a new version, get the current client secret (or add a new one in GCP project nikita-rabykin), mint a refresh token, set the three secrets, and update the 1Password item.
