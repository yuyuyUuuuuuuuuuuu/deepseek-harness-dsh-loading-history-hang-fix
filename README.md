# DSH "Loading history…" hang: causes and patches

Analysis, patches and a test suite for a bug in the web UI of DeepSeek Harness
(DSH, npm `@deepseek-ai/dsh`) where a session view stays on **"Loading history…"**
and never shows the conversation.

This is an independent community project and is not affiliated with DeepSeek.
DSH is MIT-licensed; the patches here modify DSH code (see [NOTICE](NOTICE)).

## At a glance

**What goes wrong.** Several independent defects end on the same screen:

- **Safari / WebKit: root cause found (D1).** In Safari on macOS and in browsers on
  iPhone/iPad (which use WebKit), opening or reloading a session **while a turn is
  running** hangs **every time**, on perfectly valid data. The browser console shows
  `TypeError: Assistant stream raw chunk must be a lossless JSON object`. The view
  recovers only after the turn has finished. The cause is a lossless-JSON validator
  that compares `Function.prototype.toString.call(Object)` with the exact output of
  V8. JavaScriptCore puts newlines in that string, so the validator rejects every plain
  object. Firefox is affected by the same check: Firefox 155 also puts newlines in that
  string (checked in headless Firefox; the full DSH UI was not run there). Chrome, Edge
  and Node use V8 and never show the bug.
- **All browsers, especially remote and mobile use (D3 to D6).** The server's WebSocket
  heartbeat drops a client after about 4 to 6 seconds without a pong (a background tab,
  a locked phone, a congested link). Races on the reconnect path can then leave the
  history request waiting forever. This hang often survives reloads and clears only
  when DSH is restarted.
- **More defects on the same paths (D7 to D21).** In two server-side places (D7, D8),
  one throwing event listener silently stops event delivery to every connected browser.
  In eleven places (D9 to D19), a view sets `loading` or `saving` and never settles it
  when an error or a superseded request returns early. Search can stay disabled after one
  failed open (D20), and a failed fork is swallowed (D21).

**Quickest relief.**

