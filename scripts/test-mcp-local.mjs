// Read-only HTTP MCP client against browser-created data, real Keycloak tokens.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const config=process.env.TEST_STACK_ENV||'deploy/.test/stack.env';
assert.ok(['deploy/.test/stack.env','deploy/.test/vpn.env'].includes(config));
process.loadEnvFile(config);
const origin=process.env.APP_ORIGIN;assert.ok(origin==='https://localhost:8443'||(config==='deploy/.test/vpn.env' && /^https:\/\/[a-z0-9.-]+\.ts\.net:8443$/.test(origin)));
const evidence=JSON.parse(readFileSync('deploy/.test/evidence/browser.json'));
async function token(name,scope='openid novels:read'){
 const r=await fetch(origin+'/id/realms/novel-branches/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'novel-mcp',username:'test-'+name,password:process.env['TEST_'+name.toUpperCase()+'_PASSWORD'],scope})});assert.equal(r.status,200);return (await r.json()).access_token;
}
async function rpc(access,method,params){const r=await fetch(origin+'/mcp',{method:'POST',headers:{...(access?{Authorization:'Bearer '+access}:{}),'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:r.status,body:await r.json()};}
const access=await token('member');
assert.equal((await rpc(null,'tools/list')).status,401);
assert.equal((await rpc('old-shared-token','tools/list')).status,401);
assert.equal((await rpc(await token('outsider'),'tools/list')).status,401);
assert.equal((await rpc(await token('member','openid'),'tools/list')).status,401);
// Create and remove a uniquely named local test client through the internal admin API.
// Credentials travel through stdin, never shell arguments or diagnostics.
const wrongAudienceCode=`
let input='';for await(const c of process.stdin)input+=c;
const env=JSON.parse(input),base='http://keycloak:8080/id';
const login=await fetch(base+'/realms/master/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:env.admin,password:env.password})});
if(!login.ok)process.exit(2);const admin=(await login.json()).access_token;
const headers={Authorization:'Bearer '+admin,'Content-Type':'application/json'},endpoint=base+'/admin/realms/novel-branches/clients';
const id='local-audience-check-'+Date.now();const client=env.client;client.clientId=id;client.protocolMappers.find(m=>m.name==='mcp-audience').config['included.client.audience']=id;
const created=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(client)});if(created.status!==201)process.exit(3);
try{const r=await fetch(base+'/realms/novel-branches/protocol/openid-connect/token',{method:'POST',headers:{'X-Forwarded-Proto':'https','X-Forwarded-Host':'localhost','X-Forwarded-Port':'8443'},body:new URLSearchParams({grant_type:'password',client_id:id,username:'test-member',password:env.member,scope:'openid novels:read'})});if(!r.ok)process.exitCode=4;else process.stdout.write(JSON.stringify(await r.json()));}
finally{const r=await fetch(created.headers.get('location'),{method:'DELETE',headers});if(!r.ok)process.exitCode=5;}
`;
const realm=JSON.parse(readFileSync('deploy/.test/test-realm.json'));
let wrong;
try{wrong=JSON.parse(execFileSync('docker',['compose','-p','novel-branches-local','--env-file','deploy/.test/stack.env','-f','deploy/compose.public.yaml','exec','-T','app','node','--input-type=module','-e',wrongAudienceCode],{input:JSON.stringify({admin:process.env.KC_ADMIN_USER,password:process.env.KC_ADMIN_PASSWORD,member:process.env.TEST_MEMBER_PASSWORD,client:realm.clients.find(c=>c.clientId==='novel-mcp')}),stdio:['pipe','pipe','pipe']}).toString()).access_token;}catch{throw Error('Internal audience fixture failed (secret-bearing output suppressed)');}
assert.equal((await rpc(wrong,'tools/list')).status,401);
assert.equal((await rpc(access,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'localhost-verifier',version:'1'}})).status,200);
const names=(await rpc(access,'tools/list')).body.result.tools.map(t=>t.name).sort();assert.deepEqual(names,['get_branch_path','get_chapter','get_story','list_stories']);
const snapshot={};
for(const [name,args] of [['list_stories',{}],['get_story',{storyId:evidence.story}],['get_chapter',{chapterId:evidence.third}],['get_branch_path',{branchId:evidence.nestedBranch}]]){
 const r=await rpc(access,'tools/call',{name,arguments:args});assert.equal(r.status,200);assert.ok(r.body.result.structuredContent);snapshot[name]=r.body.result.structuredContent;
}
assert.equal(snapshot.get_chapter.body,'別世界の続きを読む。');assert.equal(snapshot.get_chapter.likes,1);
assert.deepEqual(snapshot.get_branch_path.chapters.map(c=>c.id),[evidence.first,evidence.fork,evidence.nested]);
const rejected=await rpc(access,'tools/call',{name:'create_story',arguments:{title:'MCP cannot write'}});assert.ok(rejected.body.error || rejected.body.result?.isError);
const target='deploy/.test/evidence/mcp.json';
if(process.argv.includes('--compare')){const before=JSON.parse(readFileSync(target));for(const key of ['get_story','get_chapter','get_branch_path'])assert.deepEqual(snapshot[key],before[key]);console.log('PASS restart persistence: complete story, nested paths, body and votes match.');}
else writeFileSync(target,JSON.stringify(snapshot,null,2));
console.log('PASS HTTP MCP: initialize, four read tools, browser data, no write tool; anonymous/shared-token/wrong-audience/missing-role/missing-scope rejected.');
