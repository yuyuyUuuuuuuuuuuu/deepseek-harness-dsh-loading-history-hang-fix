#!/usr/bin/env bash
# Report whether the running DSH runtime still carries the patches. Exits 1 if not
# (so it can drive a systemd OnFailure= notification or a login-time check).
#   DSH_RUNTIME_DIR  directory holding the version directories and `current` (default: $HOME/.local/dsh-runtime)
#   DSH_HOME         DSH home directory (default: $HOME/.dsh)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RT="${DSH_RUNTIME_DIR:-$HOME/.local/dsh-runtime}"
cur="$(readlink "$RT/current" 2>/dev/null)" || { echo "cannot read the current symlink: $RT/current"; exit 1; }
f="$RT/$cur/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js"
miss=0
[ -f "$f" ] || { echo "not found: $f"; exit 1; }
grep -q "abandonSupersededOpen" "$f"                        || { echo "MISSING patch (D5 superseded open): $cur"; miss=1; }
grep -q "history-unreadable"    "$f"                        || { echo "MISSING patch (D2 history open error state): $cur"; miss=1; }
grep -q "Safari/JSC prints native fns with newlines" "$f"   || { echo "MISSING patch (D1 Safari/JSC validator): $cur"; miss=1; }
hb="${DSH_HOME:-$HOME/.dsh}/profiles/web/cordis.patch.yml"
if [ -f "$hb" ] && ! grep -q "websocketHeartbeatIntervalMs" "$hb"; then
  echo "MISSING setting (D3 heartbeat): $hb"; miss=1
fi
if [ "$miss" -eq 0 ]; then echo "DSH patch: ACTIVE ($cur)"; exit 0; fi
echo "To fix: cd $HERE && ./install.sh --check"
exit 1