| Where you see it | What to do |
|---|---|
| Safari, iPhone, iPad | Apply `patches/dsh-api-session-controller.client.js.patch` and `patches/dsh-util-values.index.js.patch` (they contain the one-line fix D1), then restart DSH. See [Applying and reverting](#3-applying-and-reverting). Without patching, wait for the turn to finish and then reload. |
| Remote access, phones, background tabs | Add the heartbeat setting. It is configuration only and survives upgrades. See [3.1](#31-configuration-d3-no-code-change). |
| Anywhere | `./install.sh` applies all 13 patches to a copy of the runtime and switches to it. `./install.sh --rollback` switches back. |

**Versions.** Analysed and patched on **0.1.6-alpha.1**. The affected code is
byte-identical in 0.1.6-alpha.2. In **0.1.7-rc.2** (published 2026-09-24) the
validator behind D1 is unchanged. The other patches have not been re-checked against
0.1.7; run `./install.sh --check <version>` before using them there.

## Contents

| Path | Purpose |
|---|---|
| `patches/*.patch` | 13 patches, one per file. `<package>.<file>.patch` applies with `patch -p0` inside `node_modules/@deepseek-ai/<package>/lib/`. |
| `install.sh` | Copies a runtime version, patches the copy, checks syntax and switches to it. Supports `--check` and `--rollback`. |
| `patch-status.sh` | Reports whether the running runtime still carries the patches and the setting. |
| `UPGRADE.md` | What to do after upgrading DSH. |
| `test/` | Verification scripts. They load the shipped DSH code from an installed runtime. |
| `tools/` | Heuristic scanners for the two defect patterns. |
| `results/` | Raw outputs of the suite and of the stress test. |

## 1. Symptoms

- A session opens to "Loading history…" and the history never appears.
- The activity indicator (for example "Deep diving…") can keep animating: the turn is
  still running on the server.
- Safari/WebKit: happens on every open or reload while a turn is running, and clears when
  the turn ends.
- Other browsers: intermittent, and much more frequent over remote access and on phones.
  Reloading rarely helps (roughly one try in twenty in our observation). Restarting DSH
  does.

"Loading history…" is rendered while the session's `openState === "loading"`
(`dsh-client-ui-chat/lib/client.js`, line 2529 in 0.1.6-alpha.1). Each defect below is a
path on which that state is never left, or on which the data the view waits for never
arrives.

## 2. Defects and fixes

| ID | Defect | Package | Fix |
|---|---|---|---|
| D1 | Validator rejects every plain object on JavaScriptCore | `dsh-api-session-controller` (browser), `dsh-util-values` | patch |
| D2 | A history record that fails validation leaves `openState` at `loading` | `dsh-api-session-controller` | patch |
| D3 | Heartbeat terminates a client after about 4 to 6 s without pongs | `dsh-api-gateway` (default) | **setting** |
| D4 | A replaced stream generation strands the pending first item | `dsh-api-gateway` | patch |
| D5 | A superseded `doOpen()` returns silently in `loading` | `dsh-api-session-controller` | patch |
| D6 | `followCurrent()` never re-opens the already-watched session | `dsh-api-session-controller` | patch |
| D7 | A throwing projection listener stops event delivery to all browsers | `dsh-session-projection` | patch |
| D8 | The same in the assistant-stream accumulator | `dsh-api-session-controller` (server) | patch |
| D9 to D19 | Busy state not settled before rethrow or early return (11 places) | several UI packages | patch |
| D20 | Search caches a rejected open until restart | `dsh-session-query-sqlite` | patch |
| D21 | A failed fork is swallowed (inert button) | `dsh-client-ui-chat` | patch |
| H1, H2 | Hardening against non-lossless data (not a cause of the reported hang) | `dsh-llm-pi-ai`, `dsh-session` | patch |

Patch files and the defects they contain:

| Patch | Defects |
|---|---|
| `dsh-api-session-controller.client.js.patch` | D1 (browser copy), D2, D5, D6, D9, D10, D19 |
| `dsh-util-values.index.js.patch` | D1 (server copy) |
| `dsh-api-gateway.client.js.patch` | D4 |
| `dsh-session-projection.index.js.patch` | D7 |
| `dsh-api-session-controller.index.js.patch` | D8 |
| `dsh-api-workspace-controller.client.js.patch` | D11 |
| `dsh-client-ui-settings-plugins.client.js.patch` | D12, D13, D14 |
| `dsh-client-ui-permission-presets.client.js.patch` | D15, D16 |
| `dsh-client-ui-settings-models.client.js.patch` | D17, D18 |
| `dsh-session-query-sqlite.index.js.patch` | D20 |
| `dsh-client-ui-chat.client.js.patch` | D21 |
| `dsh-llm-pi-ai.index.js.patch` | H1 |
| `dsh-session.index.js.patch` | H2 |

### D1. Safari/WebKit: the lossless-JSON validator rejects every plain object

`hasIntrinsicConstructor()` lives in `dsh-util-values` and is inlined into the browser
bundle `dsh-api-session-controller/lib/client.js`. It decides whether a prototype is a
realm's real `Object.prototype` by exact string comparison:

```js
Function.prototype.toString.call(constructor) === `function ${name}() { [native code] }`
```

That string is V8's format. JavaScriptCore returns the same text with line breaks
(measured with WebKitGTK 2.52.3):

```
V8 : "function Object() { [native code] }"
JSC: "function Object() {\n    [native code]\n}"
```

On Safari this leads to:

1. `hasIntrinsicConstructor(Object.prototype, "Object")` returns `false`.
2. `hasPlainObjectPrototype()` therefore rejects every plain object.
3. `snapshotJsonValue({...})` returns `undefined`.
4. `snapshotChunk()` throws `Assistant stream chunk must be losslessly JSON-serializable`,
   and `validateRecord()` rethrows it as
   `Assistant stream raw chunk must be a lossless JSON object`.
5. `doOpen()` rethrows the error (D2). The rejection is unhandled and `openState` stays
   `"loading"`.

Why it happens only while a turn is running, and why reloading does not help:

- The client calls `expandAssistantStream()` in one place only: in `replace()`, on
  `baseline.activeAttempt.stream`. That is the live attempt the server includes when a
  turn is in progress. Attempts stored on disk are not expanded by the client.
- Only `chunk` records (`block-start`, `usage`, `finish`, and so on) go through
  `snapshotChunk()`. `text-chunks` and `reasoning-chunks` records do not. Once the
  assistant has started its first block, the live attempt contains a `chunk` record.
- Long turns with many tool calls keep this window open for a long time, which is why
  the bug looks load-related.
- Every reload receives the same baseline until the turn ends.
- Chromium-based browsers and Node run V8, so tests there cannot reproduce the bug.

**Fix** (one line, applied to both copies): normalise whitespace before comparing. The
purpose of the check, rejecting forged prototypes, is unchanged.

```js
Function.prototype.toString.call(constructor).replace(/\s+/g, " ") === `function ${name}() { [native code] }`
```

- `dsh-api-session-controller/lib/client.js` is the browser copy, and the one that matters.
- `dsh-util-values/lib/index.js` is the server copy. V8 already passes there; it is changed
  so that the two definitions stay identical.

Browser caching does not get in the way. The bundle URL carries a content hash (`rev=`,
computed with `framedHash("combo", sourceBytes)`) and is served with
`cache-control: public, max-age=31536000, immutable`. A patched bundle therefore gets a
new URL, and Safari does not keep using the old cached one.

The same exact-match check also exists in Node-only packages (`dsh-cordis-host-runner`,
`dsh-tools`, `dsh-ptc-runtime-node`, `dsh-workflow-ptc`). They run on V8 and are not
changed here.

**Evidence 1: the shipped validator in JavaScriptCore.** `test/safari-jsc-check.sh` cuts
the validator out of the runtime's browser bundle without changing it and runs it in
JavaScriptCore (WebKitGTK 2.52.3). The `usage` chunk is copied from a real turn and is
valid data. Output, abridged:

```
JavaScriptCore, pristine 0.1.6-alpha.1
  hasIntrinsicConstructor(Object.prototype,'Object') = false
  snapshotJsonValue({a:1}) = undefined
  text-chunks record  : OK
  chunk record (usage): THROWS Assistant stream raw chunk must be a lossless JSON object
                        | cause: Assistant stream chunk must be losslessly JSON-serializable
JavaScriptCore, patched
  hasIntrinsicConstructor(Object.prototype,'Object') = true
  chunk record (usage): OK
Node / V8 (control): OK on both trees
```

**Evidence 2: end to end in a real WebKit browser.** `test/webkit-e2e.mjs` uses
Playwright's WebKit build (user agent `Safari/605.1.15 Version/26.6`, headless). It starts
a long turn in one tab and opens the same session in a second tab while the turn is
running. The same flow was run in Chromium as a control, against the same server.

| Server | Browser | Result | Page errors |
|---|---|---|---|
| pristine 0.1.6-alpha.1 | **WebKit** | **STUCK** 4/4 (still "Loading history…" after 25 s) | `TypeError: Assistant stream raw chunk must be a lossless JSON object` ×4 |
| pristine 0.1.6-alpha.1 | Chromium | history loads 2/2 (1.4 s) | 0 |
| patched | **WebKit** | **history loads** 4/4 (2.2 s) | 0 |

With the same server and the same steps, only the engine decides whether the bug
appears. Neither the data nor the server is involved.

### D2. A history record that fails validation leaves the view in "loading" forever

`doOpen()` catches the error from `events.open()` but rethrows anything that is not a
remote failure, and it does so before it sets a state. The rejection goes unhandled, the
`finally` block only marks the view dirty, and `openState` stays `"loading"`.

**Fix:** publish `openState = "error"` with
`{ code: "session/history-unreadable", message }` and log the error to the console.

D2 does not fix D1, but it turns any future validation failure into a visible error
instead of a permanent "Loading history…". Both fixes are needed: without D1, Safari
always fails, and without D2, any such failure becomes a hang.

### D3. The heartbeat drops clients after about 4 to 6 seconds

```js
const MAX_MISSED_HEARTBEATS = 2;
const DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 2e3;
```

A single shared interval timer pings every socket. A socket that has missed two pings is
terminated on the next tick. Measured with a client that never answers pings
(`test/nopong.mjs`):

| Path | First ping | Second ping | Closed by the server |
|---|---|---|---|
| direct, local | | | after 4.0 s |
| through a remote-access path (the one the browser used) | 0.8 s | 2.8 s | after 4.8 s |
| same path, `websocketHeartbeatIntervalMs: 30000` | 30.0 s | | still open at 40 s |

A background tab, a locked phone or a congested link can easily miss two pings. The
disconnect itself does no harm. The reconnect that follows is where D4 to D6 strand the
view.

Field observation while three sessions were stuck on "Loading history…" on a remote
laptop (read-only observation of the running server):

| Observation | Value |
|---|---|
| Connections from that laptop to DSH | 0 |
| Traffic on the remote-access interface over 8 s | 0 bytes in both directions |
| Send-Q / Recv-Q on every DSH socket | all 0 (no back-pressure) |
| Server side | all three turns still running, events still advancing |
| Model backend | healthy, producing tokens |

The server and the model kept working. The client's connection was gone, and the UI did
not say so.

**Fix:** configuration only (see [3.1](#31-configuration-d3-no-code-change)).

### D4. A replaced generation strands the pending first item of `RemoteStream`

`RemoteStream.read()` (`dsh-api-gateway/lib/client.js`) handles a generation change (a
reconnect or `restart()`) with `break` and then `continue`, so it moves to the next
generation without yielding anything. The `iterator.next()` that `open()` is waiting on is
never resolved or rejected. `doOpen()`'s `catch` never runs, so no error is shown either.
In addition, while the connection is healthy, `waitForRemoteStreamRetry()` allows a single
retry (`if (attempt === 1) return; throw error;`), which gives two generations in total.

**Fix:** put a deadline on the first item of each generation, and only on the first item.
If a generation's first item does not arrive in time, the generation is aborted and
counted as a generation change (`revision++`), not as a used-up retry. The stream then keeps
re-opening until the server answers.

| Situation | Deadline for the first item |
|---|---|
| First open, no disruption | 20 s |
| After a disruption (reconnect, `restart()` or an earlier stall) | 2.5 s, doubling with each stall up to 20 s; reset when an item arrives |

The deadline is cleared once the first item has arrived, so an idle live tail is never
timed out. This was tested with 25 s of silence after the first item.

Design notes. Each alternative below was implemented and measured:

- **Fixed deadlines add up.** With a fixed 20 s deadline, three consecutive stalls took
  60 s, and to the user that is a hang.
- **The first open must not get a short deadline.** A 2.5 s deadline restarted a healthy
  6 s open, which then took 18 s. With a 10 s deadline for the first open, a healthy 12 s
  open took 48 s and 4 restarts. With the final design, the same 12 s open completes in
  12.0 s in a single generation.
- **For scale:** in the largest real session available (18 MB, about 6,400 events) the
  server produced the first item in 127 to 248 ms, depending on how it was measured.
  20 s leaves at least 80 times that as headroom.
- **Implementation detail:** decide whether a generation is "disrupted" by comparing
  with the revision captured when `read()` starts. A variable that is itself
  initialised from `this.revision` cannot tell the difference.
- **Result:** recovery after a disruption takes 7.5 s. With the fixed 20 s deadline it
  took 60 s.

The deadline designs compared with the 100-scenario stress test (see [4](#4-verification)):

| Design | HANG | slow (> 10 s) | worst |
|---|---|---|---|
| pristine | 45/100 | n/a | n/a |
| fixed 20 s | 19/100 | n/a | 60.0 s |
| fixed 8 s | 0/100 | 19 | 24.1 s |
| **final: disruption-aware, adaptive** | **0/100** | **0** | **7.6 s** |

### D5. A superseded `doOpen()` returns silently in "loading"

If the open generation changes while `events.open()` is pending, both the success path
and the error path `return` without touching `openState`. `open()`'s `finally` clears
`openPromise`, and nothing calls `open()` again, so the view stays "loading" until a full
page reload.

**Fix:** `abandonSupersededOpen()` moves `loading` back to `cold`, so the next `open()`
starts it again. `test/model-superseded-open.mjs` models the pattern.

### D6. `followCurrent()` never re-opens the session that is already watched

`followCurrent()` returns early when `current === this.watched`. After D5 has moved a
session back to `cold` while it stays selected, nothing would open it again.

**Fix:** for the already-watched session, call `session.open()` (which is idempotent) and
return.

### D7. One throwing `session/event` listener stops event delivery to every browser

cordis' `emit()` does not isolate listeners:

```js
emit(...args) { this.dispatch("emit", args).map((cb) => cb(...args)); }   // no try
```

The `session/event` handler in `dsh-session-projection` calls `apply()` and
`viewSchema.parse()` without a guard. When one projection throws, every later listener for
that event is skipped. That includes the listener in `follow()` that streams events to
connected clients. The socket stays open and nothing arrives: the activity indicator runs
above a view that never fills.

**Fix:** catch and log inside the projection handler.

### D8. The same in `SessionAssistantStreamAccumulator.accept()`

`accept()` (`dsh-api-session-controller/lib/index.js`) runs inside an
`agent/assistant-stream` listener and calls `attempt.stream.push()`, which throws on a
non-lossless chunk. The throw would skip every later listener, delivery to browsers
included.

**Fix:** catch the error, log a warning, and drop that attempt's live baseline
(`activeAttempt = undefined`). The durable session log is written by another path and is
unaffected. On V8 this triggers only for chunks that really are non-lossless (see H1), so
this fix is containment.

### D9 to D19. The same anti-pattern in other views

In each of these places a view sets a busy state (`loading`, `saving` or a pending flag)
and then returns or rethrows before settling it. The `finally` blocks clear only the
in-flight guard, not the state the UI renders.

| ID | Where | What happens |
|---|---|---|
| D9 | `dsh-api-session-controller` `refreshList()` | Rethrows before `listState = "error"`, so the sidebar stays loading |
| D10 | `dsh-api-session-controller` `refreshSubagents()` | Same, for the subagent catalog |
| D11 | `dsh-api-workspace-controller` `handleStreamFailure()` | Rethrows before publishing `error`; the view was already parked in `loading` by `handleCarrierFailure()` |
| D12 | `dsh-client-ui-settings-plugins` `loadCatalog()` | A superseded load returns in `loading`, and the method's own re-entry guard then refuses every later load (deadlock) |
| D13 | `dsh-client-ui-settings-plugins` `save()` | Throws with `saving = true`, so every later save is refused |
| D14 | `dsh-client-ui-settings-plugins`, superseded save | Returns with `saving = true`; same effect |
| D15 | `dsh-client-ui-permission-presets` `load()` | Awaits `describeFace.ensure()` without a guard; a throw skips `derive()` and the panel stays loading |
| D16 | `dsh-client-ui-permission-presets` `select()` | `finally` resets the guard, but after a throw the visible `status = "saving"` remains |
| D17 | `dsh-client-ui-settings-models` `load()` | `Promise.all` has no catch; a rejection skips `failLoad()` and the panel stays loading |
| D18 | `dsh-client-ui-settings-models`, welcome notice acknowledgement | `scope.set()` throws, `derive()` is skipped, and the view stays saving |
| D19 | `dsh-api-session-controller`, prompt submission | `firstPromptPendingTurn` stays `true` after a failed prompt; only turn events reset it, and none will come |

**Fix** in every case: settle the visible state (`error` or `idle`) before any rethrow or
early return.

### D20. Search caches a rejected open forever

`this._ready ??= this._open()` in `dsh-session-query-sqlite` caches a rejected promise.
One transient failure disables search until DSH restarts.

**Fix:** clear `_ready` when that attempt rejects.

### D21. A failed fork is swallowed

`forkAt(...).catch(() => {})` in `dsh-client-ui-chat`: when a fork fails, nothing happens
and nothing is reported, so the button just seems dead.

**Fix:** log the error (`[chat] fork failed:`). No error surface in the UI is wired up at
that point.

### Hardening: H1 and H2 (not a cause of the reported hang)

- **H1.** `mapUsage()` in `dsh-llm-pi-ai` copies the provider's token counts unchanged.
  pi-ai already turns `undefined` and `NaN` into 0 (`|| 0`), but a non-finite value such as
  `Infinity` (for example from a JSON `1e400`) would pass through and make the usage chunk
  non-lossless. **Fix:** normalise every count to a finite integer, with 0 as the default.
  With the patch, three real turns on a live server recorded their usage unchanged (for
  example `inputTokens: 2720`, `totalTokens: 7331`, `cacheReadTokens: 4608`). Those session
  logs are not included here.
- **H2.** `Session.fromRestore()` in `dsh-session` adopts restored events without lossless
  validation. This is by design; its docstring says: "Embedded Assistant streams remain
  opaque until a stream consumer or storage verifier reads them." Non-lossless data in a
  restored event therefore survives the restore and makes a later
  `expandAssistantStream()` throw. **Fix:** when a restored event is not lossless, replace
  the values that cannot be represented with `null`, using a walker that never throws. A
  `JSON.parse(JSON.stringify())` round trip does not work here: it throws on BigInt, on
  cycles and on a throwing `toJSON`. In the tests, that turned 19 of 100 cases from
  "unreadable" into "cannot be opened at all". Valid events are left untouched (200 of 200
  identical).

No such data was found on disk (0 non-lossless chunks in 268 real sessions, 7,040
streams), and the browser does not expand attempts stored on disk. H1 and H2 are defence
in depth.

### Investigated and ruled out

- **Head-of-line blocking in the shared mux write queue.** A 24 times larger backlog added
  0 ms of latency, and every Send-Q and Recv-Q was 0 in the field.
- **A slow `follow()` on the server.** With the shipped code instrumented, the first item
  came after 248 ms for an 18 MB / 6,431-event session.
- **`checkRootEncoding`.** 7 ms, and the result is cached.
- **`toPiReplayState()` returning `undefined` for unknown blocks.** The entry validation in
  `push()` rejects such values, so they are never stored.
- **The v0 to v3 session migrations.** They do not create `chunk` records.
- **Different validators on server and client.** `snapshotChunk` is the same
  implementation on both sides.

### Deliberately not changed

- **Isolating listeners in cordis `emit()`.** This would fix D7 and D8 at the root. But
  `emit()` has 133 call sites, 5 of them wrapped in `try`, and we cannot show that
  nothing depends on a listener's exception propagating. This change belongs upstream.
- **Handlers with a similar exposure but narrow reach.** `dsh-client-file-upload`,
  `dsh-file-reference-local`, `dsh-goal`, `dsh-permission-presets` and
  `dsh-session-title` return early by event type. The `invariant.js` modules are not
  loaded by the web profile.
- **Scanner hits that turned out to be harmless** (confirmed by reading the code):
  - `dsh-client-ui-model-selection`: `invalidate()` always resets to `idle`.
  - A suspected lost wake-up in `follow()`: there is no `await` between `popFront()` and
    `wake = resolve`.
  - `loadThrough()`: every return is inside `try`, so `finally` always runs.

## 3. Applying and reverting

### 3.1 Configuration (D3, no code change)

Append to `$DSH_HOME/profiles/web/cordis.patch.yml` (`DSH_HOME` defaults to `~/.dsh`):

```yaml
- id: typert-gateway
  config:
    websocketHeartbeatIntervalMs: 30000
```

- The id is **`typert-gateway`**, not `api-gateway` (see `dsh-base/cordis.patch.yml`).
- The setting has no effect in `settings.yaml`.
- A wrong id is ignored **silently**. Check that the setting took effect with
  `test/nopong.mjs`: the socket should survive 20 s.
- The file is outside the runtime directory, so the setting survives DSH upgrades.

With the setting, a client whose pongs stop is dropped after 60 to 90 s instead of 4 to
6 s. The setting reduces disconnects, and the patches (D4 to D6) make the view recover
when a disconnect happens anyway. Use both.

### 3.2 `install.sh`

`install.sh` assumes one npm install per DSH version and a `current` symlink that DSH is
launched from:

```
$DSH_RUNTIME_DIR/0.1.6-alpha.1/node_modules/@deepseek-ai/...   pristine, never modified
$DSH_RUNTIME_DIR/0.1.6-alpha.1-patched/...                     created by install.sh
$DSH_RUNTIME_DIR/current -> 0.1.6-alpha.1-patched
```

```bash
./install.sh --check             # dry-run every patch against the version `current` points to
./install.sh                     # copy the version to <version>-patched, patch the copy,
                                 # syntax-check it, add the heartbeat setting, switch `current`
./patch-status.sh                # prints "DSH patch: ACTIVE (<version>-patched)"
./install.sh --rollback          # point `current` back at the pristine version
```

| Variable | Default | Meaning |
|---|---|---|
| `DSH_RUNTIME_DIR` | `~/.local/dsh-runtime` | Directory with the version directories and `current` |
| `DSH_HOME` | `~/.dsh` | DSH home; the heartbeat setting goes into `profiles/web/cordis.patch.yml` |
| `DSH_SERVICE` | (unset) | A systemd user unit to restart after switching. If unset, restart DSH yourself. |
| `NODE_BIN` | `node` | Node used for the syntax check |

If any patch fails to apply, `install.sh` deletes the copy and does not switch. Before
appending the heartbeat setting, it saves a timestamped backup of `cordis.patch.yml`.
Only 13 of about 23,000 files in the copied runtime differ from the pristine version.

### 3.3 Applying by hand

For any other installation layout (for example a global npm install), apply the patches
in place. Take a backup of the affected packages first.

```bash
NM="$(npm root -g)/@deepseek-ai"      # adjust to where DSH is installed
P="$PWD/patches"
for f in "$P"/*.patch; do
  n="$(basename "$f" .patch)"         # <package>.<file>, e.g. dsh-api-gateway.client.js
  (cd "$NM/${n%%.*}/lib" && patch -p0 --dry-run < "$f")
done
# If every dry run succeeds, run the same loop without --dry-run, then check syntax:
#   browser bundles: node -e "new Function(require('fs').readFileSync('client.js','utf8'))"
#   ESM modules:     node --input-type=module -e "await import('/absolute/path/index.js')"
```

A broken `client.js` means a blank UI, so do not skip the syntax check. Restart DSH
afterwards. To revert, run the same loop with `patch -p0 -R`, or reinstall DSH.

After a DSH upgrade the patches are gone, because the new version lives in a new
directory. See [UPGRADE.md](UPGRADE.md).

## 4. Verification

The tests exercise the **shipped** code from an installed runtime, not retyped copies of
it. The browser bundle of `dsh-api-gateway` is evaluated in Node through the small shim
`test/loadreal.mjs`. A *runtime* argument is a directory that contains
`node_modules/@deepseek-ai`.

### Suite

```bash
test/suite.sh <patched-runtime> [<pristine-runtime>]    # must end with "SUITE PASS"
```

1. Regression: 4 cases that must behave exactly like the pristine code.
2. Adversarial: 3 cases, including a 25 s idle live tail that must not time out.
3. Healthy slow opens (1, 3, 6 and 7.5 s) must be delivered without a restart.
4. Listener isolation (D7): a static check that the projection handler is guarded.
5. H2: 100 non-lossless shapes × 4 seed sets through the real restore → expand path.
6. H2: 200 valid sessions restored through both trees must be identical (needs the
   pristine runtime; it defaults to `<patched-runtime>` without `-patched`).
7. Stress: 100 random fault scenarios, with HANG = 0 required.

### Individual scripts

| Script | What it does |
|---|---|
| `test/stress.mjs <rt> [runs] [budget-ms] [seed-offset]` | Random fault scenarios for D4: a stalled first item, a heartbeat kill, a `restart()` at a random moment, stalled replacement generations. Reports HANG, `slow(>10s)` and `worst`. |
| `test/repro-stranded-open.mjs <rt>` | Minimal D4 reproduction. On the pristine tree the pending `next()` is never settled. |
| `test/heal-at-generation.mjs <rt> [n] [wait-ms]` | D4: the server heals at generation n. |
| `test/blip-after-open.mjs <rt>` | D4: a disruption after the stream is already open. |
| `test/replay-seeds.mjs <rt>` | Re-runs single stress scenarios by seed. |
| `test/trace-generations.mjs <rt>` | Prints the generation timeline of a recovery. |
| `test/regress.mjs`, `test/adversarial.mjs`, `test/slowopen.mjs <rt> <ms>` | Suite sections 1 to 3. |
| `test/model-superseded-open.mjs`, `test/model-rethrow-before-state.mjs` | Stand-alone models of the D5 and D9 patterns. They do not need DSH. |
| `test/nopong.mjs <base-url> <log-with-token> [s]` | D3 against a running server; the log is the one that contains the `?token=` URL DSH prints. |
| `test/safari-jsc-check.sh <rt>` | D1 in JavaScriptCore. Needs `python3-gi` and `gir1.2-javascriptcoregtk-6.0`. |
| `test/webkit-e2e.mjs <port> <log-with-token> [label]` | D1 end to end in WebKit. Needs `playwright-core` and its WebKit build. `BROWSER=chromium` runs the V8 control. |
| `tools/scan-busy-flags.mjs <rt>` | Finds candidates of the D5/D12/D14 kind. It independently re-found those three. It has false positives, so read every hit. |
| `tools/scan-hot-listeners.mjs <rt>` | Finds unguarded listeners on hot events (the D7/D8 kind). |

About the stress budget: on the pristine tree a stranded open never settles, so a short
per-run budget (for example 1200 ms) is enough to count it. The suite gives the patched
tree 60 s per run. It records how long delivery took, as `slow(>10s)` and `worst`, so a
recovery that is slow cannot pass silently.

For `webkit-e2e.mjs`: Playwright's WebKit build runs headless on Linux but may need extra
system libraries. `playwright install` may garbage-collect browser builds in a shared
cache that it considers unused. If other tools depend on a specific build there, install
into a separate `PLAYWRIGHT_BROWSERS_PATH`.

### Results

Stress test, 300 scenarios in three seed ranges:

```
patched   seeds   1-100   runs=100 delivered=100 error=0 HANG=0 slow(>10s)=0 worst=7.6s
patched   seeds 101-200   runs=100 delivered=100 error=0 HANG=0 slow(>10s)=0 worst=7.6s
patched   seeds 201-300   runs=100 delivered=100 error=0 HANG=0 slow(>10s)=0 worst=7.6s
pristine  seeds   1-100   HANG=45/100
pristine  seeds 101-200   HANG=44/100
pristine  seeds 201-300   HANG=38/100
```

Targeted scenarios on the shipped gateway code:

| Scenario | pristine | patched |
|---|---|---|
| Server heals at generation 3 | hangs | history delivered (generation 3) |
| Server heals at generation 5 | hangs | history delivered (generation 5) |
| Disruption after the stream is open, 3 runs | 3/3 hang | 3/3 resume |
| Client never answers pings | closed after 4.0 s | still open after 20 s (with the setting) |

Regression and adversarial cases: all pass, with behaviour identical to the pristine code.

```
PASS  happy path: two items delivered
PASS  terminal error propagates
PASS  dispose() completes while awaiting opening item
PASS  carrier retry within budget still works
PASS  fast yield unaffected by deadline
PASS  dispose during pending deadline is clean
PASS  normal live tail keeps flowing (25 s idle, no spurious timeout)
```

Healthy slow opens were delivered in one generation, taking 1.0, 3.0, 6.0 and 7.5 s.

Non-lossless data on the restore path (H2): 400 cases. On the pristine tree the client
threw in 400 of 400. On the patched tree the client threw in 0, and 0 were rejected at
restore. For 200 valid sessions, the results were identical.

D1: see the JavaScriptCore output and the WebKit table in [D1](#d1-safariwebkit-the-lossless-json-validator-rejects-every-plain-object).

Smoke test on a real server with all patches applied: DSH starts, login returns 200, the
page title is `DeepSeek Harness`, and the WebSocket mux upgrade returns 101. The served
browser bundle (about 11 MB) contains the patched code: `opening item stalled` ×1,
`abandonSupersededOpen` ×3, `fork failed` ×2. These counts are for the built bundle, where
some patched modules are inlined more than once, so they can differ from the counts in
`patches/`. No new errors appear in the server log.

Raw outputs:

- `results/suite-patched.out` is the full suite on the final patch set. It was captured
  with an earlier revision of the scripts. That revision's section headings said "defect
  12 guard" (section 3) and "defect 14 guard" (section 4), and its section 6 printed its
  summary line in Japanese ("valid data is left unchanged"). The tests are the same.
  `0.1.6-alpha.1-fixtest` in that file is the name of the patched test tree.
- `results/stress-installer-vs-pristine.out` is the 100-scenario stress test on a tree
  built by `install.sh` and on the pristine tree, with the same seeds.

## 5. Limitations and open questions

- For the disconnect path (D3 to D6), a natural hang in a real browser could not be
  triggered on demand, because it depends on timing. What was shown: the shipped code
  hangs under the reproduced conditions, the patches resolve those conditions, and the
  heartbeat disconnect was observed in the field.
- It is not known whether the server can fail to send a first item for reasons other than
  a dropped connection. D4 makes the client retry in any case.
- The list is probably incomplete. Several of these defects were found only after the
  earlier fixes were believed to be complete.
- Tests against the shipped code cover D1 (JavaScriptCore and WebKit), D3 (`nopong.mjs`),
  D4 (stress and targeted scenarios), D7 (a static check), H1 (three real turns) and H2
  (the restore path). D2, D5, D6, D8 and D9 to D21 were found by reading the code and
  with the scanners. Apart from syntax checks, the smoke test and the stand-alone models
  of D5 and D9, they have no dedicated tests.
- Firefox: only the validator condition was checked, in headless Firefox 155. It returns
  `"function Object() {\n    [native code]\n}"`, so the exact-match check fails and the
  normalised check passes, as in Safari. The full DSH UI was not run in Firefox.
- `failEventStream()` in `dsh-api-session-controller/lib/client.js` also rethrows
  non-remote errors before publishing an error state. It runs after a session is already
  open, so it cannot cause "Loading history…", but it could leave an open view on a dead
  stream. It is not patched or tested.
- The patches were written against 0.1.6-alpha.1.

## License

MIT, see [LICENSE](LICENSE). The patches contain and modify DSH code
(MIT, Copyright (c) 2026 DeepSeek); see [NOTICE](NOTICE).

## 日本語の要約

DSH(`@deepseek-ai/dsh`)の Web UI で、セッションが「Loading history…」のまま履歴を表示しなくなる不具合について、原因の分析、パッチ、検証一式をまとめたものです。DeepSeek とは無関係の非公式プロジェクトです。

- **Safari / WebKit(原因を特定、D1)**: macOS の Safari と iPhone・iPad のブラウザでは、ターンの進行中にセッションを開くか再読み込みすると、正常なデータでも**必ず**固まります。可逆 JSON 検証器 `hasIntrinsicConstructor()` が `Function.prototype.toString.call(Object)` の結果を V8 の書式と完全一致で比べています。JavaScriptCore はこの文字列に改行を入れるため、全てのプレーンオブジェクトが拒否され、`TypeError: Assistant stream raw chunk must be a lossless JSON object` が出ます。修正は、空白を正規化してから比べる 1 行です。0.1.7-rc.2 でも未修正です。
- **全ブラウザ、特に外出先やスマホ(D3〜D6)**: サーバのハートビートは、pong が 2 回返らないクライアントを約 4〜6 秒で切断します。再接続の競合で、履歴の最初のフレームを待つ処理が取り残されます。設定 `websocketHeartbeatIntervalMs: 30000`(id は `typert-gateway`)と、パッチ(最初の 1 フレームだけに期限を付け、中断後は 2.5 秒から倍々で最大 20 秒)で対処します。
- **同じ形の欠陥(D7〜D21)**: 状態を確定させる前に return や throw するため、`loading` や `saving` が残る箇所が 11 か所あります。ほかに、例外を投げたリスナーが後続の配信リスナーを止めてしまう箇所がサーバ側に 2 か所あります。H1 と H2 は念のための防御で、今回の症状の原因ではありません。
- **適用**: `./install.sh --check` → `./install.sh`。元の版は書き換えず、コピーにパッチを当てて `current` を切り替えます。戻すときは `./install.sh --rollback`。
- **検証結果**: 100 通りのランダムな障害で、未パッチは 38〜45% が固着し、パッチ版は 300 シナリオで固着 0、最悪でも 7.6 秒でした。本物の WebKit では、未パッチが 4/4 固着し、パッチ版は 4/4 表示できました。
- **分かっていないこと**: 実ブラウザで自然発生の固着を狙って起こすことはできていません。一覧が網羅的だという保証もありません。Firefox では試していません。
