import { loadGateway } from "./loadreal.mjs";
const RUNTIME=process.argv[2];
const g=loadGateway(RUNTIME);
const {RemoteStream,RemoteStreamCarrierError,RemoteJournalStream}=g;
const conn={generation:{getSnapshot:()=>({}),subscribe:()=>()=>{}}};
const results=[];
const check=(n,pass,info="")=>{results.push([n,pass,info]);};

// 1. Happy path: first generation yields immediately, live tail continues.
await new Promise(res=>{
  let gens=0;
  const open=async function*(s){gens++; yield {a:1}; yield {a:2}; await new Promise(()=>{});};
  const st=new RemoteStream(conn,{name:"s",open,ended:()=>new RemoteStreamCarrierError("e")});
  const it=st[Symbol.asyncIterator]();
  (async()=>{
    const a=await it.next(), b=await it.next();
    check("happy path: two items delivered", a.value?.value?.a===1 && b.value?.value?.a===2, `got ${a.value?.value?.a},${b.value?.value?.a}`);
    res();
  })();
  setTimeout(()=>{check("happy path: two items delivered",false,"timed out");res();},1500);
});

// 2. Terminal (non-carrier) errors must still propagate, not be swallowed/retried forever.
await new Promise(res=>{
  let gens=0;
  const open=async function*(s){gens++; throw new TypeError("bad protocol");};
  const st=new RemoteStream(conn,{name:"s",open,ended:()=>new RemoteStreamCarrierError("e")});
  const it=st[Symbol.asyncIterator]();
  it.next().then(()=>{check("terminal error propagates",false,"resolved instead");res()},
                e=>{check("terminal error propagates",/bad protocol/.test(e.message),e.message);res()});
  setTimeout(()=>{check("terminal error propagates",false,"hung");res();},1500);
});

// 3. dispose() must stop cleanly even while awaiting an opening item.
await new Promise(res=>{
  const open=async function*(s){ await new Promise(r=>s.addEventListener("abort",()=>r(),{once:true})); if(s.aborted)throw s.reason; yield{};};
  const st=new RemoteStream(conn,{name:"s",open,ended:()=>new RemoteStreamCarrierError("e")});
  const it=st[Symbol.asyncIterator]();
  let done=false;
  it.next().then(()=>{done=true},()=>{done=true});
  st.dispose().then(()=>{ check("dispose() completes while awaiting opening item", true, ""); res(); },
                    e=>{ check("dispose() completes while awaiting opening item", false, e.message); res(); });
  setTimeout(()=>{ if(!done) check("dispose() completes while awaiting opening item", false, "dispose hung"); res(); },2000);
});

// 4. Carrier failure then healthy: normal retry still works within budget.
await new Promise(res=>{
  let gens=0;
  const open=async function*(s){const m=++gens; if(m===1) throw new RemoteStreamCarrierError("blip"); yield {ok:m}; await new Promise(()=>{});};
  const st=new RemoteStream(conn,{name:"s",open,ended:()=>new RemoteStreamCarrierError("e")});
  const it=st[Symbol.asyncIterator]();
  it.next().then(v=>{check("carrier retry within budget still works", v.value?.value?.ok===2, "gen"+v.value?.value?.ok);res()},
                e=>{check("carrier retry within budget still works",false,e.message);res()});
  setTimeout(()=>{check("carrier retry within budget still works",false,"hung");res();},2000);
});

console.log(`--- ${RUNTIME.split("/").pop()} ---`);
let bad=0;
for(const [n,p,i] of results){ if(!p)bad++; console.log(`  ${p?"PASS":"FAIL"}  ${n}${i?"  ("+i+")":""}`); }
process.exit(bad?1:0);
