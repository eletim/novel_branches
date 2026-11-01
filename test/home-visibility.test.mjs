import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {rpc} from '../src/mcp.mjs';
import {selectReading} from '../public/reading.mjs';
test('作品表示設定は作者のみ、検索・票順・ページ送りと独立したMCP閲覧範囲',async()=>{
 const store=new Store(':memory:'),a=store.addUser('alice','Alice','alice-password'),b=store.addUser('bob','Bob','bob-password');
 const stories=Array.from({length:15},(_,i)=>store.createStory(a.id,{title:'Find '+i,summary:i%2?'needle':'other',chapterTitle:'first',body:'body'}));
 const hidden=stories[12];store.like(b.id,hidden.chapterId,true);
 store.setStoryVisibility(a.id,hidden.storyId,{hiddenFromHome:true});
 assert.throws(()=>store.setStoryVisibility(b.id,hidden.storyId,{hiddenFromHome:false}),e=>e.status===403);
 assert.throws(()=>store.setStoryVisibility(a.id,hidden.storyId,{hiddenFromHome:'true'}),e=>e.status===400);
 assert.throws(()=>store.setStoryVisibility(a.id,hidden.storyId,{hiddenFromHome:false,author_id:b.id}),e=>e.status===400);
 assert.equal(store.story(stories[0].storyId).hidden_from_home,0);
 assert.equal(store.story(hidden.storyId).main_branch_id,hidden.branchId);
 const visible=store.listStories({query:'Find',includeHidden:false,limit:100});assert.equal(visible.length,14);assert.ok(!visible.some(s=>s.id===hidden.storyId));
 assert.equal(store.listStories({query:'needle',includeHidden:false,limit:100}).length,7);
 assert.equal(store.listStories({sort:'popular'})[0].id,hidden.storyId);
 assert.ok(store.listStories({sort:'popular',includeHidden:false}).every(s=>s.id!==hidden.storyId));
 assert.deepEqual([...store.listStories({includeHidden:false,limit:12}),...store.listStories({includeHidden:false,limit:12,offset:12})].map(s=>s.id),visible.map(s=>s.id));
 const listed=rpc(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_stories',arguments:{query:'Find',limit:100}}}).result.structuredContent.stories;
 assert.equal(listed.length,15);assert.ok(listed.some(s=>s.id===hidden.storyId));
 assert.equal(rpc(store,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_story',arguments:{storyId:hidden.storyId}}}).result.structuredContent.hidden_from_home,1);
 const server=createApp({store,basePath:'/novel',secureCookies:false});server.listen(0,'127.0.0.1');await once(server,'listening');const home=`http://127.0.0.1:${server.address().port}/novel/api`;
 const request=(path,method='GET',body,cookie)=>fetch(home+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 try{
  const login=async(username)=>(await request('/login','POST',{username,password:username+'-password'})).headers.get('set-cookie').split(';')[0];const alice=await login('alice'),bob=await login('bob');
  assert.equal((await request('/stories/'+hidden.storyId,'PATCH',{hiddenFromHome:false})).status,401);
  assert.equal((await request('/stories/'+hidden.storyId,'PATCH',{hiddenFromHome:false},bob)).status,403);
  for(const sort of ['new','popular']){
   const normal=await (await request('/stories?q=Find&sort='+sort+'&limit=12', 'GET',null,alice)).json(),next=await(await request('/stories?q=Find&sort='+sort+'&limit=12&offset=12','GET',null,alice)).json();
   assert.equal(normal.stories.length,12);assert.equal(next.stories.length,2);assert.ok([...normal.stories,...next.stories].every(s=>s.id!==hidden.storyId));
   const all=await(await request('/stories?q=Find&sort='+sort+'&limit=100&view=all','GET',null,alice)).json();assert.equal(all.stories.length,15);assert.ok(all.stories.some(s=>s.id===hidden.storyId));
  }
  assert.equal((await request('/stories/'+hidden.storyId,'GET',null,bob)).status,200);
  assert.equal((await request('/chapters/'+hidden.chapterId,'GET',null,bob)).status,200);
  assert.equal((await request('/stories/'+hidden.storyId,'PATCH',{hiddenFromHome:false},alice)).status,200);
  assert.equal((await(await request('/stories?limit=100','GET',null,bob)).json()).stories.length,15);
 }finally{await new Promise(r=>server.close(r));store.close();}
});
test('v3からの追加移行は既存作品を通常表示とし、最初の本編をMainへ割り当てる',()=>{
 const dir=mkdtempSync(join(tmpdir(),'main-migration-')),path=join(dir,'novels.db');let store=new Store(path);
 const user=store.addUser('alice','Alice','alice-password'),root=store.createStory(user.id,{title:'Existing',chapterTitle:'one',body:'preserved'}),fork=store.fork(user.id,root.chapterId,{title:'two',body:'fork'});
 store.like(user.id,root.chapterId,true);
 // Reconstruct the v3 stories table while keeping all other actual tables/data.
 store.db.exec(`PRAGMA foreign_keys=OFF;CREATE TABLE stories_v3(id INTEGER PRIMARY KEY,title TEXT,summary TEXT,author_id INTEGER,created_at TEXT);INSERT INTO stories_v3 SELECT id,title,summary,author_id,created_at FROM stories;DROP TABLE stories;ALTER TABLE stories_v3 RENAME TO stories;PRAGMA user_version=3;PRAGMA foreign_keys=ON;`);store.close();
 try{store=new Store(path);const story=store.story(root.storyId);assert.equal(story.hidden_from_home,0);assert.equal(story.main_branch_id,root.branchId);assert.equal(store.chapter(root.chapterId).body,'preserved');assert.equal(store.chapter(root.chapterId).likes,1);assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,4);assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  // Main is authoritative even if the response branches arrive in a different order.
  story.branches.reverse();assert.equal(selectReading(story).branch.id,root.branchId);assert.equal(selectReading(story).path.length,1);assert.equal(selectReading(story,fork.branchId).path.length,2);
  store.setStoryVisibility(user.id,root.storyId,{hiddenFromHome:true});store.close();store=new Store(path);assert.equal(store.story(root.storyId).hidden_from_home,1);assert.equal(store.story(root.storyId).main_branch_id,root.branchId);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
