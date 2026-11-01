// Public HTTPS OAuth test. ChatGPT's callback is intercepted locally, not a ChatGPT connection.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {existsSync,readFileSync} from 'node:fs';
process.loadEnvFile('deploy/.test/public.env');process.loadEnvFile('deploy/.test/chatgpt.env');
const origin=process.env.APP_ORIGIN,resource=origin+process.env.APP_BASE_PATH+'/mcp',callback=process.env.MCP_CALLBACK;
assert.equal(resource,'https://eletim.jp/novel/mcp');
const browser=await chromium.launch();
const secretValues=[process.env.MCP_CLIENT_SECRET,...Object.entries(process.env).filter(([k])=>/PASSWORD/.test(k)).map(([,v])=>v)];
let stage='discovery';
async function token(body){
 const r=await fetch(metadata.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(process.env.MCP_CLIENT_ID+':'+process.env.MCP_CLIENT_SECRET).toString('base64')},body:new URLSearchParams(body)});
 const data=await r.json();if(data.access_token)secretValues.push(data.access_token,data.refresh_token||'',data.id_token||'');
 return {status:r.status,data};
}
let metadata;
async function grant(name='member',{scope='openid offline_access novels:read',target=resource,badVerifier=false}={}){
 const context=await browser.newContext(),p=await context.newPage();
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(24).toString('hex');
 let done;const captured=new Promise(resolve=>{done=resolve;});
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin===new URL(callback).origin){done(url);return route.fulfill({status:200,body:'OAuth callback intercepted locally.'});}
  const response=await route.fetch({maxRedirects:0});
  const location=response.headers().location;
  if(location){const target=new URL(location,url);if(target.origin===new URL(callback).origin){done(target);return route.fulfill({status:200,contentType:'text/plain',body:'OAuth callback intercepted before redirect; no request sent to ChatGPT.'});}}
  return route.fulfill({response});
 });
 const auth=new URL(metadata.authorization_endpoint);auth.search=new URLSearchParams({client_id:process.env.MCP_CLIENT_ID,redirect_uri:callback,response_type:'code',response_mode:'query',scope,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:target}).toString();
 try{
  const navigation=await p.goto(auth.href);if(navigation.status()>=400&&navigation.headers()['content-type']?.includes('application/json'))return {status:navigation.status(),data:await navigation.json()};
  if(await p.locator('#username').count()){
   await p.locator('#username').fill(process.env.TEST_USER_PREFIX+name);await p.locator('#password').fill(process.env['TEST_'+name.toUpperCase()+'_PASSWORD']);await p.locator('#kc-login').click();
  }
  const needsConsent=await Promise.race([captured.then(()=>false),p.getByRole('button',{name:'Yes',exact:true}).waitFor({state:'visible',timeout:15000}).then(()=>true)]);
  if(needsConsent)await p.getByRole('button',{name:'Yes',exact:true}).click();
  let timer;const response=await Promise.race([captured,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Authorization callback timeout')),15000);})]);clearTimeout(timer);
  if(!response.searchParams.has('state')&&new URL(p.url()).hash)for(const [k,v] of new URLSearchParams(new URL(p.url()).hash.slice(1)))response.searchParams.set(k,v);
  assert.equal(response.searchParams.get('state'),state);assert.equal(response.searchParams.get('iss'),metadata.issuer);
  if(response.searchParams.has('error'))return {status:400,data:{error:response.searchParams.get('error')}};
  const code=response.searchParams.get('code');assert.ok(code);
  const body={grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:badVerifier?randomBytes(32).toString('base64url'):verifier,resource:target};
  const result=await token(body);return {...result,body};
 }catch(e){if(e.message==='Authorization callback timeout')throw Error('Authorization callback timeout at '+new URL(p.url()).pathname+': '+(await p.locator('body').innerText()).slice(0,700));throw e;}finally{await context.close();}
}
async function rpc(access,method,params){
 const r=await fetch(resource,{method:'POST',headers:{...(access?{Authorization:'Bearer '+access}:{}),'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});return {status:r.status,data:await r.json()};
}
try {
 const missing=await fetch(resource);assert.equal(missing.status,401);
 const challenge=missing.headers.get('www-authenticate');const metadataURL=challenge.match(/resource_metadata="([^"]+)"/)[1];
 const protectedMetadata=await (await fetch(metadataURL)).json();assert.equal(protectedMetadata.resource,resource);assert.deepEqual(protectedMetadata.scopes_supported,['novels:read']);
 const issuer=protectedMetadata.authorization_servers[0];
 metadata=await (await fetch(origin+'/.well-known/oauth-authorization-server'+new URL(issuer).pathname)).json();
 assert.equal(metadata.issuer,issuer);assert.ok(metadata.code_challenge_methods_supported.includes('S256'));assert.equal(metadata.authorization_response_iss_parameter_supported,true);assert.ok(!metadata.registration_endpoint);assert.ok(metadata.scopes_supported.includes('offline_access'));
 const standard=await (await fetch(origin+'/.well-known/oauth-protected-resource/novel/mcp')).json();assert.equal(standard.resource,resource);
 console.log('PASS public MCP: challenge, RFC discovery and /novel/ metadata');
 stage='authorization code + PKCE';const login=await grant();assert.equal(login.status,200);assert.ok(login.data.refresh_token);
 const offline=JSON.parse(Buffer.from(login.data.refresh_token.split('.')[1],'base64url'));assert.equal(offline.typ,'Offline');
 const identityOnly=await grant('member',{scope:'openid offline_access'});assert.equal(identityOnly.status,200);assert.equal((await rpc(identityOnly.data.access_token,'tools/list')).status,200);
 console.log('PASS ChatGPT scopes: explicit three scopes and identity-only request both grant read; offline refresh token issued');
 const claims=JSON.parse(Buffer.from(login.data.access_token.split('.')[1],'base64url'));assert.ok([claims.aud].flat().includes(resource));assert.ok(claims.roles.includes('novel-member'));assert.ok(claims.scope.split(' ').includes('novels:read'));
 stage='MCP tools';assert.equal((await rpc(login.data.access_token,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'public-oauth-verifier',version:'1'}})).status,200);
 const catalog=await rpc(login.data.access_token,'tools/list');assert.equal(catalog.status,200);assert.deepEqual(catalog.data.result.tools.map(t=>t.name),['list_stories','get_story','get_chapter','get_branch_path']);
 for(const t of catalog.data.result.tools){assert.equal(t.annotations.readOnlyHint,true);assert.deepEqual(t.securitySchemes,[{type:'oauth2',scopes:['novels:read']}]);}
 async function call(name,args={}){const r=await rpc(login.data.access_token,'tools/call',{name,arguments:args});assert.equal(r.status,200);assert.equal(r.data.result.isError,false);return r.data.result.structuredContent;}
 const stories=await call('list_stories');assert.ok(stories.stories.length);
 const story=await call('get_story',{storyId:stories.stories[0].id});
 const chapter=await call('get_chapter',{chapterId:story.chapters[0].id});assert.ok(chapter.body);
 const branch=story.branches.find(b=>b.fork_chapter_id)||story.branches[0];const path=await call('get_branch_path',{branchId:branch.id});assert.ok(path.chapters.length);assert.equal(path.chapters.at(-1).id,branch.head_id);
 const evidence='deploy/.test/evidence/episodes-public/episodes.json';
 if(existsSync(evidence)){
  const proof=JSON.parse(readFileSync(evidence,'utf8'));
  const shared=await call('get_chapter',{chapterId:proof.first});assert.equal(shared.body,'先に保存された共通本文');assert.equal(shared.author,'Test member');assert.equal(shared.updated_at,proof.updatedAt);assert.equal(shared.revision,3);
  const contributed=await call('get_chapter',{chapterId:proof.second});assert.equal(contributed.author,'Test other');assert.ok(contributed.updated_at);
  const editedStory=await call('get_story',{storyId:proof.story});assert.equal(editedStory.chapters.find(c=>c.id===proof.second).author,'Test other');
  const nestedBranch=editedStory.branches.find(b=>b.head_id===proof.nestedFourth);
  const editedPath=await call('get_branch_path',{branchId:nestedBranch.id});assert.deepEqual(editedPath.chapters.map(c=>c.id),[proof.first,proof.fork,proof.nested,proof.nestedFourth]);assert.equal(editedPath.chapters[0].updated_at,proof.updatedAt);assert.equal(editedPath.chapters[1].author,'Test member');
  console.log('PASS MCP episode regression: edited body/revision/update time, per-episode creators and nested reading order match browser');
 }
 const write=await rpc(login.data.access_token,'tools/call',{name:'create_story',arguments:{}});assert.equal(write.data.error.code,-32602);
 console.log('PASS public MCP: code + S256 + issuer identification, initialize, four read tools, no write tool');
 stage='refresh';const refreshed=await token({grant_type:'refresh_token',refresh_token:login.data.refresh_token,resource});assert.equal(refreshed.status,200,refreshed.data.error);const refreshClaims=JSON.parse(Buffer.from(refreshed.data.access_token.split('.')[1],'base64url'));assert.ok([refreshClaims.aud].flat().includes(resource));assert.ok([refreshClaims.aud].flat().every(a=>[resource,'novel-mcp'].includes(a)));assert.equal((await rpc(refreshed.data.access_token,'tools/list')).status,200);
 console.log('PASS public MCP: refresh token with canonical resource');
 stage='negative authorization';assert.equal((await rpc(null,'tools/list')).status,401);assert.equal((await rpc('not-a-token','tools/list')).status,401);
 for(const [name,options] of [['outsider',{}]]){stage='negative '+name+' '+options.scope;const denied=await grant(name,options);assert.equal(denied.status,200);assert.equal((await rpc(denied.data.access_token,'tools/call',{name:'get_chapter',arguments:{chapterId:chapter.id}})).status,401);}
 stage='code replay';const replay=await grant();assert.equal(replay.status,200);assert.equal((await token(replay.body)).status,400);
 stage='invalid verifier';assert.equal((await grant('member',{badVerifier:true})).status,400);
 stage='invalid resource';const wrong=await grant('member',{target:'https://invalid.example/mcp'});assert.equal(wrong.status,400);assert.equal(wrong.data.error,'invalid_target');
 console.log('PASS public MCP: anonymous, bad token, missing role, invalid PKCE and invalid resource rejected; missing-scope rejection covered by signed-token unit tests');
 stage='actual access-token expiry';const end=claims.exp*1000+6500;
 while(Date.now()<end){console.log('Waiting for actual MCP access-token expiry; seconds:',Math.ceil((end-Date.now())/1000));await new Promise(resolve=>setTimeout(resolve,Math.min(30000,end-Date.now())));}
 assert.equal((await rpc(login.data.access_token,'tools/call',{name:'get_chapter',arguments:{chapterId:chapter.id}})).status,401);
 const renewed=await token({grant_type:'refresh_token',refresh_token:refreshed.data.refresh_token,resource});assert.equal(renewed.status,200);assert.equal((await rpc(renewed.data.access_token,'tools/list')).status,200);
 console.log('PASS public MCP: expired access token cannot read; refresh restores authenticated access');
 console.log('OAuth/MCP verification complete. This was a browser-based test client, not an actual ChatGPT connection.');
}catch(e){let message=e.message.replace(/https?:\/\/\S+/g,'[URL omitted]');for(const secret of secretValues)if(secret)message=message.replaceAll(secret,'[redacted]');console.error('FAIL public MCP at '+stage+': '+message);process.exitCode=1;}
finally{await browser.close();}
