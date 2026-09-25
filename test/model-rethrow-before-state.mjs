// Model of D9 (the pattern, not the shipped code): refreshList()'s catch rethrows non-remote errors BEFORE
// setting listState="error". finally clears listInflight but NOT listState.
// Result: listState stays "loading" and refreshList() can be re-entered, but the
// sidebar renders a permanent loading state until something else sets it.
let listState="idle", listInflight=null, listError=null;
function refreshList(failWith){
  if(listInflight!==null) return listInflight;
  listState="loading"; listError=null;
  listInflight=(async()=>{
    try{
      throw failWith;
    }catch(e){
      if(!(e&&e.isRemote)) throw e;         // <-- rethrow, skipping listState="error"
      listState="error"; listError=e;
    }finally{
      listInflight=null;
    }
  })();
  return listInflight;
}
// a non-remote error (a bug, a TypeError in the response handler, etc.)
try{ await refreshList(new TypeError("unexpected shape")); }catch(e){ console.log("  threw:",e.message); }
console.log("  listState =",listState," listInflight =",listInflight);
console.log(listState==="loading" ? "  BAD: sidebar stuck in 'loading' (D9 pattern confirmed)" : "  OK");
