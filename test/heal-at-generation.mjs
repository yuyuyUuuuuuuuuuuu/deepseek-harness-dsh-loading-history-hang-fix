// D4: every generation stalls before its first item until generation <heal-at>, which
// is healthy. Pristine: still hanging. Patched: history delivered from generation <heal-at>.
//   node heal-at-generation.mjs <runtime> [heal-at=3] [wait-ms=2500]
// On the patched tree allow for the recovery backoff (2.5 s, 5 s, 10 s, 20 s cap):
// generation 3 arrives after ~2.5 s and generation 5 after ~17.5 s, so use e.g.
// wait-ms=5000 for heal-at=3 and wait-ms=30000 for heal-at=5.
import { loadGateway } from "./loadreal.mjs";
const RUNTIME=process.argv[2], HEAL_AT=Number(process.argv[3]||3), WAIT=Number(process.argv[4]||2500);
const g=loadGateway(RUNTIME);
const {RemoteStream,RemoteStreamCarrierError}=g;
const connection={generation:{getSnapshot:()=>({}),subscribe:()=>()=>{}}};
// Server stalls before the first yield on every generation until HEAL_AT,
// then becomes healthy. This is the STRANDING condition.
let gens=0;
const open=async function*(signal){
  const mine=++gens;
  if(mine<HEAL_AT){
    await new Promise(r=>{ if(signal.aborted)return r(); signal.addEventListener("abort",()=>r(),{once:true}); });
    if(signal.aborted) throw signal.reason;
  }
  yield {type:"snapshot",gen:mine};
  await new Promise(()=>{});
};
const stream=new RemoteStream(connection,{name:"session.follow",open,ended:()=>new RemoteStreamCarrierError("ended")});
const it=stream[Symbol.asyncIterator]();
let settled=false,out=null;
it.next().then(v=>{settled=true;out="HISTORY DELIVERED (gen "+v.value?.value?.gen+")"},e=>{settled=true;out="ERROR "+e.constructor.name+": "+e.message});
setTimeout(()=>stream.restart(),40);
setTimeout(()=>{
  console.log(`  ${RUNTIME.split("/").pop().padEnd(26)} gens=${gens} => ${out??"STILL HANGING (Loading history...)"}`);
  process.exit(String(out).startsWith("HISTORY")?0:9);
},WAIT);
