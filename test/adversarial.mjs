import { loadGateway } from "./loadreal.mjs";
const RUNTIME=process.argv[2];
const {RemoteStream,RemoteStreamCarrierError}=loadGateway(RUNTIME);
const conn={generation:{getSnapshot:()=>({}),subscribe:()=>()=>{}}};
const R=[];
// settle-once guard so the timeout can never double-report
function test(name, ms, body){
  return new Promise(res=>{
    let done=false;
    const finish=(pass,info="")=>{ if(done)return; done=true; R.push([name,pass,info]); res(); };
    const timer=setTimeout(()=>finish(false,"timed out"),ms);
    timer.unref?.();
    try{ body(finish); }catch(e){ finish(false,"threw "+e.message); }
  });
}

await test("fast yield unaffected by deadline",4000,(finish)=>{
  let gens=0;
  const open=async function*(s){const m=++gens; await new Promise(r=>setTimeout(r,5)); yield {g:m}; await new Promise((r,j)=>s.addEventListener("abort",()=>j(s.reason),{once:true}));};
  const st=new RemoteStream(conn,{name:"f",open,ended:()=>new RemoteStreamCarrierError("e")});
  st[Symbol.asyncIterator]().next().then(v=>finish(v.value?.value?.g===1,"gen"+v.value?.value?.g),e=>finish(false,e.message));
});

await test("dispose during pending deadline is clean",5000,(finish)=>{
  const open=async function*(s){ await new Promise(r=>s.addEventListener("abort",()=>r(),{once:true})); if(s.aborted)throw s.reason; yield{}; };
  const st=new RemoteStream(conn,{name:"f",open,ended:()=>new RemoteStreamCarrierError("e")});
  const it=st[Symbol.asyncIterator]();
  it.next().catch(()=>{});
  setTimeout(()=>st.dispose().then(()=>finish(true),e=>finish(false,e.message)),50);
});

await test("normal live tail keeps flowing (no spurious timeout)",30000,(finish)=>{
  // Session open, then QUIET for 25s (longer than the 20s deadline) -- an idle
  // live tail must NOT be killed by the opening-item deadline.
  let gens=0, second=null;
  const open=async function*(s){const m=++gens; yield {g:m,t:"snap"}; await new Promise(r=>setTimeout(r,25000)); yield {g:m,t:"late-entry"}; await new Promise(()=>{});};
  const st=new RemoteStream(conn,{name:"f",open,ended:()=>new RemoteStreamCarrierError("e")});
  const it=st[Symbol.asyncIterator]();
  it.next().then(v=>{ v.value?.accept?.(); return it.next(); })
           .then(v=>finish(v.value?.value?.t==="late-entry" && gens===1, `gens=${gens} got=${v.value?.value?.t}`),
                 e=>finish(false,e.constructor.name+": "+e.message));
});

console.log(`--- ${RUNTIME.split("/").pop()} ---`);
let bad=0; for(const [n,p,i] of R){ if(!p)bad++; console.log(`  ${p?"PASS":"FAIL"}  ${n}${i?"  ("+i+")":""}`); }
process.exit(bad?1:0);
