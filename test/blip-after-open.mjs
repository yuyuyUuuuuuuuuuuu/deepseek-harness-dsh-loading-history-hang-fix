// D4: the first item is delivered and accepted, then the generation is replaced
// (restart()) and the replacement stalls once. The live tail must resume.
//   node blip-after-open.mjs <runtime> [wait-ms=45000]
import { loadGateway } from "./loadreal.mjs";
const RUNTIME=process.argv[2];
const {RemoteStream,RemoteStreamCarrierError}=loadGateway(RUNTIME);
const conn={generation:{getSnapshot:()=>({}),subscribe:()=>()=>{}}};
let gens=0;
const open=async function*(s){
  const m=++gens;
  if(m===2){ await new Promise(r=>{ if(s.aborted)return r(); s.addEventListener("abort",()=>r(),{once:true}); }); if(s.aborted) throw s.reason; }
  yield {type:"snapshot",gen:m};
  // REAL follow(): the live-tail loop is abort-aware, so a restart ends it.
  await new Promise((r,rej)=>{ s.addEventListener("abort",()=>rej(s.reason),{once:true}); });
};
const st=new RemoteStream(conn,{name:"f",open,ended:()=>new RemoteStreamCarrierError("ended")});
const it=st[Symbol.asyncIterator]();
const first=await it.next(); first.value?.accept?.();
let out=null;
it.next().then(v=>out="RESUMED gen "+v.value?.value?.gen,e=>out="REJECTED "+e.constructor.name+": "+e.message);
await new Promise(r=>setTimeout(r,50));
st.restart();
setTimeout(()=>{
  console.log(`  ${RUNTIME.split("/").pop().padEnd(26)} gens=${gens} => ${out??"(pending)"}`);
  process.exit(String(out).startsWith("RESUMED")?0:9);
},Number(process.argv[3]||45000));
