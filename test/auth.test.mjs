import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Store } from '../src/store.mjs';
import { authSettings } from '../src/auth.mjs';
import { createApp } from '../src/server.mjs';

const secret = 'test-client-secret-with-32-characters-minimum';
const json = (res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
async function fixture({internalRouting=false,basePath=''} = {}) {
  const {publicKey,privateKey} = await generateKeyPair('RS256');
  const jwk = {...await exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  const grants = new Map();
  let issuer,tokenRequests=0;
  const provider = http.createServer(async(req,res)=>{
    const url = new URL(req.url,'http://localhost');
    if(url.pathname.endsWith('/.well-known/openid-configuration'))return json(res,200,{issuer,authorization_endpoint:issuer+'/protocol/openid-connect/auth',token_endpoint:issuer+'/protocol/openid-connect/token',jwks_uri:issuer+'/protocol/openid-connect/certs',end_session_endpoint:issuer+'/protocol/openid-connect/logout',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256']});
    if(url.pathname.endsWith('/certs'))return json(res,200,{keys:[jwk]});
    if(url.pathname.endsWith('/token')){
      tokenRequests++;
      let raw='';for await(const c of req)raw+=c;
      const body = new URLSearchParams(raw),grant=grants.get(body.get('code'));
      if(!grant || body.get('client_secret')!==secret || body.get('client_id')!=='novel-web' || body.get('redirect_uri')!=='https://novels.example.test'+basePath+'/auth/callback' || createHash('sha256').update(body.get('code_verifier')||'').digest('base64url')!==grant.challenge) return json(res,400,{error:'invalid_grant'});
      grants.delete(body.get('code'));
      let jwt = await new SignJWT({nonce:grant.nonce,roles:['novel-member'],name:grant.name || '参加者',sid:grant.sid || 'keycloak-session',...grant.claims})
        .setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(grant.issuer || issuer).setAudience(grant.audience || 'novel-web').setSubject(grant.subject || 'member-1').setIssuedAt().setExpirationTime(grant.expiry || '5m').sign(grant.signingKey || privateKey);
      if(grant.corrupt)jwt=jwt.slice(0,-8)+'aaaaaaaa';
      return json(res,200,{access_token:'test-access-token',token_type:'Bearer',expires_in:300,id_token:jwt});
    }
    json(res,404,{error:'not_found'});
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  const internalIssuer=`http://127.0.0.1:${provider.address().port}/realms/novel-branches`;
  issuer=internalRouting ? 'https://novels.example.test/id/realms/novel-branches' : internalIssuer;
  const store = new Store(':memory:');
  const auth = {mode:'oidc',basePath,origin:'https://novels.example.test',issuer,clientId:'novel-web',clientSecret:secret,memberRole:'novel-member',mcpAudience:'novel-mcp',allowHttp:!internalRouting,...(internalRouting?{internalIssuer}:{})};
  const server = createApp({store,auth,origin:auth.origin,secureCookies:true,mcpToken:'legacy-token'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,{method='GET',data,raw,cookie,headers={}}={})=>fetch(base+basePath+path,{method,redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json',Origin:auth.origin}:{}),...headers},body:raw??(data?JSON.stringify(data):undefined)});
  let codeCounter=0;
  const start=async(overrides={})=>{
    const response=await request('/auth/login');assert.equal(response.status,302);
    const redirect=new URL(response.headers.get('location'));
    const cookie=response.headers.getSetCookie()[0].split(';')[0];
    const state=redirect.searchParams.get('state'),code='code-'+(++codeCounter);
    grants.set(code,{nonce:redirect.searchParams.get('nonce'),challenge:redirect.searchParams.get('code_challenge'),...overrides});
    return {state,code,cookie,redirect};
  };
  const finish=login=>request(`/auth/callback?state=${login.state}&code=${login.code}`,{cookie:login.cookie});
  const sign=(claims,options={})=>new SignJWT({typ:'Bearer',roles:['novel-member'],scope:'novels:read',...claims}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(options.issuer||issuer).setAudience(options.audience||'novel-mcp').setSubject(options.subject||'reader-1').setIssuedAt().setExpirationTime(options.expiry||'5m').sign(privateKey);
  return {store,auth,issuer,request,start,finish,sign,get tokenRequests(){return tokenRequests;},async close(){await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>provider.close(r))]);store.close();}};
}
function session(response){return response.headers.getSetCookie().find(c=>c.startsWith('__Host-session=')).split(';')[0];}

test('本番設定はHTTPS・Secure cookie・OIDC設定が揃わなければ起動しない',()=>{
  assert.throws(()=>authSettings({NODE_ENV:'production'}));
  assert.throws(()=>authSettings({AUTH_MODE:'bad'}));
  const valid={AUTH_MODE:'oidc',NODE_ENV:'production',APP_ORIGIN:'https://novels.example.test',OIDC_ISSUER:'https://novels.example.test/id/realms/novel-branches',OIDC_CLIENT_ID:'novel-web',OIDC_CLIENT_SECRET:secret,COOKIE_SECURE:'true'};
  assert.equal(authSettings(valid).mode,'oidc');
  for(const patch of [{APP_ORIGIN:'http://novels.example.test'},{COOKIE_SECURE:'false'},{OIDC_CLIENT_SECRET:'short'},{OIDC_ISSUER:'http://keycloak:8080',OIDC_ALLOW_HTTP:'true'}])assert.throws(()=>authSettings({...valid,...patch}));
});
test('OIDCログインはPKCE・state・nonceを使用し、Secureセッションで作品を操作できる',async()=>{
  const f=await fixture();try{
    const login=await f.start();
    assert.equal(login.redirect.searchParams.get('code_challenge_method'),'S256');
    assert.equal(login.redirect.searchParams.get('redirect_uri'),f.auth.origin+'/auth/callback');
    assert.ok(login.redirect.searchParams.get('nonce'));
    const response=await f.finish(login);assert.equal(response.status,302);
    assert.match(response.headers.getSetCookie().find(c=>c.startsWith('__Host-session=')),/HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure/);
    const cookie=session(response);
    const me=await (await f.request('/api/me',{cookie})).json();assert.equal(me.user.display_name,'参加者');assert.equal(me.auth.mode,'oidc');
    const post=await f.request('/api/stories',{method:'POST',cookie,data:{title:'認証付き投稿',summary:'',chapterTitle:'第1話',body:'Keycloakユーザーの物語'}});assert.equal(post.status,201);
    const logout=await f.request('/api/logout',{method:'POST',cookie,data:{}});assert.equal(logout.status,200);assert.match((await logout.json()).logoutUrl,/protocol\/openid-connect\/logout/);
    assert.equal((await f.request('/api/stories',{cookie})).status,401);
  }finally{await f.close();}
});
test('stateの改竄、別ブラウザ、期限切れ、callback再利用を拒否する',async()=>{
  const f=await fixture();try{
    const login=await f.start(),other=await f.start();
    assert.equal((await f.request(`/auth/callback?state=${login.state}&code=${login.code}`,{cookie:other.cookie})).status,400);
    assert.equal((await f.request(`/auth/callback?state=modified&code=${login.code}`,{cookie:login.cookie})).status,400);
    assert.equal(f.tokenRequests,0);
    assert.equal((await f.finish(login)).status,302);
    assert.equal((await f.finish(login)).status,400);
    f.store.db.prepare('UPDATE oidc_logins SET expires=0').run();
    assert.equal((await f.finish(other)).status,400);
  }finally{await f.close();}
});
test('署名・issuer・audience・nonce・期限・参加ロールの不正を拒否する',async()=>{
  const f=await fixture();try{
    for(const [override,status] of [
      [{claims:{nonce:'wrong'}},401],[{issuer:'https://attacker.example'},401],[{audience:'other-app'},401],[{expiry:'-1h'},401],[{corrupt:true},401],[{claims:{roles:[]}},403]
    ]){
      const response=await f.finish(await f.start(override));assert.equal(response.status,status,JSON.stringify(override));
      assert.equal(response.headers.getSetCookie().some(c=>c.startsWith('__Host-session=')),false);
    }
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  }finally{await f.close();}
});
test('同じsubの作者情報を維持し、同名やメールでは既存ユーザーと統合しない',async()=>{
  const f=await fixture();try{
    const local=f.store.addUser('alice','同じ名前','local-password');
    const first=await f.finish(await f.start({name:'同じ名前'})),cookie1=session(first);
    const user1=(await (await f.request('/api/me',{cookie:cookie1})).json()).user;
    const second=await f.finish(await f.start({name:'変更後'})),cookie2=session(second);
    const user2=(await (await f.request('/api/me',{cookie:cookie2})).json()).user;
    const third=await f.finish(await f.start({name:'変更後',subject:'member-2'}));
    const user3=(await (await f.request('/api/me',{cookie:session(third)})).json()).user;
    assert.equal(user1.id,user2.id);assert.notEqual(user1.id,local.id);assert.notEqual(user2.id,user3.id);assert.equal(user2.display_name,'変更後');
  }finally{await f.close();}
});
test('本番OIDCでは旧ログイン・旧セッション・偽の認証ヘッダー・CSRFを拒否する',async()=>{
  const f=await fixture();try{
    const local=f.store.addUser('alice','Alice','local-password'),legacy=f.store.login('alice','local-password');
    assert.equal((await f.request('/api/login',{method:'POST',data:{username:'alice',password:'local-password'}})).status,404);
    assert.equal((await f.request('/api/stories',{cookie:'__Host-session='+legacy.token})).status,401);
    assert.equal((await f.request('/api/stories',{headers:{'X-Auth-Request-User':String(local.id),'X-Forwarded-User':'alice'}})).status,401);
    const response=await f.finish(await f.start()),cookie=session(response);
    assert.equal((await f.request('/api/logout',{method:'POST',data:{},cookie,headers:{Origin:'https://attacker.example','X-Forwarded-Host':'novels.example.test'}})).status,403);
    assert.equal((await f.request('/api/logout',{method:'POST',data:{},cookie,headers:{Origin:''}})).status,403);
    const who=(await (await f.request('/api/me',{cookie})).json()).user;
    const data={title:'identity-bound post',chapterTitle:'one',body:'body'};
    assert.equal((await f.request('/api/stories',{method:'POST',data,cookie,headers:{'X-Novel-User':String(local.id)}})).status,409);
    assert.equal(f.store.listStories({}).length,0);
    assert.equal((await f.request('/api/stories',{method:'POST',data,cookie,headers:{'X-Novel-User':String(who.id)}})).status,201);
  }finally{await f.close();}
});
test('MCPはKeycloakの署名・audience・scope・ロールを検証し、共有トークンに戻らない',async()=>{
  const f=await fixture();try{
    const data={jsonrpc:'2.0',id:1,method:'tools/list'};
    const call=token=>f.request('/mcp',{method:'POST',data,headers:{Authorization:'Bearer '+token,Accept:'application/json, text/event-stream'}});
    const valid=await call(await f.sign({}));assert.equal(valid.status,200);assert.equal((await valid.json()).result.tools.length,4);
    for(const token of ['legacy-token',await f.sign({},{audience:'novel-web'}),await f.sign({scope:'openid'}),await f.sign({roles:[]}),await f.sign({typ:'ID'}),await f.sign({},{expiry:'-1h'})])assert.equal((await call(token)).status,401);
  }finally{await f.close();}
});
test('署名付きbackchannel logoutで対象セッションだけを即時失効する',async()=>{
  const f=await fixture();try{
    const cookie1=session(await f.finish(await f.start({sid:'sid-1'}))),cookie2=session(await f.finish(await f.start({sid:'sid-2',subject:'member-2'})));
    const logoutToken=await f.sign({typ:undefined,roles:undefined,scope:undefined,sid:'sid-1',jti:'logout-1',events:{'http://schemas.openid.net/event/backchannel-logout':{}}},{audience:'novel-web'});
    // Use the same request helper with raw form bodies for provider notifications.
    const response=await f.request('/auth/backchannel-logout',{method:'POST',raw:new URLSearchParams({logout_token:logoutToken}),headers:{'Content-Type':'application/x-www-form-urlencoded'}});
    assert.equal(response.status,200);
    assert.equal((await f.request('/api/stories',{cookie:cookie1})).status,401);
    assert.equal((await f.request('/api/stories',{cookie:cookie2})).status,200);
    const invalid=await f.request('/auth/backchannel-logout',{method:'POST',raw:'logout_token=bad',headers:{'Content-Type':'application/x-www-form-urlencoded'}});assert.equal(invalid.status,400);
  }finally{await f.close();}
});

test('公開issuerを検証したまま、discovery・コード交換・JWKSを内部接続へ転送できる',async()=>{
  const f=await fixture({internalRouting:true});try{
    const response=await f.finish(await f.start());assert.equal(response.status,302);
    const cookie=session(response);assert.ok((await (await f.request('/api/me',{cookie})).json()).user);
    const token=await f.sign({});
    const mcp=await f.request('/mcp',{method:'POST',data:{jsonrpc:'2.0',id:1,method:'tools/list'},headers:{Authorization:'Bearer '+token,Accept:'application/json, text/event-stream'}});assert.equal(mcp.status,200);
  }finally{await f.close();}
});


test('サブパスで認証・投稿・ログアウトし、origin検証とHost cookieを維持する',async()=>{
 const f=await fixture({basePath:'/novel',internalRouting:true});try{
  assert.equal((await f.request('/../api/me')).status,404);
  assert.equal((await f.request('/api/stories')).status,401);
  const html=await (await f.request('/')).text();assert.match(html,/src="\.\/app.js"/);
  assert.equal((await f.request('/app.js')).status,200);
  const login=await f.start();assert.equal(login.redirect.searchParams.get('redirect_uri'),f.auth.origin+'/novel/auth/callback');
  const callback=await f.finish(login);assert.equal(callback.status,302);assert.equal(callback.headers.get('location'),f.auth.origin+'/novel/');
  assert.match(callback.headers.getSetCookie().find(c=>c.startsWith('__Host-session=')),/Path=\/;.*Secure/);
  const token=session(callback);
  const me=await (await f.request('/api/me',{cookie:token})).json();assert.equal(me.auth.loginUrl,'/novel/auth/login');
  assert.equal((await f.request('/api/stories',{method:'POST',cookie:token,data:{title:'subpath',chapterTitle:'one',body:'text'}})).status,201);
  assert.equal((await f.request('/api/stories',{method:'POST',cookie:token,data:{},headers:{Origin:f.auth.origin+'/novel'}})).status,403);
  const logout=await (await f.request('/api/logout',{method:'POST',cookie:token,data:{}})).json();
  assert.equal(new URL(logout.logoutUrl).searchParams.get('post_logout_redirect_uri'),f.auth.origin+'/novel/');
  assert.equal((await f.request('/api/stories',{cookie:token})).status,401);
 }finally{await f.close();}
});
