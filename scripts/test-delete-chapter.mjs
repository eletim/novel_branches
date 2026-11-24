// Disposable fixture only: never deletes production content.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
const store=new Store(':memory:');
const a=store.addUser('delete-author','Author','password-author'),b=store.addUser('delete-other','Other','password-other');
const server=createApp({store,auth:{mode:'local'},basePath:'/novel'});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}/novel/`;
const browser=await chromium.launch(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{});
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const make=()=>store.createStory(a.id,{title:'削除の確認',chapterTitle:'最初の話',body:'残す本文'});
const append=(s,user=a)=>store.append(user.id,s.branchId,{title:'続き',body:'続きの本文',expectedHeadId:store.path(s.branchId).at(-1).id});
async function open(id,branch){await page.goto(base);await page.locator('.cards').waitFor();await page.goto(base+`#chapter/${id}?branch=${branch}`);await page.locator('.reader-body').waitFor();await page.locator('#open-editor').click();}
async function confirm(){await page.locator('#delete-chapter').click();await page.locator('#delete-ack').check();}
try{
 await page.goto(base);await page.locator('#username').fill('delete-author');await page.locator('#password').fill('password-author');await page.locator('#login button').click();await page.locator('.cards').waitFor();
 const s=make(),tail=append(s);await open(tail.chapterId,s.branchId);await page.locator('#delete-chapter').click();
 assert.equal(await page.locator('#cancel-delete').evaluate(e=>e===document.activeElement),true);
 await page.locator('#delete-chapter-form [type=submit]').click();assert.ok(store.chapter(tail.chapterId));
 await page.locator('#cancel-delete').click();assert.ok(store.chapter(tail.chapterId));
 await open(tail.chapterId,s.branchId);await confirm();
 await page.route('**/api/chapters/*',route=>route.request().method()==='DELETE'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'通信失敗'})}):route.continue());
 await page.locator('#delete-chapter-form [type=submit]').click();await page.locator('#delete-chapter-form .error').filter({hasText:'通信失敗'}).waitFor();assert.ok(store.chapter(tail.chapterId));await page.unroute('**/api/chapters/*');
 for(const width of [375,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.locator('#delete-chapter-form [type=submit]').click();await page.locator('.toc-list').waitFor();assert.deepEqual(store.path(s.branchId).map(c=>c.id),[s.chapterId]);
 const t=append(s);await open(t.chapterId,s.branchId);await confirm();append(s,b);await page.locator('#delete-chapter-form [type=submit]').click();await page.locator('#delete-chapter-form .error').filter({hasText:'続話'}).waitFor();assert.ok(store.chapter(t.chapterId));
 await open(s.chapterId,s.branchId);await page.locator('#delete-chapter').click();assert.equal(await page.locator('#delete-chapter-form').count(),0);assert.match(await page.locator('#editor').innerText(),/続話/);
 const other=store.path(s.branchId).at(-1).id;await open(other,s.branchId);assert.equal(await page.locator('#delete-chapter').count(),0);
 const fork=store.alternate(a.id,t.chapterId,{title:'別案',body:'別案の本文'});await open(fork.chapterId,fork.branchId);await confirm();await page.locator('#delete-chapter-form [type=submit]').click();await page.locator('.toc-list').waitFor();assert.match(page.url(),new RegExp('branch='+s.branchId+'$'));assert.ok(store.chapter(s.chapterId));
 const single=make();await open(single.chapterId,single.branchId);await confirm();assert.match(await page.locator('#editor').innerText(),/作品全体も削除/);await page.locator('#delete-chapter-form [type=submit]').click();await page.locator('.cards').waitFor();assert.throws(()=>store.chapter(single.chapterId));
 assert.deepEqual(errors,[]);console.log('PASS deletion browser: ownership, confirmation, cancel, failure recovery, concurrent continuation, branch/story removal and mobile layout');
}finally{await browser.close();await new Promise(r=>server.close(r));store.close();}
