// Real elapsed browser-session expiry on the published VPS. No password grant or tokens logged.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
process.loadEnvFile('deploy/.test/public.env');
const home=process.env.APP_ORIGIN+process.env.APP_BASE_PATH+'/';
assert.equal(home,'https://eletim.jp/novel/');
const browser=await chromium.launch();
try {
 const p=await browser.newPage();
 await p.goto(home+'auth/login');
 await p.locator('#username').fill(process.env.TEST_USER_PREFIX+'member');
 await p.locator('#password').fill(process.env.TEST_MEMBER_PASSWORD);
 await p.locator('#kc-login').click();await p.locator('#write').click();
 await p.locator('#edit-title').fill('公開URLの期限切れ下書き');
 await p.locator('#edit-chapterTitle').fill('第一話');
 const draft='実際のセッション期限後も本文を保存する';
 await p.locator('#edit-body').fill(draft);
 const cookie=(await p.context().cookies()).find(c=>c.name==='__Host-session');
 assert.ok(cookie.secure&&cookie.httpOnly&&cookie.path==='/');
 const end=cookie.expires*1000+2500;
 while(Date.now()<end){console.log('Waiting for actual session expiry; remaining seconds:',Math.ceil((end-Date.now())/1000));await new Promise(r=>setTimeout(r,Math.min(30000,end-Date.now())));}
 await p.locator('#edit-form button[type=submit]').click();
 await p.locator('#edit-form .error a').waitFor();
 assert.equal(await p.locator('#edit-body').inputValue(),draft);
 assert.equal(new URL(await p.locator('#edit-form .error a').getAttribute('href'),home).pathname,'/novel/auth/login');
 await p.locator('#edit-form .error a').click();await p.locator('#write').click();
 assert.equal(new URL(p.url()).pathname,'/novel/');
 assert.equal(await p.locator('#edit-body').inputValue(),draft);
 await p.locator('#close-editor').click();await p.locator('#logout').click();await p.locator('.login').waitFor();
 console.log('PASS public expiry: actual cookie expiry, failed post retains draft, /novel/ SSO reauthentication and draft restoration, logout');
} catch {console.error('FAIL public expiry (authentication details suppressed)');process.exitCode=1;}
finally {await browser.close();}
