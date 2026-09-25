// 100 DISTINCT poison shapes through the REAL restore->client path.
// unpatched must FAIL most of them; patched must survive ALL.
const RT=process.argv[2], N=Number(process.argv[3]||100), OFF=Number(process.argv[4]||0);
const S=await import(`${RT}/node_modules/@deepseek-ai/dsh-session/lib/index.js`);
const V=await import(`${RT}/node_modules/@deepseek-ai/dsh-util-values/lib/index.js`);
const L=await import(`${RT}/node_modules/@deepseek-ai/dsh-llm/lib/types/assistant-stream.js`);

function rng(seed){ let s=seed>>>0; return ()=>((s=(s*1664525+1013904223)>>>0)/2**32); }

// generators for values that are NOT losslessly JSON-serializable
const poisonValues=[
  ()=>undefined, ()=>NaN, ()=>Infinity, ()=>-Infinity, ()=>1n,
  ()=>new Date(), ()=>()=>{}, ()=>Symbol('s'), ()=>new Map([[1,2]]),
  ()=>new Set([1]), ()=>/re/g, ()=>new Error('x'),
  ()=>{ const a=[1]; a[3]=2; return a; },              // sparse array (hole)
  ()=>[undefined],                                      // undefined in array
  ()=>({toJSON(){ throw new Error('boom'); }}),         // throwing toJSON
  ()=>{ const o={}; o.self=o; return o; },              // cycle
];
const chunkTypes=['usage','finish','block-start','block-end'];

function makePoison(r){
  const kind=poisonValues[Math.floor(r()*poisonValues.length)];
  const ctype=chunkTypes[Math.floor(r()*chunkTypes.length)];
  const depth=Math.floor(r()*3);
  let payload=kind();
  for(let i=0;i<depth;i++) payload = (r()<0.5) ? {nested:payload} : [payload];
  const chunk={type:ctype};
  const slot=['usage','reason','block','replayState','detail'][Math.floor(r()*5)];
  chunk[slot]=payload;
  return {type:'chunk', time:Date.now(), chunk};
}

const header={id:'session-test',cwd:'/tmp',version:3,isSeeded:false,createdAt:Date.now(),
              title:null,model:null,provider:null,api:null};
let survived=0, clientThrew=0, restoreThrew=0, notPoison=0; const restoreMsgs=[];
const failures=[];
for(let i=1;i<=N;i++){
  const r=rng((i+OFF)*2654435761);
  const poison=makePoison(r);
  // only count cases that are genuinely poison
  let reallyPoison;
  try{ reallyPoison = !V.isJsonValue(poison); }catch{ reallyPoison=true; }
  if(!reallyPoison){ notPoison++; continue; }
  const seed=[{seq:0,type:'permission/preset',time:Date.now(),data:{preset:'workspace-write'}},
              {seq:1,type:'assistant/attempt',time:Date.now(),data:{attemptId:'a1',turn:1,step:1,stream:[poison]}}];
  let sess=null;
  try{ sess=S.Session.fromRestore('session-test',seed,header,0,'restore'); }
  catch(e){ restoreThrew++; restoreMsgs.push(e.message.slice(0,70)); continue; }
  let stream;
  try{ stream=sess.snapshotEvents(0)[1].data.stream; }catch(e){ failures.push({i,where:'snapshot',msg:e.message.slice(0,50)}); continue; }
  try{ L.expandAssistantStream(stream); survived++; }
  catch(e){ clientThrew++; failures.push({i,where:'client',msg:e.message.slice(0,60)}); }
}
const tested=N-notPoison;
console.log(`  ${RT.split('/').pop().padEnd(26)} poisonCases=${tested}  clientOK=${survived}  clientTHREW=${clientThrew}  rejectedAtRestore=${restoreThrew}`);
if(failures.length) for(const f of failures.slice(0,3)) console.log(`     #${f.i} ${f.where}: ${f.msg}`);
const uniq={}; for(const m of restoreMsgs) uniq[m]=(uniq[m]||0)+1;
for(const [m,c] of Object.entries(uniq)) console.log(`     rejected x${c}: ${m}`);
process.exit(clientThrew===0?0:1);
