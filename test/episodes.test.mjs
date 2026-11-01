import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {once} from 'node:events';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {rpc} from '../src/mcp.mjs';
import {branchPath,selectReading,candidatesFor,branchForCandidate} from '../public/reading.mjs';
function fixture(){const store=new Store(':memory:');const a=store.addUser('alice','Alice','alice-password'),b=store.addUser('bob','Bob','bob-password');const root=store.createStory(a.id,{title:'Novel',chapterTitle:'A1',body:'one'});return{store,a,b,root};}
test('話の制作者だけがCAS編集でき、共有の各経路・票・MCPへ反映する',()=>{
 const {store,a,b,root}=fixture();try{
  const second=store.append(b.id,root.branchId,{title:'B2',body:'two',expectedHeadId:root.chapterId});
  const fork=store.fork(b.id,root.chapterId,{title:'Fork2',body:'fork'});
  store.like(b.id,root.chapterId,true);
  const original=store.chapter(root.chapterId);
  assert.throws(()=>store.edit(b.id,root.chapterId,{title:'bad',body:'bad',expectedRevision:1}),e=>e.status===403);
  assert.throws(()=>store.edit(a.id,root.chapterId,{title:'bad',body:'bad',expectedRevision:1,parent_id:second.chapterId}),e=>e.status===400);
  const edited=store.edit(a.id,root.chapterId,{title:'A1 revised',body:'shared revised',expectedRevision:1});
  assert.ok(edited.updated_at>original.updated_at);assert.equal(edited.revision,2);assert.equal(edited.author_id,a.id);assert.equal(edited.parent_id,null);assert.equal(edited.likes,1);
  assert.throws(()=>store.edit(a.id,root.chapterId,{title:'stale',body:'lost',expectedRevision:1}),e=>e.status===409);
  assert.equal(store.path(fork.branchId)[0].title,'A1 revised');assert.equal(store.story(root.storyId).author_id,a.id);
  const read=rpc(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_chapter',arguments:{chapterId:root.chapterId}}}).result.structuredContent;
  assert.equal(read.body,'shared revised');assert.equal(read.updated_at,edited.updated_at);assert.equal(read.author,'Alice');
  const path=rpc(store,{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'get_branch_path',arguments:{branchId:root.branchId}}}).result.structuredContent.chapters;
  assert.equal(path[1].author_id,b.id);assert.equal(path[1].author,'Bob');assert.ok(path[1].updated_at);
 }finally{store.close();}
});
test('目次候補は同じ親の兄弟だけ。第1話の別案・途中・入れ子を混在させない',()=>{
 const {store,a,b,root}=fixture();try{
  const second=store.append(b.id,root.branchId,{title:'B2',body:'two',expectedHeadId:root.chapterId});
  const third=store.append(a.id,root.branchId,{title:'A3',body:'three',expectedHeadId:second.chapterId});
  const otherRoot=store.alternate(b.id,root.chapterId,{title:'Other1',body:'other one'});
  const otherSecond=store.append(a.id,otherRoot.branchId,{title:'Other2',body:'other two',expectedHeadId:otherRoot.chapterId});
  const alternate=store.alternate(a.id,second.chapterId,{title:'Alt2',body:'alt two'});
  const child=store.append(b.id,alternate.branchId,{title:'Alt3',body:'alt three',expectedHeadId:alternate.chapterId});
  const nested=store.alternate(a.id,child.chapterId,{title:'Nested3',body:'nested'});
  const story=store.story(root.storyId);
  assert.deepEqual(candidatesFor(story,store.chapter(root.chapterId)).map(c=>c.id),[root.chapterId,otherRoot.chapterId]);
  assert.deepEqual(candidatesFor(story,store.chapter(second.chapterId)).map(c=>c.id),[second.chapterId,alternate.chapterId]);
  assert.ok(!candidatesFor(story,store.chapter(second.chapterId)).some(c=>c.id===otherSecond.chapterId));
  assert.deepEqual(branchPath(story,nested.branchId).map(c=>c.id),[root.chapterId,alternate.chapterId,nested.chapterId]);
  assert.equal(branchForCandidate(story,store.chapter(alternate.chapterId),root.branchId),alternate.branchId);
  assert.equal(branchForCandidate(story,store.chapter(root.chapterId),nested.branchId),nested.branchId);
  assert.equal(selectReading(story,otherRoot.branchId,third.chapterId).branch.id,root.branchId);
  const continuation=store.fork(b.id,nested.chapterId,{title:'Nested4',body:'fourth'});
  assert.deepEqual(selectReading(store.story(root.storyId),nested.branchId).path.map(c=>c.id),[root.chapterId,alternate.chapterId,nested.chapterId]);
  assert.deepEqual(selectReading(store.story(root.storyId),continuation.branchId).path.map(c=>c.id),[root.chapterId,alternate.chapterId,nested.chapterId,continuation.chapterId]);
  assert.equal(selectReading(store.story(root.storyId)).branch.id,root.branchId);
 }finally{store.close();}
});
test('v2の既存話を作者・本文・親・グッドを維持してv4へ移行し再実行しても作者を変えない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'episode-migration-')),path=join(dir,'old.db');
 const db=new DatabaseSync(path);db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT,display_name TEXT,password_hash TEXT);
 CREATE TABLE stories(id INTEGER PRIMARY KEY,title TEXT,summary TEXT,author_id INTEGER,created_at TEXT);
 CREATE TABLE branches(id INTEGER PRIMARY KEY,story_id INTEGER,title TEXT,author_id INTEGER,fork_chapter_id INTEGER,head_id INTEGER,created_at TEXT);
 CREATE TABLE chapters(id INTEGER PRIMARY KEY,branch_id INTEGER,parent_id INTEGER,title TEXT,body TEXT,created_at TEXT);
 CREATE TABLE likes(user_id INTEGER,chapter_id INTEGER,PRIMARY KEY(user_id,chapter_id));
 INSERT INTO users VALUES(1,'a','A','unused'),(2,'b','B','unused');
 INSERT INTO stories VALUES(1,'old','summary',1,'2026-01-01T00:00:00Z');
 INSERT INTO branches VALUES(1,1,'root',1,NULL,1,'2026-01-01T00:00:00Z');
 INSERT INTO chapters VALUES(1,1,NULL,'old episode','old body','2026-01-01T00:00:00Z');INSERT INTO likes VALUES(2,1);PRAGMA user_version=2;`);db.close();
 let store=new Store(path);try{
  const c=store.chapter(1);assert.equal(c.author_id,1);assert.equal(c.updated_at,c.created_at);assert.equal(c.revision,1);assert.equal(c.body,'old body');assert.equal(c.likes,1);
  const next=store.append(2,1,{title:'B continuation',body:'B body',expectedHeadId:1});store.close();store=new Store(path);
  assert.equal(store.chapter(next.chapterId).author_id,2);assert.equal(store.chapter(1).author_id,1);assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,4);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTPで他者の続話・別案追加を許可し、他者編集・未認証・古い版を拒否する',async()=>{
 const {store,a,root}=fixture();const server=createApp({store,origin:'http://localhost:3000'});server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 const request=(path,method='GET',body,cookie)=>fetch(url+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
 try{
  const auth=async(username,password)=>(await request('/api/login','POST',{username,password})).headers.get('set-cookie').split(';')[0];
  const alice=await auth('alice','alice-password'),bob=await auth('bob','bob-password');
  const patch={title:'edited',body:'new',expectedRevision:1};
  assert.equal((await request('/api/chapters/'+root.chapterId,'PATCH',patch)).status,401);
  assert.equal((await request('/api/chapters/'+root.chapterId,'PATCH',patch,bob)).status,403);
  assert.equal((await request('/api/chapters/'+root.chapterId,'PATCH',patch,alice)).status,200);
  assert.equal((await request('/api/chapters/'+root.chapterId,'PATCH',patch,alice)).status,409);
  const added=await request(`/api/branches/${root.branchId}/chapters`,'POST',{title:'Bob2',body:'Bob text',expectedHeadId:root.chapterId},bob);assert.equal(added.status,201);
  const next=await added.json();assert.equal(store.chapter(next.chapterId).author,'Bob');
  assert.equal((await request(`/api/chapters/${root.chapterId}/alternate`,'POST',{title:'Bob1',body:'alternative'},bob)).status,201);
  assert.equal((await request('/reading.mjs')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));store.close();}
});
