// Raw socket that completes the WS handshake but NEVER sends a pong.
// This is a suspended phone tab / stalled link. Records who closes the socket and when.
//   node nopong.mjs <base-url> <logfile-with-token> [seconds=20]
//   e.g. node nopong.mjs http://127.0.0.1:3000 ./dsh.log
// <base-url> may be http:// (direct) or https:// (e.g. through the reverse proxy / remote
// access path your browser actually uses). The token is taken from the last "token=..."
// in <logfile> (the URL DSH prints at startup), or from $DSH_TOKEN.
// Default heartbeat: closed after ~4-6 s. With websocketHeartbeatIntervalMs: 30000 the
// socket should still be open after 20 s.
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import fs from "node:fs";
const [baseUrl, logfile, seconds = "20"] = process.argv.slice(2);
const token = process.env.DSH_TOKEN
  || (logfile ? (fs.readFileSync(logfile,"utf8").match(/token=([A-Za-z0-9_-]+)/g)||[]).pop()?.split("=")[1] : undefined);
if(!baseUrl || !token){ console.log("usage: node nopong.mjs <base-url> <logfile-with-token> [seconds]  (or set DSH_TOKEN)"); process.exit(2); }
const u=new URL(baseUrl);
const secure=u.protocol==="https:";
const port=Number(u.port || (secure ? 443 : 80));
const r=await fetch(`${u.origin}/?token=${token}`,{redirect:"manual"});
const cookie=(r.headers.getSetCookie?.()||[]).map(c=>c.split(";")[0]).join("; ");
console.log(`  auth: ${r.status}, cookie=${cookie?"yes":"no"}`);
const key=crypto.randomBytes(16).toString("base64");
const onConnect=()=>{
  sock.write(
    `GET /api/remote.mux HTTP/1.1\r\nHost: ${u.host}\r\n`+
    "Upgrade: websocket\r\nConnection: Upgrade\r\n"+
    `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n`+
    `Cookie: ${cookie}\r\n\r\n`);
};
const sock=secure
  ? tls.connect({host:u.hostname,port,servername:u.hostname,rejectUnauthorized:process.env.NOPONG_INSECURE_TLS!=="1"},onConnect)
  : net.connect(port,u.hostname,onConnect);
const t0=Date.now();
let handshook=false, pings=0;
sock.on("data",(buf)=>{
  if(!handshook){
    if(buf.toString("latin1").startsWith("HTTP/1.1 101")){ handshook=true; console.log(`  [${Date.now()-t0}ms] handshake 101`); }
    return;
  }
  // count ping opcode 0x9 frames; deliberately DO NOT pong
  for(let i=0;i<buf.length;i++){ if((buf[i]&0x0f)===0x9 && (buf[i]&0x80)){ pings++; console.log(`  [${Date.now()-t0}ms] server PING #${pings} (ignoring)`); break; } }
});
sock.on("close",()=>{ console.log(`  [${Date.now()-t0}ms] socket CLOSED by server after ${pings} ignored pings`); process.exit(0); });
sock.on("error",e=>{console.log("  err",e.message)});
setTimeout(()=>{console.log(`  [${Date.now()-t0}ms] survived; pings seen=${pings}`);process.exit(0);},Number(seconds)*1000);
