// Real elapsed expiry, verified HTTPS. Run alongside other checks; prints no tokens.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
process.loadEnvFile('deploy/.test/stack.env');
const origin=process.env.APP_ORIGIN;assert.equal(origin,'https://localhost:8443');
const response=await fetch(origin+'/id/realms/novel-branches/protocol/openid-connect/token',{method:'POST',body:new URLSearchParams({grant_type:'password',client_id:'novel-mcp',username:'test-member',password:process.env.TEST_MEMBER_PASSWORD,scope:'openid novels:read'})});
assert.equal(response.status,200);const {access_token}=await response.json();
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome'});
try{
 const p=await browser.newPage();await p.goto(origin+'/auth/login');await p.locator('#username').fill('test-member');await p.locator('#password').fill(process.env.TEST_MEMBER_PASSWORD);await p.locator('#kc-login').click();await p.locator('#write').click();await p.locator('#edit-title').fill('期限切れ下書き');await p.locator('#edit-chapterTitle').fill('第一話');await p.locator('#edit-body').fill('セッションが切れても残る本文');
 const exp=JSON.parse(Buffer.from(access_token.split('.')[1],'base64url')).exp;
 const cookies=await p.context().cookies();const end=Math.max(exp,cookies.find(c=>c.name==='__Host-session').expires)+7;
 console.log('Waiting for real Keycloak token and browser session expiry (about five minutes).');
 await new Promise(r=>setTimeout(r,Math.max(0,end*1000-Date.now())));
 const r=await fetch(origin+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});assert.equal(r.status,401);
 await p.locator('#edit-form button[type=submit]').click();await p.locator('#edit-form .error a').waitFor();assert.equal(await p.locator('#edit-body').inputValue(),'セッションが切れても残る本文');await p.locator('#edit-form .error a').click();await p.locator('#write').click();assert.equal(await p.locator('#edit-body').inputValue(),'セッションが切れても残る本文');
 console.log('PASS real expiry: MCP rejected; failed post retained draft; Keycloak SSO and draft restoration succeeded.');
}catch{console.error('FAIL expiry (details suppressed to avoid authentication URL disclosure)');process.exitCode=1;}finally{await browser.close();}
