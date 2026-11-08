// Disposable local fixture, or dedicated verification users on the deployed site.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
const local=!process.argv.includes('--public');let store,server,origin;
if(local){store=new Store(':memory:');store.addUser('test-member','Test member','password-member');store.addUser('test-other','Test other','password-other');server=createApp({store,auth:{mode:'local'},basePath:'/novel'});server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}/novel`;}
else{process.loadEnvFile('deploy/.test/public.env');origin=process.env.APP_ORIGIN+process.env.APP_BASE_PATH;assert.equal(origin,'https://eletim.jp/novel');}
const browser=await chromium.launch({...process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}});
const ctx=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1280,height:900}}),other=await browser.newContext(),page=await ctx.newPage(),b=await other.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));
async function login(p,name){await p.goto(origin+'/');if(!local)await p.locator('.login a').click();await p.locator('#username').fill(local?'test-'+name:process.env.TEST_USER_PREFIX+name);await p.locator('#password').fill(local?'password-'+name:process.env['TEST_'+name.toUpperCase()+'_PASSWORD']);await p.locator(local?'#login button':'#kc-login').click();await p.locator('.cards').waitFor();}
async function api(p,path,method='GET',data){return p.evaluate(async({path,method,data})=>{const r=await fetch('/novel/api'+path,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};},{path,method,data});}
async function go(p,hash,selector){await p.goto(origin+'/'+hash);await p.locator(selector).waitFor();}
const out='deploy/.test/evidence/additions-'+(local?'local':'public');mkdirSync(out,{recursive:true});let stage='login';
try{
 await login(page,'member');await login(b,'other');
 const created=(await api(page,'/stories','POST',{title:'追加機能の確認 '+Date.now(),summary:'専用の検証作品',chapterTitle:'始まり',body:'あ😀\nい\n う'})).data;
 let story=(await api(page,'/stories/'+created.storyId)).data;
 assert.equal((await api(page,'/stories/'+story.id,'PATCH',{hiddenFromHome:true,expectedRevision:story.revision})).status,200);
 const second=(await api(b,`/branches/${created.branchId}/chapters`,'POST',{title:'次の話',body:'二話の本文',expectedHeadId:created.chapterId})).data;
 const third=(await api(page,`/branches/${created.branchId}/chapters`,'POST',{title:'終わり',body:'三話の本文',expectedHeadId:second.chapterId})).data;
 stage='counts and copy';await go(page,'#story/'+story.id,'.toc-list');assert.deepEqual(await page.locator('.character-count').allTextContents(),['5字','5字','5字']);
 await page.locator('#copy-path').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('コピーしました'));
 const exported=await page.evaluate(()=>navigator.clipboard.readText());assert.ok(exported.startsWith(story.title+'\n\n第1話　始まり'));assert.ok(exported.endsWith('三話の本文'));
 await go(page,'#chapter/'+second.chapterId,'.reader-body');await page.locator('#copy-chapter').click();await page.waitForFunction(async expected=>(await navigator.clipboard.readText())===expected,story.title+'\n\n第2話　次の話\n\n二話の本文');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),story.title+'\n\n第2話　次の話\n\n二話の本文');
 stage='comments';assert.equal(await page.locator('.comments-panel').getAttribute('open'),null);await page.locator('.comments-panel summary').click();await page.locator('#comment-body').fill('<img src=x onerror=alert(1)>\n感想 😀');await page.locator('#comment-form [type=submit]').click();await page.locator('.comment-body').waitFor();assert.equal(await page.locator('#more-comments').isVisible(),false);assert.equal(await page.locator('#retry-comments').isVisible(),false);assert.equal(await page.locator('.comment-body img').count(),0);assert.match(await page.locator('.comment-body').innerText(),/感想/);
 await go(b,'#chapter/'+second.chapterId,'.reader-body');await b.locator('.comments-panel summary').click();await b.locator('.comment-body').waitFor();assert.equal(await b.locator('.delete-comment').count(),0);
 // Failed sends leave the typed draft intact, including after a reload.
 await page.route('**/api/chapters/*/comments',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"一時的な通信失敗"}'}):route.continue());
 await page.locator('#comment-body').fill('未送信の感想');await page.locator('#comment-form [type=submit]').click();await page.locator('#comment-form .error').filter({hasText:'通信失敗'}).waitFor();assert.equal(await page.locator('#comment-body').inputValue(),'未送信の感想');await page.unroute('**/api/chapters/*/comments');
 await page.reload();await page.locator('.reader-body').waitFor();await page.locator('.comments-panel summary').click();assert.equal(await page.locator('#comment-body').inputValue(),'未送信の感想');
 for(const width of [1280,375]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${out}/reader-${width}.png`,fullPage:true});}
 page.once('dialog',d=>d.accept());await page.locator('.delete-comment').click();await page.locator('.comment-body').waitFor({state:'detached'});
 stage='reorder and shared prefix';await go(b,'#story/'+story.id,'.toc-list');assert.equal(await b.locator('#reorder-chapters').count(),0);
 const fork=(await api(b,`/chapters/${created.chapterId}/fork`,'POST',{title:'別の道',body:'分岐本文'})).data;
 await go(page,'#story/'+story.id,'.toc-list');await page.locator('#reorder-chapters').click();assert.equal(await page.locator('#reorder-list li').count(),2);await page.locator('#reorder-list [data-index="0"][data-step="1"]').click();await page.locator('#save-order').click();await page.locator('#editor').waitFor({state:'hidden'});await page.locator('.toc-list').waitFor();assert.deepEqual(await page.locator('.toc-item').evaluateAll(es=>es.map(e=>Number(e.dataset.chapter))),[created.chapterId,third.chapterId,second.chapterId]);
 assert.deepEqual((await api(page,`/branches/${fork.branchId}/path`)).data.chapters.map(c=>c.id),[created.chapterId,fork.chapterId]);
 for(const width of [1280,375]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${out}/toc-${width}.png`,fullPage:true});}
 // Clipboard denial offers exact selectable text, without claiming successful copying.
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{write:async()=>{throw Error('denied');},writeText:async()=>{throw Error('denied');}}});});await page.locator('#copy-path').click();await page.locator('#copy-text').waitFor();assert.equal(await page.locator('#copy-text').inputValue(),(await api(page,`/branches/${created.branchId}/export`)).data.text);await page.locator('#close-copy').click();
 assert.equal((await page.request.get(origin+'/favicon.svg')).status(),200);assert.deepEqual(errors,[]);
 console.log('PASS additions: desktop/mobile counts, route/chapter title copy and denial fallback, escaped comments, draft recovery, owner deletion, manager reorder and unchanged shared path; '+(local?'local':'public'));
}catch(e){console.error('FAILED stage: '+stage);throw e;}finally{await browser.close();if(server)await new Promise(r=>server.close(r));store?.close();}
