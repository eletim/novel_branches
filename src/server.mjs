import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { Store, AppError } from './store.mjs';
import { rpc } from './mcp.mjs';
import { authSettings, OidcAuth, cookie, sessionCookie, appBasePath } from './auth.mjs';

const staticFiles = {'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
function equal(a,b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b)); }
async function rawBody(req, limit = 512000) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new AppError('入力が大きすぎます。',413); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
async function body(req) {
  const raw = await rawBody(req);
  try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new AppError('JSONの形式が不正です。'); }
}
export function createApp({store = new Store(), mcpToken = process.env.MCP_TOKEN, origin = process.env.APP_ORIGIN, secureCookies = process.env.COOKIE_SECURE === 'true', auth = authSettings(), basePath = auth.basePath ?? appBasePath()} = {}) {
  const attempts = new Map();
  const identity = auth.mode === 'oidc' ? new OidcAuth(store,auth) : null;
  if (identity && origin !== auth.origin) throw Error('APP_ORIGIN must match OIDC origin');
  if (identity && !auth.allowHttp && !secureCookies) throw Error('OIDC requires secure cookies');
  const mcpResource = identity ? origin+basePath+'/mcp' : null;
  const resourceMetadataUrl = identity ? origin+basePath+'/.well-known/oauth-protected-resource' : null;
  const mcpChallenge = (invalid=false) => 'Bearer resource_metadata="'+resourceMetadataUrl+'", scope="novels:read"'+(invalid?', error="invalid_token"':'');
  const authInfo = {mode:auth.mode,loginUrl:identity ? basePath+'/auth/login' : null};
  const loginCookie = (value,maxAge=600) => `${secureCookies ? '__Host-oidc-login' : 'oidc_login'}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(data === undefined ? undefined : JSON.stringify(data)); };
    try {
      const url = new URL(req.url,'http://localhost');
      // RFC 9728 path discovery and the explicitly advertised subpath alias.
      if (identity && [basePath+'/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource'+basePath+'/mcp','/.well-known/oauth-protected-resource'].includes(url.pathname) && req.method==='GET') {
        return send(200,{resource:mcpResource,authorization_servers:[auth.issuer],scopes_supported:['novels:read'],bearer_methods_supported:['header'],resource_name:'Novel Branches (read only)'});
      }
      // RFC 8414 places the well-known segment before an issuer path.
      if (identity && url.pathname==='/.well-known/oauth-authorization-server'+new URL(auth.issuer).pathname && req.method==='GET') {
        const metadata=(await identity.config()).serverMetadata();
        return send(200,{issuer:metadata.issuer,authorization_endpoint:metadata.authorization_endpoint,token_endpoint:metadata.token_endpoint,jwks_uri:metadata.jwks_uri,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['client_secret_basic','client_secret_post'],code_challenge_methods_supported:['S256'],scopes_supported:['openid','profile','offline_access','novels:read'],authorization_response_iss_parameter_supported:metadata.authorization_response_iss_parameter_supported===true});
      }
      // Health is internal and remains independent of the browser mount path.
      if (url.pathname === '/health') return send(200,{status:'ok'});
      if (basePath) {
        if (url.pathname === basePath) {res.writeHead(308,{Location:basePath+'/'});res.end();return;}
        if (!url.pathname.startsWith(basePath+'/')) throw new AppError('見つかりません。',404);
        url.pathname=url.pathname.slice(basePath.length);
      }
      const expectedOrigin = origin || `http://${req.headers.host}`;
      if (url.pathname.startsWith('/api/') && !['GET','HEAD'].includes(req.method) && identity && req.headers.origin !== expectedOrigin) throw new AppError('操作元を確認できません。',403);
      if (req.headers.origin && req.headers.origin !== expectedOrigin) throw new AppError('この接続元からの操作は許可されていません。',403);
      if (identity && url.pathname.startsWith('/auth/')) {
        const redirect = location => {res.writeHead(302,{Location:location,'Cache-Control':'no-store'});res.end();};
        if (url.pathname === '/auth/login' && req.method === 'GET') {
          try {
            const login = await identity.start();
            res.setHeader('Set-Cookie',loginCookie(login.browser));
            return redirect(login.location);
          } catch(e) {if (e instanceof AppError) throw e;throw new AppError('認証サービスに接続できません。少し待って再試行してください。',503);}
        }
        if (url.pathname === '/auth/callback' && req.method === 'GET') {
          const login = await identity.callback(new URL(req.url,auth.origin),cookie(req,secureCookies ? '__Host-oidc-login' : 'oidc_login'));
          store.logout(cookie(req,secureCookies ? '__Host-session' : 'session'));
          res.setHeader('Set-Cookie',[loginCookie('',0),sessionCookie(login.token,{secure:secureCookies,maxAge:login.maxAge})]);
          return redirect(auth.origin+basePath+'/');
        }
        if (url.pathname === '/auth/backchannel-logout' && req.method === 'POST') {
          if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw new AppError('Invalid logout content type',415);
          const form = new URLSearchParams(await rawBody(req,64000));
          await identity.backchannelLogout(form.get('logout_token'));
          return send(200,{ok:true});
        }
        throw new AppError('見つかりません。',404);
      }
      if (url.pathname === '/mcp') {
        if (identity) {
          try {await identity.verifyMcp(req.headers.authorization);} catch(e) {const challenge=mcpChallenge(!!req.headers.authorization);res.setHeader('WWW-Authenticate',challenge);return send(401,{error:'MCP authorization required',_meta:{'mcp/www_authenticate':[challenge]}});}
        } else if (!mcpToken || !equal(req.headers.authorization,`Bearer ${mcpToken}`)) { res.setHeader('WWW-Authenticate','Bearer'); return send(401,{error:'MCP token required'}); }
        if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(405,{error:'Use POST; server-initiated SSE is not supported.'}); }
        if (!req.headers['content-type']?.includes('application/json')) return send(415,{error:'application/json required'});
        const accept = req.headers.accept || '';
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return send(406,{error:'Accept application/json and text/event-stream'});
        const version = req.headers['mcp-protocol-version'];
        if (version && !['2025-06-18','2025-03-26','2025-11-25'].includes(version)) return send(400,{error:'Unsupported MCP protocol version'});
        let message;
        try { message = await body(req); } catch { return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); }
        const result = rpc(store,message,{oauth:!!identity});
        return send(result ? 200 : 202,result || undefined);
      }
      if (url.pathname.startsWith('/api/')) {
        const token = cookie(req,secureCookies ? '__Host-session' : 'session');
        const user = store.session(token,auth.mode);
        if (url.pathname === '/api/me' && req.method === 'GET') return send(200,{user,auth:authInfo});
        if (url.pathname === '/api/login' && req.method === 'POST') {
          if (identity) throw new AppError('Keycloakからログインしてください。',404);
          const key = req.socket.remoteAddress;
          const now = Date.now(), attempt = attempts.get(key);
          if (attempt && attempt.until > now && attempt.count >= 15) throw new AppError('しばらく待ってからログインしてください。',429);
          if (attempts.size > 1000) for (const [k,v] of attempts) if(v.until < now) attempts.delete(k);
          const a = !attempt || attempt.until < now ? {count:0,until:now+15*60000} : attempt;
          a.count++; attempts.set(key,a);
          const input = await body(req), login = store.login(input.username,input.password);
          attempts.delete(key);
          store.logout(token);
          res.setHeader('Set-Cookie',sessionCookie(login.token,{secure:secureCookies,maxAge:604800}));
          return send(200,{user:login.user});
        }
        if (!user) throw new AppError('ログインしてください。',401);
        // A different tab may have replaced this browser's session cookie.
        if (!['GET','HEAD'].includes(req.method) && req.headers['x-novel-user'] !== undefined && req.headers['x-novel-user'] !== String(user.id)) throw new AppError('別のユーザーに切り替わりました。下書きを保存したまま、画面を再読み込みしてください。',409);
        if (req.method !== 'GET' && !req.headers['content-type']?.includes('application/json')) throw new AppError('application/jsonで送信してください。',415);
        if (url.pathname === '/api/logout' && req.method === 'POST') {
          // Revoke locally even if Keycloak is temporarily unavailable.
          let logoutUrl;
          try {if(identity) logoutUrl = await identity.logoutUrl(token);} catch {}
          store.logout(token);
          res.setHeader('Set-Cookie',sessionCookie('',{secure:secureCookies}));
          return send(200,{ok:true,...(logoutUrl ? {logoutUrl} : {})});
        }
        if (url.pathname === '/api/stories' && req.method === 'GET') return send(200,{stories:store.listStories({query:url.searchParams.get('q') || '',sort:url.searchParams.get('sort') || 'new',limit:Number(url.searchParams.get('limit') || 50),offset:Number(url.searchParams.get('offset') || 0)})});
        if (url.pathname === '/api/stories' && req.method === 'POST') return send(201,store.createStory(user.id,await body(req)));
        const match = url.pathname.match(/^\/api\/(stories|chapters|branches)\/([1-9]\d*)(?:\/(fork|like|chapters|path))?$/);
        if (match) {
          const [,kind,rawId,action] = match, id = Number(rawId);
          if (!Number.isSafeInteger(id)) throw new AppError('IDが不正です。');
          if (req.method === 'GET' && !action && kind === 'stories') return send(200,store.story(id));
          if (req.method === 'GET' && !action && kind === 'chapters') return send(200,store.chapter(id,user.id));
          if (req.method === 'GET' && kind === 'branches' && action === 'path') return send(200,{chapters:store.path(id)});
          if (req.method === 'POST' && kind === 'chapters' && action === 'fork') return send(201,store.fork(user.id,id,await body(req)));
          if (req.method === 'PUT' && kind === 'chapters' && action === 'like') return send(200,store.like(user.id,id,(await body(req)).liked));
          if (req.method === 'POST' && kind === 'branches' && action === 'chapters') return send(201,store.append(user.id,id,await body(req)));
        }
        throw new AppError('APIが見つかりません。',404);
      }
      const file = staticFiles[url.pathname];
      if (file && ['GET','HEAD'].includes(req.method)) {
        const content = await readFile(new URL(`../public/${file[0]}`,import.meta.url));
        res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-cache'});return res.end(req.method === 'HEAD' ? undefined : content);
      }
      send(404,{error:'見つかりません。'});
    } catch(e) {
      if (!(e instanceof AppError)) console.error(e);
      if (!res.headersSent) send(e instanceof AppError ? e.status : 500,{error:e instanceof AppError ? e.message : 'サーバーエラーが発生しました。'});
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = new Store();
  const server = createApp({store});
  const {values} = parseArgs({options:{host:{type:'string'},port:{type:'string'},strictPort:{type:'boolean'}}});
  const port = Number(values.port || process.env.PORT || 3000), host = values.host || process.env.HOST || '127.0.0.1';
  server.listen(port,host,()=>console.log(`Novel Branches: http://${host}:${port}`));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{server.close(()=>{store.close();process.exit(0);});server.closeIdleConnections();});
}
