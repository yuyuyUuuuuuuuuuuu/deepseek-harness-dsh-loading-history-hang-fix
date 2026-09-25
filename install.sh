#!/usr/bin/env bash
# DSH "Loading history..." hang: apply the patches in this repository.
#
#   ./install.sh                 ... patch the version `current` points to, then switch to the copy
#   ./install.sh --version X     ... patch version X (re-apply after an upgrade)
#   ./install.sh --check [X]     ... only test whether every patch applies; change nothing
#   ./install.sh --rollback      ... point `current` back at the version recorded at install time
#
# Assumed layout (override with DSH_RUNTIME_DIR):
#   $DSH_RUNTIME_DIR/<version>/node_modules/@deepseek-ai/...   one npm install per version
#   $DSH_RUNTIME_DIR/current -> <version>                      what DSH is launched from
#
# Design:
#   - The pristine version directory is never modified. It is copied to `<version>-patched`
#     and the patches are applied to the copy.
#   - Switching and rolling back only re-point the `current` symlink.
#   - If any patch fails to apply, nothing is switched (no half-patched state).
#
# Environment:
#   DSH_RUNTIME_DIR  directory that holds the version directories (default: $HOME/.local/dsh-runtime)
#   DSH_HOME         DSH home directory (default: $HOME/.dsh)
#   DSH_SERVICE      optional systemd *user* unit to restart after switching; if unset, restart DSH yourself
#   NODE_BIN         node binary used for the syntax check (default: node)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHDIR="$HERE/patches"
RTDIR="${DSH_RUNTIME_DIR:-$HOME/.local/dsh-runtime}"
CURRENT="$RTDIR/current"
SERVICE="${DSH_SERVICE:-}"
STATE="$HERE/.installed-from"

# Each entry is "<package>.<file>"; patches/<entry>.patch is applied to
# node_modules/@deepseek-ai/<package>/lib/<file>.
# The Safari/JSC validator fix (D1) is in dsh-api-session-controller.client.js and dsh-util-values.index.js.
PATCHES=(
  dsh-api-gateway.client.js
  dsh-api-session-controller.client.js
  dsh-api-workspace-controller.client.js
  dsh-client-ui-settings-plugins.client.js
  dsh-session-projection.index.js
  dsh-client-ui-permission-presets.client.js
  dsh-client-ui-settings-models.client.js
  dsh-session-query-sqlite.index.js
  dsh-client-ui-chat.client.js
  dsh-api-session-controller.index.js
  dsh-llm-pi-ai.index.js
  dsh-session.index.js
  dsh-util-values.index.js
)
pkg_of(){ echo "${1%%.*}"; }
file_of(){ echo "${1#*.}"; }

die(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "  $*"; }

restart_dsh(){
  if [ -n "$SERVICE" ]; then
    systemctl --user restart "$SERVICE"
    info "restarted $SERVICE"
  else
    info "Restart DSH now so it loads the switched runtime (set DSH_SERVICE to do this automatically)."
  fi
}

base_version(){
  local v; v="$(readlink "$CURRENT")" || die "cannot read the current symlink: $CURRENT"
  # If current already points at a -patched copy, return the version it was made from
  echo "${v%-patched}"
}

apply_to(){   # $1 = target tree (absolute path)
  local tree="$1" ok=1
  for p in "${PATCHES[@]}"; do
    local lib="$tree/node_modules/@deepseek-ai/$(pkg_of "$p")/lib"
    [ -f "$lib/$(file_of "$p")" ] || { info "SKIP  $p (not present in this version)"; continue; }
    if (cd "$lib" && patch -p0 --dry-run --silent < "$PATCHDIR/$p.patch" >/dev/null 2>&1); then
      (cd "$lib" && patch -p0 --silent < "$PATCHDIR/$p.patch" >/dev/null)
      info "OK    $p"
    else
      info "FAIL  $p  <- does not apply to this version"
      ok=0
    fi
  done
  return $((1-ok))
}

