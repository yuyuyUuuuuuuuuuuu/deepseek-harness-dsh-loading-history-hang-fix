import { loadGateway } from "./loadreal.mjs";
const RUNTIME=process.argv[2], DELAY=Number(process.argv[3]||6000);
const {RemoteStream,RemoteStreamCarrierError}=loadGateway(RUNTIME);
const conn={generation:{getSnapshot:()=>({}),subscribe:()=>()=>{}}};
// A genuinely slow but HEALTHY cold open (big session, busy server).
// It must still be delivered on the first generation -- the opening-item
// deadline must not restart it.
let gens=0;
const open=async function*(s){
  const m=++gens;
  await new Promise(r=>setTimeout(r,DELAY));
  if(s.aborted) throw s.reason;
  yield {type:"snapshot",gen:m};
  await new Promise((r,j)=>s.addEventListener("abort",()=>j(s.reason),{once:true}));
};
const st=new RemoteStream(conn,{name:"f",open,ended:()=>new RemoteStreamCarrierError("ended")});
const it=st[Symbol.asyncIterator]();
const t0=Date.now();
const out=await Promise.race([
  it.next().then(v=>"delivered gen"+v.value?.value?.gen,e=>"rejected "+e.constructor.name),
  new Promise(r=>setTimeout(()=>r("HANG"),60000))
]);
console.log(`  slow open ${DELAY}ms -> ${out}  (${((Date.now()-t0)/1000).toFixed(1)}s, gens=${gens})`);
process.exit(String(out).startsWith("delivered")?0:9);
