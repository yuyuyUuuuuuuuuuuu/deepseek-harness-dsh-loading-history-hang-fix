import { loadGateway } from "./loadreal.mjs";
// Print the generation timeline: generations 1-3 stall before their first item,
// generation 4 is healthy.   node trace-generations.mjs <runtime>
const RUNTIME=process.argv[2];
if(!RUNTIME){ console.log("usage: node trace-generations.mjs <runtime>"); process.exit(2); }
const {RemoteStream,RemoteStreamCarrierError}=loadGateway(RUNTIME);
const conn={generation:{getSnapshot:()=>({}),subscribe:()=>()=>{}}};
const t0=Date.now(); const T=()=>((Date.now()-t0)/1000).toFixed(1)+"s";
let gens=0;
const open=async function*(s){
  const m=++gens; console.log(`  [${T()}] gen ${m} start`);
  if(m<4){ await new Promise(r=>{ if(s.aborted)return r(); s.addEventListener("abort",()=>r(),{once:true}); });
           console.log(`  [${T()}] gen ${m} aborted`); if(s.aborted) throw s.reason; }
  console.log(`  [${T()}] gen ${m} yields`); yield {gen:m};
  await new Promise((r,j)=>s.addEventListener("abort",()=>j(s.reason),{once:true}));
};
const st=new RemoteStream(conn,{name:"f",open,ended:()=>new RemoteStreamCarrierError("ended")});
const it=st[Symbol.asyncIterator]();
it.next().then(v=>console.log(`  [${T()}] DELIVERED gen${v.value?.value?.gen}`),e=>console.log(`  [${T()}] rejected`));
setTimeout(()=>{ console.log(`  [${T()}] blip -> restart()`); st.restart(); },30);
setTimeout(()=>process.exit(0),45000);
