#!/bin/sh
# Installs the BetterYouTube connector: a small native messaging host that lets
# the BetterYouTube extension summarize videos with the coding agents already
# on this computer (Claude Code, Codex, Gemini CLI).
#
#   curl -fsSL https://mekedron.github.io/BetterYouTube/connector/install.sh | sh
#   curl -fsSL .../install.sh | sh -s -- --extension-id <id>   also allow an unpacked build
#   curl -fsSL .../install.sh | sh -s -- --uninstall           remove everything it created
#
# BETTERYOUTUBE_CONNECTOR_URL overrides where host.mjs comes from: a base URL,
# or a local directory that holds host.mjs.
#
# macOS and Linux only. Files go to ~/.betteryoutube/connector plus one
# manifest per browser in that browser's NativeMessagingHosts directory.

set -eu

HOST_NAME="dev.mekedron.betteryoutube"
STORE_ID="dbbghiihkgjghkgbhflpnhajdbfpgnag"
FIREFOX_ID="betteryoutube@mekedron.dev"
SOURCE="${BETTERYOUTUBE_CONNECTOR_URL:-https://mekedron.github.io/BetterYouTube/connector}"
INSTALL_DIR="$HOME/.betteryoutube/connector"

EXTRA_ID=""
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --extension-id)
      [ $# -ge 2 ] || { echo "--extension-id needs a value" >&2; exit 1; }
      EXTRA_ID="$2"
      shift 2
      ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Browser profile directories, and the NativeMessagingHosts directory inside
# each, as "name|profile dir|kind" (kind: chromium or firefox).
browsers() {
  case "$(uname -s)" in
    Darwin)
      base="$HOME/Library/Application Support"
      echo "Google Chrome|$base/Google/Chrome|chromium"
      echo "Google Chrome Beta|$base/Google/Chrome Beta|chromium"
      echo "Google Chrome Canary|$base/Google/Chrome Canary|chromium"
      echo "Chromium|$base/Chromium|chromium"
      echo "Brave|$base/BraveSoftware/Brave-Browser|chromium"
      echo "Microsoft Edge|$base/Microsoft Edge|chromium"
      echo "Vivaldi|$base/Vivaldi|chromium"
      echo "Arc|$base/Arc/User Data|chromium"
      echo "Firefox|$base/Mozilla|firefox"
      ;;
    Linux)
      echo "Google Chrome|$HOME/.config/google-chrome|chromium"
      echo "Chromium|$HOME/.config/chromium|chromium"
      echo "Brave|$HOME/.config/BraveSoftware/Brave-Browser|chromium"
      echo "Microsoft Edge|$HOME/.config/microsoft-edge|chromium"
      echo "Vivaldi|$HOME/.config/vivaldi|chromium"
      echo "Firefox|$HOME/.mozilla|firefox"
      ;;
    *)
      echo "The BetterYouTube connector supports macOS and Linux only." >&2
      exit 1
      ;;
  esac
}

hosts_dir() {
  # Firefox on Linux spells the directory differently.
  if [ "$2" = firefox ] && [ "$(uname -s)" = Linux ]; then
    echo "$1/native-messaging-hosts"
  else
    echo "$1/NativeMessagingHosts"
  fi
}

if [ "$UNINSTALL" = 1 ]; then
  browsers | while IFS='|' read -r name dir kind; do
    target="$(hosts_dir "$dir" "$kind")"
    if [ -f "$target/$HOST_NAME.json" ]; then
      rm -f "$target/$HOST_NAME.json"
      # Removed only when empty, so other apps' hosts stay untouched.
      rmdir "$target" 2>/dev/null || true
      echo "Removed from $name"
    fi
  done
  rm -rf "$INSTALL_DIR"
  rmdir "$HOME/.betteryoutube" 2>/dev/null || true
  echo "BetterYouTube connector removed."
  exit 0
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js 18 or newer is required, and 'node' was not found on your PATH." >&2
  echo "Install it from https://nodejs.org (Claude Code, Codex and Gemini CLI need it too)." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18 or newer is required; found $("$NODE" --version) at $NODE." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
if [ -f "$SOURCE/host.mjs" ]; then
  cp "$SOURCE/host.mjs" "$INSTALL_DIR/host.mjs"
else
  curl -fsSL "$SOURCE/host.mjs" -o "$INSTALL_DIR/host.mjs"
fi

# Browsers start native hosts with a minimal PATH, so the launcher carries the
# PATH of the shell that ran the installer: that is where the agents live.
# The value is written single-quoted, with any single quote escaped.
QUOTED_PATH="$(printf '%s' "$PATH" | sed "s/'/'\\\\''/g")"
cat > "$INSTALL_DIR/run.sh" <<EOF
#!/bin/sh
export PATH='$QUOTED_PATH'
exec "$NODE" "$INSTALL_DIR/host.mjs" "\$@"
EOF
chmod 755 "$INSTALL_DIR/run.sh"

ORIGINS="\"chrome-extension://$STORE_ID/\""
if [ -n "$EXTRA_ID" ]; then
  ORIGINS="$ORIGINS, \"chrome-extension://$EXTRA_ID/\""
fi

registered=""
browsers | {
  while IFS='|' read -r name dir kind; do
    [ -d "$dir" ] || continue
    target="$(hosts_dir "$dir" "$kind")"
    mkdir -p "$target"
    if [ "$kind" = firefox ]; then
      allowed="\"allowed_extensions\": [\"$FIREFOX_ID\"]"
    else
      allowed="\"allowed_origins\": [$ORIGINS]"
    fi
    cat > "$target/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "BetterYouTube connector: runs local coding agents for video summaries",
  "path": "$INSTALL_DIR/run.sh",
  "type": "stdio",
  $allowed
}
EOF
    registered="$registered
  - $name"
  done
  if [ -z "$registered" ]; then
    echo "No supported browser was found. Open your browser once, then run this again." >&2
    exit 1
  fi
  echo "BetterYouTube connector installed in $INSTALL_DIR."
  echo "Registered with:$registered"
  echo "Reopen the BetterYouTube popup to use your agents."
}
