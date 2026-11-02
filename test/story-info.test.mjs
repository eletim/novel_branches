import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {rpc} from '../src/mcp.mjs';
test('作品情報と設定メモは最初の作者のみCAS更新し、話・親・作者・票を変えない',async()=>{
 const store=new Store(':memory:'),a=store.addUser('alice','Alice','alice-password'),b=store.addUser('bob','Bob','bob-password'),root=store.createStory(a.id,{title:'Original',chapterTitle:'One',body:'original body'});
 const next=store.append(b.id,root.branchId,{title:'Two',body:'Bob text',expectedHeadId:root.chapterId});store.fork(b.id,root.chapterId,{title:'Fork',body:'fork'});store.like(b.id,root.chapterId,true);
 const snapshot=()=>Object.fromEntries(['chapters','branches','likes'].map(t=>[t,store.db.prepare('SELECT * FROM '+t+' ORDER BY rowid').all()])),before=snapshot();
 const notes='  世界観：森と街\n登場人物：ゆい\n'+'日本語の長文\n'.repeat(2000),input={title:'New title',summary:'あらすじ\n二行目',hiddenFromHome:true,settingNotes:notes,expectedRevision:1};
 try{
  assert.equal(store.story(root.storyId).setting_notes,'');
  assert.throws(()=>store.updateStory(b.id,root.storyId,input),e=>e.status===403);
  assert.throws(()=>store.updateStory(a.id,root.storyId,{...input,author_id:b.id}),e=>e.status===400);
  const changed=store.updateStory(a.id,root.storyId,input);assert.equal(changed.revision,2);assert.equal(changed.setting_notes,notes);assert.equal(changed.author_id,a.id);assert.equal(changed.main_branch_id,root.branchId);assert.deepEqual(snapshot(),before);
  assert.throws(()=>store.updateStory(a.id,root.storyId,input),e=>e.status===409);
  assert.throws(()=>store.updateStory(a.id,root.storyId,{settingNotes:'x'.repeat(100001),expectedRevision:2}),e=>e.status===400);
  assert.throws(()=>store.updateStory(a.id,root.storyId,{hiddenFromHome:false}),e=>e.status===400);
  const mcp=rpc(store,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_story',arguments:{storyId:root.storyId}}}).result.structuredContent;assert.equal(mcp.setting_notes,notes);assert.equal(mcp.revision,2);
  assert.ok(!('setting_notes' in store.listStories()[0]));
  assert.equal(store.updateStory(a.id,root.storyId,{settingNotes:'',expectedRevision:2}).setting_notes,'');assert.deepEqual(snapshot(),before);
  const server=createApp({store,basePath:'/novel',secureCookies:false});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/novel/api`;
  const request=(path,method='GET',body,cookie)=>fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  try{const auth=async username=>(await request('/login','POST',{username,password:username+'-password'})).headers.get('set-cookie').split(';')[0],alice=await auth('alice'),bob=await auth('bob');
   const patch={settingNotes:notes,expectedRevision:3};assert.equal((await request('/stories/'+root.storyId,'PATCH',patch)).status,401);assert.equal((await request('/stories/'+root.storyId,'PATCH',patch,bob)).status,403);assert.equal((await request('/stories/'+root.storyId,'PATCH',patch,alice)).status,200);assert.equal((await request('/stories/'+root.storyId,'PATCH',patch,alice)).status,409);assert.equal((await(await request('/stories/'+root.storyId,'GET',null,bob)).json()).setting_notes,notes);
   assert.deepEqual(snapshot(),before);assert.equal(store.chapter(next.chapterId).author_id,b.id);
  }finally{await new Promise(r=>server.close(r));}
 }finally{store.close();}
});
test('v4の作品表示・Main・メタデータと全関連行を保持して空メモ/revision=1へ移行',()=>{
 const dir=mkdtempSync(join(tmpdir(),'story-info-')),file=join(dir,'db');let store=new Store(file);const user=store.addUser('alice','Alice','alice-password'),root=store.createStory(user.id,{title:'Old',summary:'Summary',chapterTitle:'One',body:'Body'});store.setStoryVisibility(user.id,root.storyId,{hiddenFromHome:true,expectedRevision:1});
 const original=store.story(root.storyId);store.db.exec(`PRAGMA foreign_keys=OFF;CREATE TABLE stories_v4(id INTEGER PRIMARY KEY,title TEXT,summary TEXT,author_id INTEGER,created_at TEXT,hidden_from_home INTEGER,main_branch_id INTEGER);INSERT INTO stories_v4 SELECT id,title,summary,author_id,created_at,hidden_from_home,main_branch_id FROM stories;DROP TABLE stories;ALTER TABLE stories_v4 RENAME TO stories;PRAGMA user_version=4;PRAGMA foreign_keys=ON;`);store.close();
 try{store=new Store(file);const migrated=store.story(root.storyId);for(const k of ['id','title','summary','author_id','created_at','hidden_from_home','main_branch_id'])assert.deepEqual(migrated[k],original[k]);assert.equal(migrated.setting_notes,'');assert.equal(migrated.revision,1);assert.equal(migrated.updated_at,migrated.created_at);assert.deepEqual(migrated.chapters,original.chapters);assert.equal(store.chapter(root.chapterId).body,'Body');assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);store.updateStory(user.id,root.storyId,{settingNotes:'保持するメモ',expectedRevision:1});store.close();store=new Store(file);assert.equal(store.story(root.storyId).setting_notes,'保持するメモ');assert.equal(store.story(root.storyId).revision,2);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
