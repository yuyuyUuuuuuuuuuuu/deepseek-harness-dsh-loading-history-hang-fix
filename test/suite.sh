#!/usr/bin/env bash
# Full verification suite.
#   ./suite.sh <patched-runtime> [pristine-runtime]
# A runtime is a directory that contains node_modules/@deepseek-ai.
# The pristine runtime is only needed by section 6; it defaults to <patched-runtime>
# with a trailing "-patched" removed (the layout install.sh creates).
set -u
RT="${1:?usage: ./suite.sh <patched-runtime> [pristine-runtime]}"
PRISTINE="${2:-${RT%-patched}}"
cd "$(dirname "$0")"
fail=0
echo "=== 1. regression (must match unpatched baseline) ==="
node regress.mjs "$RT" || fail=1
echo "=== 2. adversarial ==="
node adversarial.mjs "$RT" || fail=1
echo "=== 3. healthy slow opens must NOT be restarted (opening-deadline guard) ==="
for d in 1000 3000 6000 7500; do
  out=$(node slowopen.mjs "$RT" $d)
  echo "  $out"
  echo "$out" | grep -q "gens=1" || { echo "    FAIL: a healthy ${d}ms open was restarted"; fail=1; }
done
echo "=== 4. listener isolation (D7 guard) ==="
node listener-isolation.mjs "$RT" || fail=1
echo "=== 5. 100 poison shapes x4 seed sets (clientTHREW must be 0) ==="
for off in 0 100 200 300; do
  node poison100.mjs "$RT" 100 $off || fail=1
done
echo "=== 6. sanitizer must not alter valid sessions ==="
if [ "$PRISTINE" = "$RT" ] || [ ! -d "$PRISTINE" ]; then
  echo "  FAIL: section 6 needs the unpatched runtime; pass it as the second argument"; fail=1
else
  node poison-nondestructive.mjs "$PRISTINE" "$RT" || fail=1
fi
echo "=== 7. 100-run randomized stress (HANG must be 0) ==="
node stress.mjs "$RT" 100 60000 || fail=1
echo
[ $fail -eq 0 ] && echo "SUITE PASS" || echo "SUITE FAIL"
exit $fail
