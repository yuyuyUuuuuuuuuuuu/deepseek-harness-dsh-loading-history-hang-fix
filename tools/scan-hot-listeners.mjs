// Hunt the D7/D8 class systematically: any listener on a HOT event path that can
// throw. cordis emit() has no isolation, so one throw starves every later
// listener on that event -- including the ones that stream to the browser.
// Heuristic (30-line window): confirm every hit by reading the code.
//   node scan-hot-listeners.mjs <runtime>   (<runtime> contains node_modules/@deepseek-ai)
import fs from "node:fs"; import path from "node:path";
const RT=process.argv[2] ?? process.env.DSH_RUNTIME;
if(!RT){ console.log("usage: node scan-hot-listeners.mjs <runtime>"); process.exit(2); }
const ROOT=path.join(RT,"node_modules","@deepseek-ai");
const HOT=["session/event","agent/assistant-stream","session/created","session/disposed"];
const hits=[];
for(const pkg of fs.readdirSync(ROOT)){
  for(const rel of ["lib/index.js","lib/client.js"]){
    const f=path.join(ROOT,pkg,rel); if(!fs.existsSync(f)) continue;
    if(/invariant/.test(rel)) continue;
    const L=fs.readFileSync(f,"utf8").split("\n");
    for(let i=0;i<L.length;i++){
      const ev=HOT.find(e=>L[i].includes(`"${e}"`));
      if(!ev || !/\.on\(/.test(L[i])) continue;
      // body = until the matching close, approximated by 30 lines
      const body=L.slice(i,i+30).join("\n");
      const guarded=/try\s*\{/.test(body);
      const canThrow=/\.parse\(|JSON\.parse|\bthrow\b|\.apply\(|assert|invariant/.test(body);
      if(canThrow && !guarded) hits.push({pkg,rel,ev,line:i+1});
    }
  }
}
console.log(`hot-path listeners that can throw, unguarded: ${hits.length}`);
for(const h of hits) console.log(`  ${h.pkg}/${h.rel}:${h.line}  [${h.ev}]`);
