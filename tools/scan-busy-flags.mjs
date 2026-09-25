// Heuristic scanner for the "state set, then return before it is settled" pattern
// (it independently re-found D5, D12 and D14): a "return" after an await that sits
// between a busy-flag SET and its RESET, even when a finally exists elsewhere in
// the function. It does not look for the rethrow variant (D9-D11, D13, D15-D18).
// Line-based and approximate: expect false positives, confirm every hit by reading the code.
//   node scan-busy-flags.mjs <runtime>      (<runtime> contains node_modules/@deepseek-ai)
import fs from "node:fs"; import path from "node:path";
const RT=process.argv[2] ?? process.env.DSH_RUNTIME;
if(!RT){ console.log("usage: node scan-busy-flags.mjs <runtime>"); process.exit(2); }
const ROOT=path.join(RT,"node_modules","@deepseek-ai");
const hits=[];
for(const pkg of fs.readdirSync(ROOT)){
  const f=path.join(ROOT,pkg,"lib","client.js");
  if(!fs.existsSync(f)) continue;
  const L=fs.readFileSync(f,"utf8").split("\n");
  for(let i=0;i<L.length;i++){
    const m=L[i].match(/this\.(\w+)\s*=\s*(true|"loading"|"saving"|"pending")\s*;/);
    if(!m) continue;
    const flag=m[1];
    if(!/saving|busy|loading|Status|State|Inflight|pending/i.test(flag)) continue;
    // scan forward to the reset of the same flag
    let resetAt=-1, retBetween=[], awaited=false, finallyAt=-1;
    for(let j=i+1;j<Math.min(i+120,L.length);j++){
      if(/\bawait\b/.test(L[j])) awaited=true;
      if(/\}\s*finally\s*\{/.test(L[j])) finallyAt=j;
      const r=new RegExp(`this\\.${flag}\\s*=\\s*(false|"(idle|ready|error|open|cold)")`);
      if(r.test(L[j])){ resetAt=j; break; }
      if(/^\s*(if\s*\([^)]*\)\s*)?return[; ]/.test(L[j]) && awaited) retBetween.push(j+1);
    }
    if(awaited && retBetween.length && (finallyAt===-1 || finallyAt>resetAt)){
      hits.push({pkg,set:i+1,flag,returns:retBetween.slice(0,3),reset:resetAt+1});
    }
  }
}
console.log(`suspicious: ${hits.length}`);
for(const h of hits) console.log(`  ${h.pkg}  flag=${h.flag} set@${h.set} return@${h.returns.join(",")} reset@${h.reset}`);
