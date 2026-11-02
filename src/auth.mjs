import * as oidc from 'openid-client';
import { createRemoteJWKSet, jwtVerify, customFetch as joseFetch } from 'jose';
import { randomBytes } from 'node:crypto';
import { AppError } from './store.mjs';

export function cookie(req, name) {
  return req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
}
export function sessionCookie(token, { secure = false, maxAge = 0 } = {}) {
  return `${secure ? '__Host-session' : 'session'}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
// Keep the web origin separate from its mount path (Origin headers never include paths).
export function appBasePath(env = process.env) {
  const path = (env.APP_BASE_PATH || '').replace(/\/$/, '');
  if (path && !/^(\/[A-Za-z0-9_-]+)+$/.test(path)) throw Error('Invalid APP_BASE_PATH');
  return path;
}
export function authSettings(env = process.env) {
  const mode = env.AUTH_MODE || 'local';
  if (!['local','oidc'].includes(mode)) throw Error('AUTH_MODE must be local or oidc');
  if (env.NODE_ENV === 'production' && mode !== 'oidc') throw Error('Production requires AUTH_MODE=oidc');
  const basePath = appBasePath(env);
  if (mode === 'local') return { mode, basePath };
  const origin = new URL(env.APP_ORIGIN), issuer = new URL(env.OIDC_ISSUER);
  const allowHttp = env.OIDC_ALLOW_HTTP === 'true' && env.NODE_ENV !== 'production';
  if (origin.origin !== env.APP_ORIGIN || issuer.search || issuer.hash || issuer.username || issuer.password || origin.username || origin.password) throw Error('Invalid OIDC URL configuration');
  if (!allowHttp && (origin.protocol !== 'https:' || issuer.protocol !== 'https:' || env.COOKIE_SECURE !== 'true')) throw Error('OIDC requires HTTPS and COOKIE_SECURE=true');
  if (!env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET || env.OIDC_CLIENT_SECRET.length < 32) throw Error('OIDC client ID and a secret of at least 32 characters are required');
  return {mode,basePath,origin:origin.origin,issuer:issuer.href.replace(/\/$/,''),clientId:env.OIDC_CLIENT_ID,clientSecret:env.OIDC_CLIENT_SECRET,memberRole:env.OIDC_MEMBER_ROLE || 'novel-member',mcpAudience:env.OIDC_MCP_AUDIENCE || origin.origin+basePath+'/mcp',internalIssuer:env.OIDC_INTERNAL_ISSUER,allowHttp};
}
export class OidcAuth {
  constructor(store, settings) {
    this.store = store;
    this.settings = settings;
    this.configuration = null;
    this.jwks = null;
    this.fetch = async (input, options) => {
      let url = String(input);
      if (settings.internalIssuer && url.startsWith(settings.issuer+'/')) {
        url = settings.internalIssuer.replace(/\/$/,'')+url.slice(settings.issuer.length);
      }
      return fetch(url, {...options, redirect:'error',signal:AbortSignal.timeout(10000)});
    };
  }
  async config() {
    if (!this.configuration) {
      this.configuration = oidc.discovery(new URL(this.settings.issuer),this.settings.clientId,
        {id_token_signed_response_alg:'RS256',[oidc.clockTolerance]:5},oidc.ClientSecretPost(this.settings.clientSecret),
        {[oidc.customFetch]:this.fetch,timeout:10,execute:[oidc.enableNonRepudiationChecks,...(this.settings.allowHttp ? [oidc.allowInsecureRequests] : [])]})
        .then(config=>{
          const metadata = config.serverMetadata();
          for (const key of ['authorization_endpoint','token_endpoint','jwks_uri','end_session_endpoint']) {
            if (!metadata[key]?.startsWith(this.settings.issuer+'/')) throw Error('Unexpected Keycloak endpoint');
          }
          this.jwks = createRemoteJWKSet(new URL(metadata.jwks_uri),{[joseFetch]:this.fetch,timeoutDuration:10000,cooldownDuration:5000});
          return config;
        }).catch(e=>{this.configuration=null;throw e;});
    }
    return this.configuration;
  }
  async start() {
    const config = await this.config();
    const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier(), browser = randomBytes(32).toString('hex');
    this.store.saveOidcLogin({state,nonce,verifier,browser});
    const location = oidc.buildAuthorizationUrl(config,{redirect_uri:this.settings.origin+(this.settings.basePath || '')+'/auth/callback',scope:'openid profile',response_type:'code',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256'});
    return {location:location.href,browser};
  }
  async callback(url, browser) {
    const state = url.searchParams.get('state');
    const login = this.store.consumeOidcLogin(state,browser);
    if (!login) throw new AppError('ログインの確認情報が無効または期限切れです。もう一度ログインしてください。',400);
    try {
      const config = await this.config();
      const tokens = await oidc.authorizationCodeGrant(config,url,{expectedState:state,expectedNonce:login.nonce,pkceCodeVerifier:login.verifier,idTokenExpected:true});
      const claims = tokens.claims();
      if (!Array.isArray(claims.roles) || !claims.roles.includes(this.settings.memberRole)) throw new AppError('このサイトへの参加権限がありません。管理者に確認してください。',403);
      const user = this.store.oidcUser(this.settings.issuer,claims.sub,claims.name || claims.preferred_username || '参加者');
      const lifetime = Math.min(900,Math.floor(claims.exp-Date.now()/1000));
      if (lifetime < 1) throw new AppError('認証が期限切れです。再ログインしてください。',401);
      return {...this.store.createSession(user.id,{lifetimeMs:lifetime*1000,authType:'oidc',issuer:this.settings.issuer,subject:claims.sub,sid:claims.sid || null,idToken:tokens.id_token}),maxAge:lifetime};
    } catch(e) {
      if (e instanceof AppError) throw e;
      // Provider errors may contain codes or tokens; do not log the upstream error.
      throw new AppError('認証を確認できませんでした。もう一度ログインしてください。',401);
    }
  }
  async logoutUrl(token) {
    const idToken = this.store.sessionDetails(token)?.id_token;
    const config = await this.config();
    return oidc.buildEndSessionUrl(config,{client_id:this.settings.clientId,post_logout_redirect_uri:this.settings.origin+(this.settings.basePath || '')+'/',...(idToken ? {id_token_hint:idToken} : {})}).href;
  }
  async verifyMcp(authorization) {
    if (!authorization?.startsWith('Bearer ')) throw new AppError('MCPのアクセストークンが必要です。',401);
    try {
      await this.config();
      const {payload} = await jwtVerify(authorization.slice(7),this.jwks,{issuer:this.settings.issuer,audience:this.settings.mcpAudience,algorithms:['RS256'],requiredClaims:['sub','exp','iat'],clockTolerance:5});
      // OIDC/refresh scopes are allowed additions, never substitutes for read permission.
      if (payload.typ !== 'Bearer' || !Array.isArray(payload.roles) || !payload.roles.includes(this.settings.memberRole) || typeof payload.scope !== 'string' || !payload.scope.split(' ').includes('novels:read')) throw Error('Missing access');
      return payload;
    } catch {throw new AppError('MCPの認証または閲覧権限を確認できません。',401);}
  }
  async backchannelLogout(token) {
    try {
      await this.config();
      const {payload} = await jwtVerify(token,this.jwks,{issuer:this.settings.issuer,audience:this.settings.clientId,algorithms:['RS256'],requiredClaims:['iat','jti','events'],maxTokenAge:'2m',clockTolerance:5});
      const event = payload.events?.['http://schemas.openid.net/event/backchannel-logout'];
      if (!event || typeof event !== 'object' || Array.isArray(event) || 'nonce' in payload || (!payload.sid && !payload.sub) || (payload.sid !== undefined && typeof payload.sid !== 'string') || (payload.sub !== undefined && typeof payload.sub !== 'string')) throw Error('Invalid logout event');
      this.store.revokeOidcSessions(this.settings.issuer,payload.sid,payload.sub);
    } catch {throw new AppError('ログアウト通知を確認できません。',400);}
  }
}
