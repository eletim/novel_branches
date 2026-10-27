// Run only against scripts/prepare-stack-test.mjs fixtures on localhost.
import assert from 'node:assert/strict';
process.loadEnvFile('deploy/.test/stack.env');
const origin=process.env.APP_ORIGIN;
if(origin!=='https://localhost:8443')throw Error('This script only runs against the disposable localhost stack.');
const issuer=origin+'/id/realms/novel-branches';
class BrowserSession {
  constructor(){this.cookies=new Map();}
  async fetch(url,options={}){
    const target=new URL(url,origin);assert.equal(target.origin,origin,'Unexpected test destination');
    const response=await fetch(target,{redirect:'manual',...options,headers:{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; '),...options.headers},signal:AbortSignal.timeout(15000)});
    for(const cookie of response.headers.getSetCookie()){
      const [pair]=cookie.split(';'),index=pair.indexOf('='),name=pair.slice(0,index),value=pair.slice(index+1);
      if(/Max-Age=0(?:;|$)/i.test(cookie))this.cookies.delete(name);else this.cookies.set(name,value);
    }
    return response;
  }
  async follow(response){
    for(let i=0;i<10 && [302,303].includes(response.status);i++)response=await this.fetch(response.headers.get('location'));
    return response;
  }
  async login(username,password){
    let response=await this.follow(await this.fetch('/auth/login'));
    const page=await response.text();
    if(page.includes('id="kc-form-login"')){
      const action=page.match(/<form\b[^>]*\bid="kc-form-login"[^>]*\baction="([^"]+)"/)?.[1] || page.match(/<form\b[^>]*\baction="([^"]+)"[^>]*\bid="kc-form-login"/)?.[1];
      assert.ok(action,'Keycloak login form must be present');
      response=await this.follow(await this.fetch(action.replaceAll('&amp;','&'),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin},body:new URLSearchParams({username,password,credentialId:''})}));
    }
    return response;
  }
  async api(path,method='GET',data){
    return this.fetch('/api'+path,{method,headers:{...(data?{'Content-Type':'application/json',Origin:origin}:{})},body:data?JSON.stringify(data):undefined});
  }
}
let ready=false;
for(let attempt=0;attempt<100;attempt++){
  try{const r=await fetch(issuer+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(3000)});if(r.ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,1500));
}
assert.ok(ready,'Keycloak did not become ready');
console.log('PASS: Keycloak discovery over verified HTTPS');
const anonymous=new BrowserSession();
assert.equal((await anonymous.api('/stories')).status,401);
assert.equal((await anonymous.fetch('/api/stories',{headers:{'X-Auth-Request-User':'1','X-Forwarded-User':'test-member','X-Novel-User':'1',Cookie:'session=legacy-session'}})).status,401);
assert.equal((await anonymous.api('/login','POST',{username:'test-member',password:'not-a-real-password'})).status,404);
for(const path of ['/id/admin/','/id/realms/master/.well-known/openid-configuration','/id/health','/health'])assert.equal((await anonymous.fetch(path)).status,404);
const redirect=await fetch('http://localhost:8088/',{redirect:'manual'});assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),origin+'/');
const home=await anonymous.fetch('/');assert.match(home.headers.get('strict-transport-security'),/max-age/);
console.log('PASS: Nginx HTTPS, redirect, login requirement and private admin routes');
const alice=new BrowserSession(),bob=new BrowserSession();
assert.equal((await alice.login('test-member',process.env.TEST_MEMBER_PASSWORD)).status,200);
assert.equal((await bob.login('test-other',process.env.TEST_OTHER_PASSWORD)).status,200);
const me=await (await alice.api('/me')).json();assert.ok(me.user);assert.equal(me.auth.mode,'oidc');
assert.ok(alice.cookies.has('__Host-session'));
const post=await alice.api('/stories','POST',{title:'実スタックの物語',summary:'NginxとKeycloakの接続テスト',chapterTitle:'共通の第1話',body:'共通の本文'});assert.equal(post.status,201);const root=await post.json();
const fork=await bob.api(`/chapters/${root.chapterId}/fork`,'POST',{branchTitle:'別世界',title:'別の続き',body:'Bobの本文'});assert.equal(fork.status,201);const branch=await fork.json();
assert.equal((await alice.api(`/chapters/${branch.chapterId}/like`,'PUT',{liked:true})).status,200);
assert.equal((await (await bob.api(`/chapters/${branch.chapterId}`)).json()).likes,1);
assert.equal((await bob.api(`/branches/${root.branchId}/chapters`,'POST',{title:'他人の話',body:'拒否',expectedHeadId:root.chapterId})).status,403);
assert.equal((await alice.fetch('/api/logout',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json','X-Forwarded-Host':'localhost'},body:'{}'})).status,403);
console.log('PASS: two real Keycloak users can post, fork, read and like through Nginx');
const outsider=new BrowserSession();assert.equal((await outsider.login('test-outsider',process.env.TEST_OUTSIDER_PASSWORD)).status,403);assert.equal((await outsider.api('/stories')).status,401);
console.log('PASS: authenticated user without membership is denied');
const tokenResponse=await fetch(issuer+'/protocol/openid-connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',client_id:'novel-mcp',username:'test-member',password:process.env.TEST_MEMBER_PASSWORD,scope:'openid novels:read'})});
assert.equal(tokenResponse.status,200);const tokens=await tokenResponse.json();
const mcp=await fetch(origin+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_chapter',arguments:{chapterId:branch.chapterId}}})});
const tokenClaims=JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url').toString());
const tokenHeader=JSON.parse(Buffer.from(tokens.access_token.split('.')[0],'base64url').toString());
assert.equal(mcp.status,200,JSON.stringify({aud:tokenClaims.aud,typ:tokenClaims.typ,scope:tokenClaims.scope,hasSubject:typeof tokenClaims.sub==='string',hasMemberRole:tokenClaims.roles?.includes('novel-member'),alg:tokenHeader.alg}));assert.equal((await mcp.json()).result.structuredContent.body,'Bobの本文');
console.log('PASS: MCP accepts a real Keycloak access token and returns the shared story');
const logout=await alice.api('/logout','POST',{});assert.equal(logout.status,200);const {logoutUrl}=await logout.json();assert.ok(logoutUrl);assert.equal((await alice.follow(await alice.fetch(logoutUrl))).status,200);assert.equal((await alice.api('/stories')).status,401);
console.log('PASS: application logout and Keycloak RP-initiated logout');
console.log('All real-stack checks passed. Only disposable localhost data was used.');
