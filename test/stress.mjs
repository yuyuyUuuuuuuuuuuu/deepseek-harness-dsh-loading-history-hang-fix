import { loadGateway } from "./loadreal.mjs";
const RUNTIME=process.argv[2];
const RUNS=Number(process.argv[3]||100);
const TIMEOUT=Number(process.argv[4]||1200);   // per-run budget (ms)
const OFFSET=Number(process.argv[5]||0);       // seed offset (use 100, 200, ... for fresh scenarios)
const {RemoteStream,RemoteStreamCarrierError}=loadGateway(RUNTIME);

// Randomized adversary: each run picks a fault pattern the real deployment can
// produce -- stalled opening item, carrier death (heartbeat terminate), blips at
// random moments, replacement generations that also stall.
function rng(seed){ let s=seed>>>0; return ()=>((s=(s*1664525+1013904223)>>>0)/2**32); }

async function oneRun(seed){
  const r=rng(seed);
  const stallUntil = 1+Math.floor(r()*4);      // how many generations stall before healing
  const blipAt     = Math.floor(r()*60);       // ms until an external restart()
  const killSocket = r()<0.4;                  // simulate heartbeat terminate
  const connUp     = {v:{}};
  const conn={generation:{getSnapshot:()=>connUp.v,subscribe:()=>()=>{}}};
  let gens=0;
  const open=async function*(signal){
    const m=++gens;
    if(killSocket && m===1){ throw new RemoteStreamCarrierError("socket terminated by heartbeat"); }
    if(m<stallUntil){
      await new Promise(res=>{ if(signal.aborted)return res(); signal.addEventListener("abort",()=>res(),{once:true}); });
      if(signal.aborted) throw signal.reason;
    }
    yield {type:"snapshot",gen:m};
    await new Promise((res,rej)=>{ signal.addEventListener("abort",()=>rej(signal.reason),{once:true}); });
  };
  const st=new RemoteStream(conn,{name:"session.follow",open,ended:()=>new RemoteStreamCarrierError("ended")});
  const it=st[Symbol.asyncIterator]();
  let settled=false, how=null;
  const p=it.next().then(v=>{settled=true;how="delivered(gen"+v.value?.value?.gen+")"},
                        e=>{settled=true;how="error:"+e.constructor.name});
  const t=setTimeout(()=>st.restart(), blipAt); t.unref?.();
  const t0=Date.now();
  const res=await Promise.race([p.then(()=>"settled"), new Promise(r=>setTimeout(()=>r("HANG"),TIMEOUT))]);
  const ms=Date.now()-t0;
  try{ await st.dispose(); }catch{}
  return {seed, res, how, gens, stallUntil, blipAt, killSocket, ms};
}

let hang=0, delivered=0, errored=0, slow=0, worst=0; const hangs=[];
for(let i=1;i<=RUNS;i++){
  const o=await oneRun((i+OFFSET)*7919);
  if(o.res==="HANG"){ hang++; hangs.push(o); }
  else if(String(o.how).startsWith("delivered")){ delivered++; if(o.ms>worst)worst=o.ms; if(o.ms>10000)slow++; }
  else errored++;
  if(i%20===0) process.stdout.write(`    ...${i}/${RUNS}\n`);
}
console.log(`\n  RUNTIME: ${RUNTIME.split("/").pop()}`);
console.log(`  runs=${RUNS}  delivered=${delivered}  error=${errored}  HANG=${hang}  slow(>10s)=${slow}  worst=${(worst/1000).toFixed(1)}s`);
if(hangs.length){ console.log("  first hangs:"); for(const h of hangs.slice(0,5)) console.log("   ",JSON.stringify(h)); }
process.exit(hang?1:0);
