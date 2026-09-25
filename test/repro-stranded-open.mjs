// Minimal reproduction of D4 on the shipped RemoteStream class: EVERY generation
// stalls before its first item, and the generation is replaced (restart()) while the
// consumer awaits the opening item. On the pristine tree the pending next() is never
// settled (prints STRANDED). The patched tree never settles here either, by design:
// the fake server never recovers, so the stream keeps re-opening with backoff
// (at most one re-open every 20 s). Use heal-at-generation.mjs to see recovery.
//   node repro-stranded-open.mjs <runtime> [wait-ms=3000]
import { loadGateway } from "./loadreal.mjs";

const RUNTIME = process.argv[2];
const TIMEOUT_MS = Number(process.argv[3] || 3000);   // how long we wait for open() to settle
const g = loadGateway(RUNTIME);
const { RemoteStream, RemoteStreamCarrierError } = g;

// A fake connection: the real RemoteStream calls connection.generation.getSnapshot()
// during retry pacing. Returning a live generation makes retries immediate.
const connection = { generation: { getSnapshot: () => ({}), subscribe: () => () => {} } };

// Server generator that reproduces the stranding condition:
// EVERY generation blocks before its first yield (until aborted), so a
// replacement generation cannot rescue a consumer awaiting the opening item.
let generations = 0;
const open = async function* (signal) {
  generations++;
  await new Promise((r) => {
    if (signal.aborted) return r();
    signal.addEventListener("abort", () => r(), { once: true });
  });
  return;                       // aborted -> yields nothing, like the real follow()
};

const stream = new RemoteStream(connection, {
  name: "session.follow",
  open,
  ended: () => new RemoteStreamCarrierError("ended without a terminal result"),
});

const it = stream[Symbol.asyncIterator]();
let settled = false, outcome = null;
it.next().then(
  (v) => { settled = true; outcome = "resolved:" + JSON.stringify(v.value ?? null); },
  (e) => { settled = true; outcome = "rejected:" + e.constructor.name + ":" + e.message; }
);

// The blip: replace the generation while the consumer awaits the opening item.
setTimeout(() => stream.restart(), 40);

setTimeout(() => {
  console.log(`runtime      : ${RUNTIME.split("/").pop()}`);
  console.log(`generations  : ${generations}`);
  console.log(`open settled : ${settled}`);
  console.log(`outcome      : ${outcome ?? "(still pending)"}`);
  console.log(settled ? "RESULT: RECOVERS (no permanent hang)" : "RESULT: STRANDED (hangs forever => 'Loading history...')");
  process.exit(settled ? 0 : 9);
}, TIMEOUT_MS);
