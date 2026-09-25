// Model of D5 (the pattern, not the shipped code).
// The orphan window: doOpen() sets openState="loading". If the generation is
// superseded while open() is pending, the catch RETURNS SILENTLY without
// touching openState. The .finally() clears openPromise. Result:
//   openState === "loading"  AND  openPromise === null  AND nobody re-drives.
// A later open() call sees state!=="open" and promise===null, so it WOULD
// re-drive -- but only if something calls open() again. Does anything?
let openState="cold", openGeneration=0, openPromise=null, events;
async function doOpen(generation, plan){
  openState="loading";
  const ev={}; events=ev;
  try{
    await plan(ev,generation);
    if(generation!==openGeneration || events!==ev) return;   // silent
    openState="open";
  }catch(e){
    if(generation!==openGeneration || events!==ev) return;   // silent
    openState="error";
  }
}
function open(plan){
  if(openState==="open") return Promise.resolve();
  if(openPromise!==null) return openPromise;
  const p=doOpen(openGeneration,plan).finally(()=>{ if(openPromise===p) openPromise=null; });
  openPromise=p; return p;
}
// scenario: generation superseded mid-open (e.g. resync/dispose raced), then open() never rejects
await open(async(ev,gen)=>{ openGeneration++; await new Promise(r=>setTimeout(r,20)); });
await new Promise(r=>setTimeout(r,50));
console.log("  openState:",openState," openPromise:",openPromise);
console.log(openState==="loading" && openPromise===null
  ? "  BAD: ORPHANED -> 'Loading history...' forever, and nothing will re-drive it"
  : "  OK: "+openState);
