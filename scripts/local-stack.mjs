// Persistent localhost stack. No volume deletion and no secret-bearing config output.
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const command=process.argv[2]||'status';
if(existsSync('deploy/.test/vpn-migration.json'))throw Error('This stack uses VPN authentication now. Use npm run vpn -- up/stop/restart/status.');
if(!['up','stop','restart','status'].includes(command))throw Error('Use up, stop, restart or status.');
if(!existsSync('deploy/.test/stack.env')){
 const existing=spawnSync('docker',['volume','inspect','novel-branches-local_keycloak-data'],{stdio:'ignore'});
 if(existing.status===0)throw Error('Existing Keycloak volume found. Restore deploy/.test credentials before starting.');
 if(command!=='up')throw Error('Run node scripts/local-stack.mjs up first.');
}
if(command==='up')execFileSync(process.execPath,['scripts/prepare-stack-test.mjs'],{stdio:'inherit'});
const env=Object.fromEntries(readFileSync('deploy/.test/stack.env','utf8').trim().split('\n').map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
if(env.HTTP_BIND!=='127.0.0.1'||env.HTTPS_BIND!=='127.0.0.1'||env.APP_ORIGIN!=='https://localhost:8443')throw Error('Expected loopback-only localhost configuration.');
const args=['compose','-p','novel-branches-local','--env-file','deploy/.test/stack.env','-f','deploy/compose.public.yaml'];
execFileSync('docker',[...args,...({up:['up','-d','--build'],stop:['stop'],restart:['restart'],status:['ps']}[command])],{stdio:'inherit'});
if(['up','restart'].includes(command)){
 const url=env.APP_ORIGIN+'/id/realms/novel-branches/.well-known/openid-configuration';
 let ready=false;
 for(let i=0;i<120;i++){
  if(spawnSync('curl',['--silent','--fail','--cacert',env.TLS_DIR+'/fullchain.pem',url],{stdio:'ignore'}).status===0){ready=true;break;}
  await new Promise(r=>setTimeout(r,1500));
 }
 if(!ready)throw Error('Keycloak did not become ready over verified HTTPS.');
 console.log('Ready: https://localhost:8443 (trust deploy/.test/tls/fullchain.pem in your browser).');
}
