// D7 guard: a throwing session/event listener must NOT stop later
// listeners (follow() streams events to the browser from one of them).
// Verifies the projection plugin's handler swallows its own failures.
import fs from "node:fs";
const RT=process.argv[2];
const f=`${RT}/node_modules/@deepseek-ai/dsh-session-projection/lib/index.js`;
const src=fs.readFileSync(f,"utf8");
const i=src.indexOf('ctx.on("session/event"');
const m=i<0?null:[src.slice(i,i+900)];
if(!m){ console.log("  FAIL: could not locate the session/event handler"); process.exit(1); }
const body=m[0];
const guarded=/try\s*\{/.test(body) && /catch\s*\(/.test(body);
console.log(guarded
  ? "  PASS  projection session/event handler is exception-isolated"
  : "  FAIL  projection handler can throw -> starves every later session/event listener");
process.exit(guarded?0:1);
