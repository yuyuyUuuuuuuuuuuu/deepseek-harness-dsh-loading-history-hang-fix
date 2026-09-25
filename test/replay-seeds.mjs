// Re-run individual stress.mjs scenarios by seed (the seeds below are scenarios that
// hung on the pristine tree). Each run is given 90 s.
//   node replay-seeds.mjs <runtime>
import { loadGateway } from "./loadreal.mjs";
const {RemoteStream,RemoteStreamCarrierError}=loadGateway(process.argv[2]);
function rng(seed){ let s=seed>>>0; return ()=>((s=(s*1664525+1013904223)>>>0)/2**32); }
const seeds=[63352,71271,79190,182137,190056];
for(const seed of seeds){
  const r=rng(seed);
  const stallUntil=1+Math.floor(r()*4), blipAt=Math.floor(r()*60), killSocket=r()<0.4;
  const conn={generation:{getSnapshot:()=>({}),subscribe:()=>()=>{}}};
  let gens=0;
  const open=async function*(s){
    const m=++gens;
    if(killSocket&&m===1) throw new RemoteStreamCarrierError("heartbeat kill");
    if(m<stallUntil){ await new Promise(res=>{ if(s.aborted)return res(); s.addEventListener("abort",()=>res(),{once:true}); }); if(s.aborted) throw s.reason; }
    yield {type:"snapshot",gen:m};
    await new Promise((res,rej)=>s.addEventListener("abort",()=>rej(s.reason),{once:true}));
  };
  const st=new RemoteStream(conn,{name:"f",open,ended:()=>new RemoteStreamCarrierError("ended")});
  const it=st[Symbol.asyncIterator]();
  const t0=Date.now();
  const bt=setTimeout(()=>st.restart(), blipAt); bt.unref?.();
  const out=await Promise.race([
    it.next().then(v=>"delivered gen"+v.value?.value?.gen, e=>"rejected "+e.constructor.name),
    new Promise(r=>setTimeout(()=>r("HANG"),90000))
  ]);
  console.log(`  seed=${seed} stallUntil=${stallUntil} -> ${out}  (${((Date.now()-t0)/1000).toFixed(1)}s, gens=${gens})`);
  try{ await st.dispose(); }catch{}
}
