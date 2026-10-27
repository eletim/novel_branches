import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { timingSafeEqual } from 'node:crypto';
import { Store, AppError } from './store.mjs';
import { rpc } from './mcp.mjs';

const staticFiles = {'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
function equal(a,b) { return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b)); }
async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 512000) throw new AppError('入力が大きすぎます。',413); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new AppError('JSONの形式が不正です。'); }
}
export function createApp({store = new Store(), mcpToken = process.env.MCP_TOKEN, origin = process.env.APP_ORIGIN, secureCookies = process.env.COOKIE_SECURE === 'true'} = {}) {
  const attempts = new Map();
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status,data) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(data === undefined ? undefined : JSON.stringify(data)); };
    try {
      const url = new URL(req.url,'http://localhost');
      const expectedOrigin = origin || `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin) throw new AppError('この接続元からの操作は許可されていません。',403);
      if (url.pathname === '/health') return send(200,{status:'ok'});
      if (url.pathname === '/mcp') {
        if (!mcpToken || !equal(req.headers.authorization,`Bearer ${mcpToken}`)) { res.setHeader('WWW-Authenticate','Bearer'); return send(401,{error:'MCP token required'}); }
        if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(405,{error:'Use POST; server-initiated SSE is not supported.'}); }
        if (!req.headers['content-type']?.includes('application/json')) return send(415,{error:'application/json required'});
        const accept = req.headers.accept || '';
        if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return send(406,{error:'Accept application/json and text/event-stream'});
        const version = req.headers['mcp-protocol-version'];
        if (version && !['2025-06-18','2025-03-26','2025-11-25'].includes(version)) return send(400,{error:'Unsupported MCP protocol version'});
        let message;
        try { message = await body(req); } catch { return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); }
        const result = rpc(store,message);
        return send(result ? 200 : 202,result || undefined);
      }
      if (url.pathname.startsWith('/api/')) {
        let token = req.headers.cookie?.split(';').map(c=>c.trim()).find(c=>c.startsWith('session='))?.slice(8);
        const user = store.session(token);
        if (url.pathname === '/api/me' && req.method === 'GET') return send(200,{user});
        if (url.pathname === '/api/login' && req.method === 'POST') {
          const key = req.socket.remoteAddress;
          const now = Date.now(), attempt = attempts.get(key);
          if (attempt && attempt.until > now && attempt.count >= 15) throw new AppError('しばらく待ってからログインしてください。',429);
          if (attempts.size > 1000) for (const [k,v] of attempts) if(v.until < now) attempts.delete(k);
          const a = !attempt || attempt.until < now ? {count:0,until:now+15*60000} : attempt;
          a.count++; attempts.set(key,a);
          const input = await body(req), login = store.login(input.username,input.password);
          attempts.delete(key);
          res.setHeader('Set-Cookie',`session=${login.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureCookies ? '; Secure' : ''}`);
          return send(200,{user:login.user});
        }
        if (!user) throw new AppError('ログインしてください。',401);
        if (req.method !== 'GET' && !req.headers['content-type']?.includes('application/json')) throw new AppError('application/jsonで送信してください。',415);
        if (url.pathname === '/api/logout' && req.method === 'POST') {store.logout(token);res.setHeader('Set-Cookie','session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return send(200,{ok:true});}
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
