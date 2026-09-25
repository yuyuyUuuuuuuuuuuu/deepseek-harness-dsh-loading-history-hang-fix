// The sanitizer must NOT alter valid sessions. Restore 200 CLEAN events through
// both builds and require byte-identical results.
//   node poison-nondestructive.mjs <pristine-runtime> <patched-runtime>
const [PRISTINE, PATCHED]=process.argv.slice(2);
if(!PRISTINE||!PATCHED){ console.log("usage: node poison-nondestructive.mjs <pristine-runtime> <patched-runtime>"); process.exit(2); }
const S1=await import(`${PRISTINE}/node_modules/@deepseek-ai/dsh-session/lib/index.js`);
const S2=await import(`${PATCHED}/node_modules/@deepseek-ai/dsh-session/lib/index.js`);
const header={id:'session-test',cwd:'/tmp',version:3,isSeeded:false,createdAt:Date.now(),
              title:null,model:null,provider:null,api:null};
function rng(s){let x=s>>>0;return()=>((x=(x*1664525+1013904223)>>>0)/2**32);}
let diffs=0, n=0;
for(let i=1;i<=200;i++){
  const r=rng(i*7919);
  const stream=[
    {type:'chunk',time:1,chunk:{type:'block-start',index:0,blockType:'reasoning'}},
    {type:'reasoning-chunks',time0:2,index:0,dt:[1,1],texts:['a','b','c']},
    {type:'chunk',time:5,chunk:{type:'usage',usage:{inputTokens:Math.floor(r()*5000),outputTokens:Math.floor(r()*500),totalTokens:Math.floor(r()*6000),cacheReadTokens:Math.floor(r()*4000)}}},
    {type:'chunk',time:6,chunk:{type:'finish',reason:{kind:'stop'},replayState:{response:{kind:'pi-ai',version:2,api:'openai-responses',provider:'example-provider',model:'example-model',stopReason:'stop'},blocks:[{type:'text'}]}}},
  ];
  const seed=[{seq:0,type:'permission/preset',time:1,data:{preset:'workspace-write'}},
              {seq:1,type:'assistant/attempt',time:2,data:{attemptId:'a1',turn:1,step:1,stream}}];
  const a=S1.Session.fromRestore('session-test',seed,header,0,'restore').snapshotEvents(0);
  const b=S2.Session.fromRestore('session-test',seed,header,0,'restore').snapshotEvents(0);
  n++;
  const strip=(evs)=>JSON.stringify(evs.filter(e=>e.type!=='session/end-seed'));
  const sa=strip(a), sb=strip(b);
  if(sa!==sb){ diffs++; if(diffs<=1){
    console.log('  DIFF at',i);
    // locate the first differing position
    let k=0; while(k<sa.length&&k<sb.length&&sa[k]===sb[k]) k++;
    console.log('   unpatched:', sa.slice(Math.max(0,k-70), k+70));
    console.log('   patched  :', sb.slice(Math.max(0,k-70), k+70));
  }}
}
console.log(`  clean sessions compared: ${n}  differences: ${diffs}`);
console.log(diffs===0 ? "  => valid data is left unchanged" : "  => VALID DATA WAS ALTERED");
process.exit(diffs?1:0);
