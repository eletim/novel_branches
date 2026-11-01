import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {resolveIdentity} from '../scripts/story-managers.mjs';
test('複数管理者は作品情報のみCAS編集でき、解除・分離・制作者保護・冪等性を保つ',async()=>{
 const store=new Store(':memory:'),a=store.addUser('alice','Alice','alice-password'),b=store.addUser('bob','Bob','bob-password'),outsider=store.addUser('carol','Carol','carol-password');
 const root=store.createStory(a.id,{title:'A',chapterTitle:'One',body:'body'}),other=store.createStory(a.id,{title:'B',chapterTitle:'One',body:'B'});store.like(b.id,root.chapterId,true);
 const original=store.chapter(root.chapterId),before=store.story(root.storyId);
 try{
  assert.equal(store.canManageStory(a.id,root.storyId),true);assert.equal(store.canManageStory(b.id,root.storyId),false);
  store.assignStoryManager(root.storyId,b.id);store.assignStoryManager(root.storyId,b.id);assert.equal(store.storyManagers(root.storyId).length,2);
  const patch={title:'Managed',summary:'あらすじ',hiddenFromHome:true,settingNotes:'設定\nメモ',expectedRevision:1};
  const changed=store.updateStory(b.id,root.storyId,patch);assert.equal(changed.can_manage,true);for(const [key,value]of Object.entries({title:'Managed',summary:'あらすじ',hidden_from_home:1,setting_notes:'設定\nメモ'}))assert.equal(changed[key],value);assert.equal(changed.author_id,a.id);assert.equal(changed.author,'Alice');assert.deepEqual(changed.branches,before.branches);assert.deepEqual(store.chapter(root.chapterId),original);
  assert.throws(()=>store.updateStory(b.id,root.storyId,patch),e=>e.status===409);assert.throws(()=>store.updateStory(b.id,other.storyId,patch),e=>e.status===403);assert.throws(()=>store.updateStory(outsider.id,root.storyId,patch),e=>e.status===403);assert.throws(()=>store.edit(b.id,root.chapterId,{title:'Denied',body:'Denied',expectedRevision:1}),e=>e.status===403);
  store.updateStory(a.id,root.storyId,{summary:'Owner still edits',expectedRevision:2});
  store.assignStoryManager(root.storyId,b.id,false);assert.equal(store.story(root.storyId,b.id).can_manage,false);assert.throws(()=>store.updateStory(b.id,root.storyId,{settingNotes:'Denied',expectedRevision:3}),e=>e.status===403);assert.throws(()=>store.assignStoryManager(root.storyId,a.id,false),e=>e.status===403);
  const server=createApp({store,basePath:'/novel',secureCookies:false});server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}/novel/api`;
  const req=(path,method='GET',body,cookie)=>fetch(origin+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
  try{const cookie=(await req('/login','POST',{username:'bob',password:'bob-password'})).headers.get('set-cookie').split(';')[0];assert.equal((await(await req('/stories/'+root.storyId,'GET',null,cookie)).json()).can_manage,false);store.assignStoryManager(root.storyId,b.id);assert.equal((await(await req('/stories/'+root.storyId,'GET',null,cookie)).json()).can_manage,true);assert.equal((await req('/stories/'+root.storyId,'PATCH',{settingNotes:'HTTP管理',expectedRevision:3},cookie)).status,200);assert.equal((await req('/chapters/'+root.chapterId,'PATCH',{title:'Denied',body:'Denied',expectedRevision:1},cookie)).status,403);store.assignStoryManager(root.storyId,b.id,false);assert.equal((await req('/stories/'+root.storyId,'PATCH',{settingNotes:'Denied',expectedRevision:4},cookie)).status,403);assert.equal((await req('/stories/'+root.storyId+'/managers','POST',{userId:b.id},cookie)).status,404);
  }finally{await new Promise(r=>server.close(r));}
 }finally{store.close();}
});
test('OIDC本人対応はissuer/subのみで解決し、全作品付与はその時点だけで重複しない',()=>{
 const store=new Store(':memory:'),wrong=store.addUser('wrong','koji','wrong-password'),real=store.oidcUser('https://issuer.example/realm','real-koji-sub','koji');store.db.prepare('INSERT INTO oidc_identities VALUES(?,?,?)').run('https://issuer.example/realm','other-sub',wrong.id);
 try{assert.equal(resolveIdentity(store,'https://issuer.example/realm','real-koji-sub'),real.id);assert.throws(()=>resolveIdentity(store,'https://other.example','real-koji-sub'));assert.throws(()=>resolveIdentity(store,'https://issuer.example/realm','missing'));assert.equal(store.db.prepare('SELECT COUNT(*) n FROM users').get().n,2);
  for(let i=0;i<3;i++){const s=store.createStory(wrong.id,{title:'Existing'+i,chapterTitle:'One',body:'body'});if(i===1)store.updateStory(wrong.id,s.storyId,{hiddenFromHome:true,expectedRevision:1});}
  assert.deepEqual({...store.assignAllStoryManagers(real.id)},{total:3,managed:3,added:3});assert.equal(store.assignAllStoryManagers(real.id).added,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM story_managers WHERE user_id=?').get(real.id).n,3);
  const future=store.createStory(wrong.id,{title:'Future',chapterTitle:'One',body:'body'});assert.equal(store.canManageStory(real.id,future.storyId),false);assert.deepEqual({...store.storyManagementAudit(real.id)},{total:4,managed:3});
 }finally{store.close();}
});
test('v5移行は元の全データを維持し、制作者のみseedし、追加・解除を再起動でも保持',()=>{
 const dir=mkdtempSync(join(tmpdir(),'managers-')),file=join(dir,'db');let store=new Store(file);const a=store.addUser('alice','Alice','alice-password'),b=store.addUser('bob','Bob','bob-password'),s=store.createStory(a.id,{title:'Old',chapterTitle:'One',body:'body'});store.updateStory(a.id,s.storyId,{settingNotes:'既存設定メモ',hiddenFromHome:true,expectedRevision:1});store.like(b.id,s.chapterId,true);
 const snapshot=()=>Object.fromEntries(['stories','chapters','branches','likes','users'].map(t=>[t,store.db.prepare('SELECT * FROM '+t).all()])),before=snapshot();store.db.exec('DROP TABLE story_managers;PRAGMA user_version=5');store.close();
 try{store=new Store(file);assert.deepEqual(snapshot(),before);assert.equal(store.storyManagers(s.storyId).length,1);assert.equal(store.canManageStory(a.id,s.storyId),true);assert.equal(store.canManageStory(b.id,s.storyId),false);store.assignStoryManager(s.storyId,b.id);store.close();store=new Store(file);assert.equal(store.canManageStory(b.id,s.storyId),true);store.assignStoryManager(s.storyId,b.id,false);store.close();store=new Store(file);assert.equal(store.canManageStory(b.id,s.storyId),false);assert.deepEqual(snapshot(),before);assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
