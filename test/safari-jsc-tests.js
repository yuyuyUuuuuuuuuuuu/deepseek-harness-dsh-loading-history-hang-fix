var out=[];
out.push("toString(Object)     = "+JSON.stringify(Function.prototype.toString.call(Object)));
out.push("hasIntrinsicConstructor(Object.prototype,'Object') = "+hasIntrinsicConstructor(Object.prototype,"Object"));
out.push("snapshotJsonValue({a:1}) = "+String(snapshotJsonValue({a:1})));
try{ expandAssistantStream([{type:"text-chunks",time0:1,index:0,dt:[],texts:["hi"]}]); out.push("text-chunks record  : OK"); }catch(e){ out.push("text-chunks record  : THROWS "+e.message); }
try{ expandAssistantStream([{type:"chunk",time:1,chunk:{type:"usage",usage:{inputTokens:7328,totalTokens:7333}}}]); out.push("chunk record (usage): OK"); }catch(e){ out.push("chunk record (usage): THROWS "+e.message+"  | cause: "+(e.cause&&e.cause.message)); }
try{ var v=snapshotJsonValue([1,{a:[2,{b:"c"}]}]); out.push("array+nested snapshot: "+JSON.stringify(v)); }catch(e){ out.push("array snapshot THROWS "+e.message); }
out.join("\n");
