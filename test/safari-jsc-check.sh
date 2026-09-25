#!/usr/bin/env bash
# D1 reproducer: cut the lossless-JSON validator out of a runtime's browser bundle
# (dsh-api-session-controller/lib/client.js) and run it in JavaScriptCore, the engine
# Safari uses. The bundle code is used as-is; only the test calls are added.
#   ./safari-jsc-check.sh <pristine-runtime>   # -> "chunk record (usage): THROWS ..."
#   ./safari-jsc-check.sh <patched-runtime>    # -> "chunk record (usage): OK"
# Requires python3-gi and gir1.2-javascriptcoregtk-6.0 (Debian/Ubuntu package names).
set -euo pipefail
T="${1:?runtime tree}"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C="$T/node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js"
S=$(grep -n "Whether a realm-owned intrinsic prototype" "$C" | cut -d: -f1)
E=$(awk -v s="$S" 'NR>s+330 && /#endregion|^\t\tvar |^\t\tclass |^\t\tconst /{print NR-1; exit}' "$C")
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
sed -n "${S},${E}p" "$C" > "$TMP"
python3 - "$HERE/safari-jsc-tests.js" "$TMP" <<'PY'
import sys, gi; gi.require_version("JavaScriptCore","6.0")
from gi.repository import JavaScriptCore as J
tests, val = sys.argv[1], sys.argv[2]
src = "var AbortSignal=function(){};\n" + open(val).read() + "\n" + open(tests).read()
ctx = J.Context.new(); r = ctx.evaluate(src, -1); ex = ctx.get_exception()
print(("EXC: " + ex.get_message()) if ex else r.to_string())
PY
