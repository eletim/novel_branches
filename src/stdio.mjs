import { createInterface } from 'node:readline';
import { Store } from './store.mjs';
import { rpc } from './mcp.mjs';
const store = new Store();
const input = createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{
  let response;
  try { response = rpc(store,JSON.parse(line)); }
  catch { response = {jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}; }
  if (response) process.stdout.write(JSON.stringify(response)+'\n');
});
input.on('close',()=>store.close());
