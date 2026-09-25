import fs from "node:fs";
import vm from "node:vm";
export function loadGateway(runtimeDir){
  const file = `${runtimeDir}/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js`;
  const src = fs.readFileSync(file, "utf8");
  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (mod) => { captured = mod; } } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask, AbortController, AbortSignal, Promise, console,
    Error, TypeError, Object, Symbol, Array, Reflect, JSON, Number, String, Boolean, Math, Date, Map, Set, WeakMap, WeakSet,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  if (!captured) throw new Error("module did not register");
  // minimal require: the bundle only needs @deepseek-ai/cordis at load time
  const require = (id) => {
    if (id === "@deepseek-ai/cordis") return { Service: class Service { constructor(){} } };
    throw new Error("unexpected require: " + id);
  };
  return captured.factory(require);
}
