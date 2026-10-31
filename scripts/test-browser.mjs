// Real Chrome + Keycloak, verified TLS. No traces/HARs (authentication secrets).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const config=process.env.TEST_STACK_ENV||'deploy/.test/stack.env';
assert.ok(['deploy/.test/stack.env','deploy/.test/vpn.env','deploy/.test/public.env'].includes(config));
process.loadEnvFile(config);
const origin=process.env.APP_ORIGIN;
assert.ok((config==='deploy/.test/public.env' && origin==='https://eletim.jp')||origin==='https://localhost:8443'||(config==='deploy/.test/vpn.env' && /^https:\/\/[a-z0-9.-]+\.ts\.net:8443$/.test(origin)));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(config==='deploy/.test/public.env'?chromium.executablePath():'/usr/bin/google-chrome'),headless:true,...(process.env.TEST_PROXY?{proxy:{server:process.env.TEST_PROXY}}:{})});
const out='deploy/.test/evidence';mkdirSync(out,{recursive:true});
const errors=[];
const context=await browser.newContext({viewport:{width:1280,height:900}});
context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
const a=await context.newPage();
const bctx=await browser.newContext({viewport:{width:1280,height:900}}),b=await bctx.newPage();
async function login(p,name){await p.goto(origin);await p.locator('.login a').click();await p.locator('#username').fill((process.env.TEST_USER_PREFIX||'test-')+name);await p.locator('#password').fill(process.env['TEST_'+name.toUpperCase()+'_PASSWORD']);await p.locator('#kc-login').click();await p.locator('#write').waitFor();}
async function go(p,hash){await p.goto(origin+'/'+hash);await p.locator(hash.startsWith('#chapter')?'.reader-body':hash.startsWith('#story')?'.branch-list':'.cards').waitFor();}
async function post(p,values){for(const [key,value] of Object.entries(values))await p.locator('#edit-'+key).fill(value);await p.locator('#edit-form button[type=submit]').click();await p.locator('#editor').waitFor({state:'hidden'});await p.locator('.reader-heading h1').filter({hasText:values.chapterTitle||values.title}).waitFor();return Number(new URL(p.url()).hash.match(/chapter\/(\d+)/)[1]);}
async function api(p,path,method='GET',data){return p.evaluate(async({path,method,data})=>{const r=await fetch('/api'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};},{path,method,data});}
const stamp=Date.now(),title='ブラウザ検証 '+stamp;
try{
 await login(a,'member');await login(b,'other');console.log('PASS browser: two Keycloak logins, trusted TLS');
 await a.locator('#write').click();const first=await post(a,{title,summary:'共通・分岐・入れ子の実操作',chapterTitle:'共通の第一話',body:'雨の駅で、物語が始まった。\n二人は違う未来を選ぶ。'});
 const root=(await api(a,'/chapters/'+first)).data,story=root.story_id;
 await a.locator('#append').click();const second=await post(a,{title:'本編第二話',body:'本編の道を進む。'});
 await go(b,'#chapter/'+first);await b.locator('#fork').click();const fork=await post(b,{branchTitle:'Bの世界',title:'分岐第二話',body:'分岐の道を歩く。'});
 await b.locator('#append').click();const third=await post(b,{title:'分岐第三話',body:'別世界の続きを読む。'});
 await go(a,'#chapter/'+fork);await a.locator('#fork').click();const nested=await post(a,{branchTitle:'入れ子の世界',title:'入れ子第三話',body:'さらに別の未来へ。'});
 await go(b,'#chapter/'+third);await b.locator('#like').click();await b.waitForFunction(()=>!document.querySelector('#like').disabled);assert.equal(await b.locator('#like').getAttribute('aria-pressed'),'true');await b.locator('#like').click();await b.waitForFunction(()=>!document.querySelector('#like').disabled);assert.equal(await b.locator('#like').getAttribute('aria-pressed'),'false');await b.locator('#like').click();await b.waitForFunction(()=>!document.querySelector('#like').disabled);
 await api(b,`/chapters/${third}/like`,'PUT',{liked:true});assert.equal((await api(a,'/chapters/'+third)).data.likes,1);
 assert.equal((await api(b,`/branches/${root.branch_id}/chapters`,'POST',{title:'禁止',body:'禁止',expectedHeadId:second})).status,403);
 const detail=(await api(a,'/stories/'+story)).data;
 const forkBranch=detail.branches.find(x=>x.head_id===third),nestedBranch=detail.branches.find(x=>x.head_id===nested);
 for(const [branch,ids] of [[root.branch_id,[first,second]],[forkBranch.id,[first,fork,third]],[nestedBranch.id,[first,fork,nested]]])assert.deepEqual((await api(a,`/branches/${branch}/path`)).data.chapters.map(c=>c.id),ids);
 console.log('PASS browser: create, append, fork, nested fork, votes; API ownership and paths');
 for(const [name,expected] of [['本編',['本編第二話']],['入れ子の世界',['分岐第二話','入れ子第三話']]]){
  await go(a,'#story/'+story);await a.locator('.branch-item').filter({has:a.locator('h3',{hasText:name})}).getByText('最初から読む →').click();await a.locator('.reader-body').waitFor();
  for(const chapter of expected){await a.getByText('選んだ展開の次の話 → '+chapter).click();await a.locator('.reader-heading h1').filter({hasText:chapter}).waitFor();}
  await a.locator('.reader-shell > .back').first().click();await a.locator('.branch-list').waitFor();
 }
 await go(a,'#story/'+story);await a.locator('.branch-item').filter({has:a.locator('h3',{hasText:'Bの世界'})}).getByText('最初から読む →').click();await a.locator('.reader-body').waitFor();
 // Capture the current routing behaviour for the regression check.
 const firstReadUrl=a.url();
 assert.ok(firstReadUrl.includes("?branch="+forkBranch.id),"Reading a branch from its first chapter must preserve the selected branch");
 await a.getByText('選んだ展開の次の話 → 分岐第二話').click();await a.locator('.reader-body').filter({hasText:'分岐の道を歩く。'}).waitFor();
 await a.getByText('選んだ展開の次の話 → 分岐第三話').click();await a.locator('.reader-body').filter({hasText:'別世界の続きを読む。'}).waitFor();
 await a.screenshot({path:out+'/reader-desktop.png',fullPage:true});
 const css=await a.locator('.reader-body').evaluate(e=>{const s=getComputedStyle(e);return {font:s.fontFamily,size:s.fontSize,line:s.lineHeight,width:e.getBoundingClientRect().width,background:getComputedStyle(document.body).backgroundColor};});
 assert.equal(css.size,'16px');assert.equal(css.line,'28.8px');assert.equal(css.width,600);assert.equal(css.background,'rgb(237, 247, 255)');
 const cdp=await context.newCDPSession(a);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const dom=await cdp.send('DOM.getDocument');const node=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'.reader-body'});const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
 await a.setViewportSize({width:375,height:812});assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await a.screenshot({path:out+'/reader-mobile.png',fullPage:true});
 await go(a,'#');assert.notEqual(await a.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(237, 247, 255)');assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await a.locator('[name=q]').fill(title);await Promise.all([a.waitForResponse(r=>new URL(r.url()).pathname==='/api/stories' && new URL(r.url()).searchParams.get('q')===title),a.locator('#search button').click()]);await a.locator('.card h3').filter({hasText:title}).waitFor();assert.equal(await a.locator('.card').count(),1);
 await a.locator('[name=sort]').selectOption('popular');await a.locator('#search button').click();await a.waitForURL(/sort=popular/);
 for(const sort of ['new','popular']){
  await go(a,'#?sort='+sort);const expected=(await api(a,'/stories?sort='+sort+'&limit=12')).data.stories.map(s=>s.id);assert.deepEqual(await a.locator('.card').evaluateAll(xs=>xs.map(x=>Number(x.hash.split('/')[1]))),expected);
 }
 await go(a,'#chapter/'+second);await a.locator('#append').click();await a.locator('#edit-title').fill('下書き');await a.locator('#edit-body').fill('保存して復元する本文');await a.locator('#close-editor').click();await a.reload();await a.locator('#append').click();assert.equal(await a.locator('#edit-body').inputValue(),'保存して復元する本文');
 await a.route('**/api/branches/*/chapters',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'検証用一時障害'})}));await a.locator('#edit-form button[type=submit]').click();await a.locator('#edit-form .error').filter({hasText:'検証用一時障害'}).waitFor();assert.equal(await a.locator('#edit-body').inputValue(),'保存して復元する本文');await a.unroute('**/api/branches/*/chapters');
 const tab=await context.newPage();await go(tab,'#chapter/'+second);await tab.locator('#append').click();const concurrent=await post(tab,{title:'別タブの続話',body:'先に投稿した話'});
 await a.locator('#edit-form button[type=submit]').click();await a.locator('#edit-form .error').filter({hasText:/./}).waitFor();assert.equal(await a.locator('#edit-body').inputValue(),'保存して復元する本文');await a.locator('#close-editor').click();await tab.close();
 await a.goto(origin+'/#chapter/99999999');await a.getByText('読み込めませんでした').waitFor();await a.getByText('一覧へ戻る').click();await a.locator('.cards').waitFor();
 await go(a,'#chapter/'+first);await a.locator('.continuations a').first().click();await a.locator('.reader-body').waitFor();await a.goBack();await a.locator('.reader-body').waitFor();await a.goForward();await a.locator('.reader-body').waitFor();await a.reload();await a.locator('.reader-body').waitFor();
 await a.locator('#write').click();await a.locator('#edit-title').fill('誤投稿防止 '+stamp);await a.locator('#edit-chapterTitle').fill('防止');await a.locator('#edit-body').fill('Aの下書き');
 const switchTab=await context.newPage();await go(switchTab,'#');await switchTab.locator('#logout').click();await switchTab.locator('.login').waitFor();await login(switchTab,'other');
 await a.locator('#edit-form button[type=submit]').click();await a.locator('#edit-form .error').filter({hasText:'別のユーザーに切り替わりました'}).waitFor();assert.equal(await a.locator('#edit-body').inputValue(),'Aの下書き');assert.equal((await api(switchTab,'/stories?q='+encodeURIComponent('誤投稿防止 '+stamp))).data.stories.length,0);await a.locator('#close-editor').click();await a.reload();await a.locator('#logout').waitFor();await switchTab.close();
 console.log('PASS browser: stale tab cannot post A draft as B');
 await a.locator('#logout').click();await a.locator('.login').waitFor();assert.notEqual(await a.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(237, 247, 255)');
 await login(a,'other');assert.equal(await a.locator('.username').textContent(),'Test other');await a.locator('#write').click();assert.equal(await a.locator('#edit-body').inputValue(),'');await a.locator('#close-editor').click();
 const denied=await browser.newContext(),d=await denied.newPage();await d.goto(origin+'/auth/login');await d.locator('#username').fill((process.env.TEST_USER_PREFIX||'test-')+'outsider');await d.locator('#password').fill(process.env.TEST_OUTSIDER_PASSWORD);await d.locator('#kc-login').click();await d.getByText(/参加権限がありません/).waitFor();await denied.close();
 assert.deepEqual(errors,[]);
 writeFileSync(out+'/browser.json',JSON.stringify({story,first,second,fork,third,nested,concurrent,forkBranch:forkBranch.id,nestedBranch:nestedBranch.id,css,fonts:fonts.fonts,firstReadUrl,errors},null,2));
 console.log('PASS browser: CSS/mobile, search/sort, drafts/reload, concurrent conflict retains text, navigation/error recovery, logout/user switch, denied role');
}catch(e){let message=(e.message+'\nPage: '+new URL(a.url()).pathname+'\n'+(await a.locator('body').innerText().catch(()=>'' )).slice(0,700)).replace(/https:\/\/[^\s]+/g,'[URL omitted]');for(const [key,value] of Object.entries(process.env))if(/PASSWORD|SECRET/.test(key)&&value)message=message.replaceAll(value,'[secret omitted]');console.error('FAIL browser:',message);process.exitCode=1;}finally{await browser.close();}
