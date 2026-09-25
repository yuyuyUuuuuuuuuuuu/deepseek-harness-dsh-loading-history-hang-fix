// End to end in a real WebKit browser: start a long turn in tab A, open the same
// session in tab B while the turn is running, and record whether tab B gets stuck on
// "Loading history…" and whether a TypeError is thrown.
//   node webkit-e2e.mjs <port> <logfile-with-token> [label]
// Expected: pristine 0.1.6-alpha.1 -> TypeError + STUCK; patched -> HISTORY LOADS.
// Requires playwright-core (npm install playwright-core) and its WebKit build.
//   BROWSER=chromium   run the same flow in Chromium (V8) as a control
//   CHROMIUM_PATH=...  use a specific Chromium executable for the control
//   DSH_WORKSPACE=...  workspace to pick if DSH shows "Choose workspace"
// The DSH server must be listening on 127.0.0.1:<port>; <logfile> must contain the
// "?token=..." URL DSH prints at startup.
import fs from "node:fs";
import { webkit, chromium } from "playwright-core";
process.env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
const [port, logfile, label = `port ${port}`] = process.argv.slice(2);
const token = (fs.readFileSync(logfile, "utf8").match(/token=([A-Za-z0-9_-]+)/g) || []).pop()?.split("=")[1];
if (!token) { console.log("token not found in", logfile); process.exit(2); }
const base = `http://127.0.0.1:${port}`;
// BROWSER=chromium runs the same flow on V8 (engine-dependence control)
const b = process.env.BROWSER === "chromium"
  ? await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] })
  : await webkit.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1100, height: 820 } });
const errs = [];
const hook = (p, tag) => p.on("pageerror", (e) => errs.push(`${tag}: ${String(e.message || e).slice(0, 120)}`));

// ---- page A: start a long turn ----
const A = await ctx.newPage(); hook(A, "A");
await A.goto(`${base}/?token=${token}`, { waitUntil: "networkidle", timeout: 60000 });
await A.waitForTimeout(2500);
for (const n of ["Got it", "OK", "Continue", "Dismiss", "Close"]) { const x = A.getByRole("button", { name: n }); if (await x.count().catch(() => 0)) { await x.first().click().catch(() => {}); await A.waitForTimeout(500); break; } }
await A.keyboard.press("Escape").catch(() => {});
const wb = A.getByRole("button", { name: "Choose workspace" });
if (process.env.DSH_WORKSPACE && await wb.count()) { await wb.click(); await A.waitForTimeout(900); await A.locator(`text=${process.env.DSH_WORKSPACE}`).first().click().catch(() => {}); await A.waitForTimeout(2000); }
await A.evaluate(() => { const e = document.querySelector("[data-composer-input]"); e.focus(); });
await A.keyboard.type("Count from 1 to 400, one number per line, slowly, without skipping any. No explanation.");
await A.keyboard.press("Enter");
// wait until the assistant has started answering (a block has begun => a `chunk` record exists)
let started = false;
for (let i = 0; i < 30; i++) { await A.waitForTimeout(1000); started = await A.evaluate(() => !!document.querySelector('[data-chat-flow-kind="assistant-step"]')); if (started) break; }
const sessionUrl = A.url();
console.log(`[${label}] turn started=${started}  url=${sessionUrl.replace(/token=[^&]+/, "token=***")}`);
await A.waitForTimeout(3000);

// ---- page B: open the same session while the turn is live ----
const B = await ctx.newPage(); hook(B, "B");
const t0 = Date.now();
await B.goto(sessionUrl, { waitUntil: "load", timeout: 60000 });
let loadingSeen = false, historyShown = false, when = -1;
for (let i = 0; i < 25; i++) {
  await B.waitForTimeout(1000);
  const s = await B.evaluate(() => ({
    loading: /Loading history/i.test(document.body.innerText || ""),
    msgs: document.querySelectorAll('[data-chat-flow-kind]').length,
  }));
  if (s.loading) loadingSeen = true;
  if (s.msgs > 0) { historyShown = true; when = Date.now() - t0; break; }
}
const stillLoading = await B.evaluate(() => /Loading history/i.test(document.body.innerText || ""));
console.log(`[${label}] B: loadingSeen=${loadingSeen}  historyShown=${historyShown}${historyShown ? ` (${when}ms)` : ""}  stillLoading@25s=${stillLoading}`);
console.log(`[${label}] pageerrors=${errs.length}` + (errs.length ? "\n    " + [...new Set(errs)].join("\n    ") : ""));
await b.close();
console.log(`[${label}] RESULT: ${historyShown && !stillLoading ? "HISTORY LOADS" : "STUCK"}`);
