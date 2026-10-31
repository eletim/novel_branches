// Existing Tailscale only: TLS stays at Nginx, raw TCP is forwarded over the VPN.
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const action=process.argv[2]||'status';
if(!['up','stop','restart','status'].includes(action))throw Error('Use up, stop, restart or status.');
const base=['compose','-p','novel-branches-local'];
const compose=(env,args,options={})=>execFileSync('docker',[...base,'--env-file',env,'-f','deploy/compose.public.yaml',...args],{stdio:'inherit',...options});
const file='deploy/.test/vpn.env',marker='deploy/.test/vpn-migration.json';
if(action==='status'){
 compose(existsSync(file)?file:'deploy/.test/stack.env',['ps']);execFileSync('tailscale',['serve','status'],{stdio:'inherit'});process.exit(0);
}
if(action==='stop'){
 execFileSync('tailscale',['serve','--tcp=8443','off'],{stdio:'inherit'});compose(file,['stop']);process.exit(0);
}
const status=JSON.parse(execFileSync('tailscale',['status','--json'],{encoding:'utf8'}));
if(status.BackendState!=='Running'||!status.Self.Online)throw Error('Connect to the existing Tailscale VPN first.');
const host=status.Self.DNSName.replace(/\.$/,'');
if(!host.endsWith('.ts.net'))throw Error('Expected a Tailscale DNS name.');
const origin=`https://${host}:8443`;
const serve=JSON.parse(execFileSync('tailscale',['serve','status','--json'],{encoding:'utf8'}));
if(serve.TCP?.['8443'] && serve.TCP['8443'].TCPForward!=='127.0.0.1:8443')throw Error('VPN port 8443 already belongs to another service.');
if(serve.AllowFunnel?.[host+':8443'])throw Error('Internet Funnel must not be enabled on this port.');
const env=Object.fromEntries(readFileSync('deploy/.test/stack.env','utf8').trim().split('\n').map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
if(env.APP_ORIGIN!=='https://localhost:8443'||env.HTTP_BIND!=='127.0.0.1'||env.HTTPS_BIND!=='127.0.0.1')throw Error('Expected the existing localhost stack.');
const tls=resolve('deploy/.test/vpn-tls');mkdirSync(tls,{recursive:true});chmodSync(tls,0o700);
execFileSync('tailscale',['cert','--cert-file',tls+'/fullchain.pem','--key-file',tls+'/privkey.pem',host],{stdio:'inherit'});chmodSync(tls+'/privkey.pem',0o600);
writeFileSync(file,Object.entries({...env,PUBLIC_HOST:host,APP_ORIGIN:origin,TLS_DIR:tls}).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
if(!existsSync(marker)){
 // Capture both DBs before deliberately moving the issuer of this same realm.
 const backup=resolve('deploy/.test/backups');mkdirSync(backup,{recursive:true});chmodSync(backup,0o700);
 writeFileSync(backup+'/tailscale-serve-before.json',JSON.stringify(serve,null,2),{mode:0o600});
 const dump=compose('deploy/.test/stack.env',['exec','-T','keycloak-db','pg_dump','-U','keycloak','-Fc','keycloak'],{stdio:['ignore','pipe','pipe']});
 writeFileSync(backup+'/keycloak-before-vpn.dump',dump,{mode:0o600});
 compose('deploy/.test/stack.env',['stop','nginx']);
 const code=`
 import { DatabaseSync, backup } from 'node:sqlite';
 let raw='';for await(const c of process.stdin)raw+=c;const data=JSON.parse(raw);
 const db=new DatabaseSync('/app/data/novels.db');await backup(db,'/app/data/before-vpn.db');
 const url='http://keycloak:8080/id';
 const r=await fetch(url+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({client_id:'admin-cli',grant_type:'password',username:data.admin,password:data.password})});if(!r.ok)throw Error('Admin login failed');
 const token=(await r.json()).access_token,headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const endpoint=url+'/admin/realms/novel-branches/clients';const list=await fetch(endpoint+'?clientId=novel-web',{headers});if(!list.ok)throw Error('Client lookup failed');const [client]=await list.json();if(!client)throw Error('Missing client');
 client.redirectUris=[data.origin+'/auth/callback'];client.webOrigins=[data.origin];client.attributes['post.logout.redirect.uris']=data.origin+'/';
 const updated=await fetch(endpoint+'/'+client.id,{method:'PUT',headers,body:JSON.stringify(client)});if(!updated.ok)throw Error('Client update failed');
 db.exec('BEGIN IMMEDIATE');try{
 const old=data.old+'/id/realms/novel-branches',next=data.origin+'/id/realms/novel-branches';
 db.prepare('UPDATE oidc_identities SET issuer=? WHERE issuer=?').run(next,old);
 db.prepare('DELETE FROM sessions WHERE issuer=?').run(old);db.exec('DELETE FROM oidc_logins');db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}db.close();console.log('Existing author IDs preserved; browser sessions must log in again.');`;
 try{const output=compose('deploy/.test/stack.env',['exec','-T','app','node','--input-type=module','-e',code],{input:JSON.stringify({origin,old:env.APP_ORIGIN,admin:env.KC_ADMIN_USER,password:env.KC_ADMIN_PASSWORD}),stdio:['pipe','pipe','pipe']});process.stdout.write(output);}catch{throw Error('VPN migration failed; backup retained. Secret-bearing diagnostics suppressed.');}
 writeFileSync(marker,JSON.stringify({origin,previousOrigin:env.APP_ORIGIN,created:new Date().toISOString()}),{mode:0o600});
}else if(JSON.parse(readFileSync(marker)).origin!==origin)throw Error('VPN hostname changed; review the issuer migration before continuing.');
compose(file,['up','-d','--build']);
// Force the renewed certificate to be loaded, including a normal subsequent up.
compose(file,action==='restart'?['restart']:['restart','nginx']);
execFileSync('tailscale',['serve','--bg','--tcp=8443','tcp://127.0.0.1:8443'],{stdio:'inherit'});
let ready=false;
for(let i=0;i<120;i++){
 if(spawnSync('curl',['--silent','--fail','--max-time','3',origin+'/id/realms/novel-branches/.well-known/openid-configuration'],{stdio:'ignore'}).status===0){ready=true;break;}
 await new Promise(r=>setTimeout(r,1500));
}
if(!ready)throw Error('VPN HTTPS not ready. No certificate verification bypass was used.');
console.log('VPN ready: '+origin);