check_to(){   # dry run only
  local tree="$1" ok=1
  for p in "${PATCHES[@]}"; do
    local lib="$tree/node_modules/@deepseek-ai/$(pkg_of "$p")/lib"
    [ -f "$lib/$(file_of "$p")" ] || { info "SKIP  $p (not present)"; continue; }
    if (cd "$lib" && patch -p0 --dry-run --silent < "$PATCHDIR/$p.patch" >/dev/null 2>&1); then
      info "OK    $p"
    else
      info "FAIL  $p"; ok=0
    fi
  done
  return $((1-ok))
}

install_setting(){  # D3 heartbeat setting (works without any code change)
  local home="${DSH_HOME:-$HOME/.dsh}"
  local f="$home/profiles/web/cordis.patch.yml"
  [ -f "$f" ] || { info "no settings file at $f (skipped; see README, 'Configuration')"; return 0; }
  if grep -q "websocketHeartbeatIntervalMs" "$f"; then
    info "heartbeat setting already present"
  else
    cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"
    cat >> "$f" <<'YAML'

# Relax the WebSocket heartbeat (default: 2000 ms x 2 missed pongs -> terminated after ~4-6 s).
# Background tabs, locked phones and congested links easily miss two pings; the
# reconnect that follows can strand the history stream on "Loading history...".
# NOTE: the id is typert-gateway, not api-gateway (see dsh-base/cordis.patch.yml).
#       Putting this in settings.yaml has no effect, and a wrong id is ignored silently.
- id: typert-gateway
  config:
    websocketHeartbeatIntervalMs: 30000
YAML
    info "heartbeat setting appended (backup: $f.bak-*)"
  fi
}

case "${1:-}" in
  --check)
    BASE="${2:-$(base_version)}"
    info "checking: $RTDIR/$BASE"
    check_to "$RTDIR/$BASE" && echo "  => every patch applies" || { echo "  => some patches do not apply (see UPGRADE.md)"; exit 1; }
    ;;
  --rollback)
    [ -f "$STATE" ] || die "do not know where to roll back to ($STATE is missing)"
    PREV="$(cat "$STATE")"
    [ -d "$RTDIR/$PREV" ] || die "$RTDIR/$PREV does not exist"
    ln -sfn "$PREV" "$CURRENT"
    info "rolled back: current -> $PREV"
    restart_dsh
    ;;
  *)
    BASE="$(base_version)"
    [ "${1:-}" = "--version" ] && BASE="${2:?specify a version}"
    SRC="$RTDIR/$BASE"
    DST="$RTDIR/$BASE-patched"
    [ -d "$SRC" ] || die "$SRC does not exist"

    info "source version: $BASE"
    [ -d "$DST" ] && { info "rebuilding existing $DST"; rm -rf "$DST"; }
    cp -a "$SRC" "$DST"
    info "copied to: $DST"

    if ! apply_to "$DST"; then
      rm -rf "$DST"
      die "some patches did not apply; aborted (the running version is untouched)"
    fi

    # Syntax check: a broken bundle means a blank UI.
    # client.js is a browser bundle (checked with new Function);
    # index.js is ESM (checked with import). Using the wrong checker reports
    # healthy files as broken, so keep them separate.
    NODE_BIN="${NODE_BIN:-node}"
    for p in "${PATCHES[@]}"; do
      cf="$DST/node_modules/@deepseek-ai/$(pkg_of "$p")/lib/client.js"
      if [ -f "$cf" ]; then
        "$NODE_BIN" -e "new Function(require('fs').readFileSync('$cf','utf8'))" 2>/dev/null \
          || { rm -rf "$DST"; die "syntax check failed (browser bundle): $cf"; }
      fi
      mf="$DST/node_modules/@deepseek-ai/$(pkg_of "$p")/lib/index.js"
      if [ -f "$mf" ]; then
        "$NODE_BIN" --input-type=module -e "await import('$mf')" >/dev/null 2>&1 \
          || { rm -rf "$DST"; die "syntax check failed (ESM): $mf"; }
      fi
    done
    info "syntax check: all files OK"

    install_setting
    echo "$BASE" > "$STATE"
    ln -sfn "$(basename "$DST")" "$CURRENT"
    info "switched: current -> $(readlink "$CURRENT")"
    restart_dsh
    info "to undo: $HERE/install.sh --rollback"
    ;;
esac
