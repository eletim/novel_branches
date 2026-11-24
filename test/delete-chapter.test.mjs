import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {rpc} from '../src/mcp.mjs';
const input={title:'作品',chapterTitle:'始まり',body:'共通の本文'};
function fixture(path=':memory:'){
 const s=new Store(path),a=s.addUser('author','作者','author-password'),b=s.addUser('other','別の人','other-password');
 const root=s.createStory(a.id,input);return {s,a,b,root};
}
const args=(s,id)=>({expectedRevision:s.chapter(id).revision,expectedStoryRevision:s.story(s.chapter(id).story_id).revision});
const missing=fn=>assert.throws(fn,e=>e.status===404);
test('続話は本人だけ削除でき、直前の話が末尾に戻り、他の話と関連データを保持する',()=>{
 const {s,a,b,root}=fixture();try{
 const second=s.append(b.id,root.branchId,{title:'続話',body:'別の人の本文',expectedHeadId:root.chapterId});
 s.assignStoryManager(root.storyId,b.id);s.like(a.id,second.chapterId,true);s.addComment(a.id,second.chapterId,{body:'削除対象への感想'});
 s.like(b.id,root.chapterId,true);s.addComment(b.id,root.chapterId,{body:'残る感想'});
 const before=s.chapter(root.chapterId);
 assert.throws(()=>s.deleteChapter(a.id,second.chapterId,args(s,second.chapterId)),e=>e.status===403);
 const result=s.deleteChapter(b.id,second.chapterId,args(s,second.chapterId));
 assert.deepEqual(result,{deletedChapterId:second.chapterId,storyId:root.storyId,branchId:root.branchId});missing(()=>s.chapter(second.chapterId));
 assert.deepEqual(s.path(root.branchId).map(c=>c.id),[root.chapterId]);
 assert.equal(s.chapter(root.chapterId).body,before.body);assert.equal(s.chapter(root.chapterId).likes,1);assert.equal(s.comments(root.chapterId).comments[0].body,'残る感想');
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM comments WHERE chapter_id=?').get(second.chapterId).n,0);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM likes WHERE chapter_id=?').get(second.chapterId).n,0);
 const next=s.append(b.id,root.branchId,{title:'新しい続話',body:'別本文',expectedHeadId:root.chapterId});assert.ok(next.chapterId>second.chapterId);
 missing(()=>s.edit(b.id,second.chapterId,{title:'古い画面',body:'誤更新',expectedRevision:1}));assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{s.close();}
});
test('続話・分岐・別案の追加後は古い確認画面から削除できず、他経路を保持する',()=>{
 for(const kind of ['append','fork','alternate']){
  const {s,a,b,root}=fixture();try{
   const second=s.append(a.id,root.branchId,{title:'末尾',body:'本文',expectedHeadId:root.chapterId}),old=args(s,second.chapterId);
   if(kind==='append')s.append(b.id,root.branchId,{title:'他者続話',body:'保持',expectedHeadId:second.chapterId});
   else if(kind==='fork')s.fork(b.id,second.chapterId,{title:'分岐',body:'保持'});
   else {s.alternate(b.id,second.chapterId,{title:'別案',body:'保持'});s.fork(b.id,second.chapterId,{title:'共有',body:'保持'});}
   const before=s.story(root.storyId);assert.equal(s.chapter(second.chapterId,a.id).deletion.allowed,false);
   assert.throws(()=>s.deleteChapter(a.id,second.chapterId,old),e=>e.status===409);assert.deepEqual(s.story(root.storyId),before);
  }finally{s.close();}
 }
});
test('独立した別案と分岐の最後の話を削除すると、その空経路だけを除く',()=>{
 for(const method of ['fork','alternate']){
  const {s,a,b,root}=fixture();try{
   const fork=s[method](b.id,root.chapterId,{title:'別経路',body:'別本文'}),before=s.chapter(root.chapterId);
   const info=s.chapter(fork.chapterId,b.id).deletion;assert.equal(info.removesBranch,true);assert.equal(info.removesStory,false);
   s.deleteChapter(b.id,fork.chapterId,args(s,fork.chapterId));missing(()=>s.path(fork.branchId));assert.deepEqual({...s.chapter(root.chapterId)},{...before,children:[]});
   assert.equal(s.story(root.storyId).main_branch_id,root.branchId);assert.equal(s.story(root.storyId).branches.length,1);
   const next=s[method](b.id,root.chapterId,{title:'新しい別経路',body:'新しい本文'});assert.ok(next.branchId>fork.branchId);assert.ok(next.chapterId>fork.chapterId);
  }finally{s.close();}
 }
});
test('最後の一話は作品ごと削除し、IDを再起動後も再利用しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'novel-delete-')),path=join(dir,'db');const f=fixture(path);let s=f.s;const {a,b,root}=f;
 try{
 s.assignStoryManager(root.storyId,b.id);s.like(b.id,root.chapterId,true);s.addComment(b.id,root.chapterId,{body:'感想'});
 assert.equal(s.chapter(root.chapterId,a.id).deletion.removesStory,true);
 assert.equal(s.deleteChapter(a.id,root.chapterId,args(s,root.chapterId)).storyId,null);
 missing(()=>s.story(root.storyId));missing(()=>s.path(root.branchId));missing(()=>s.chapter(root.chapterId));
 for(const table of ['stories','chapters','branches','likes','comments','story_managers'])assert.equal(s.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 assert.ok(s.user(b.id));s.close();s=new Store(path);
 const next=s.createStory(a.id,input);assert.ok(next.storyId>root.storyId);assert.ok(next.branchId>root.branchId);assert.ok(next.chapterId>root.chapterId);
 assert.deepEqual(s.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('他経路のある本編の最後の一話、更新済みの本文・作品情報、非作者の作品全削除を拒否',()=>{
 const {s,a,b,root}=fixture();try{
 const stale=args(s,root.chapterId);s.edit(a.id,root.chapterId,{title:'編集済み',body:'本文',expectedRevision:1});
 assert.throws(()=>s.deleteChapter(a.id,root.chapterId,stale),e=>e.status===409);
 const current=args(s,root.chapterId);s.updateStory(a.id,root.storyId,{title:'作品名変更',expectedRevision:1});
 assert.throws(()=>s.deleteChapter(a.id,root.chapterId,current),e=>e.status===409);
 const alt=s.alternate(b.id,root.chapterId,{title:'別第一話',body:'本文'});
 assert.throws(()=>s.deleteChapter(a.id,root.chapterId,args(s,root.chapterId)),e=>e.status===409);
 s.deleteChapter(b.id,alt.chapterId,args(s,alt.chapterId));
 const second=s.append(b.id,root.branchId,{title:'二話',body:'本文',expectedHeadId:root.chapterId});
 s.reorder(a.id,root.branchId,{expectedPathIds:[root.chapterId,second.chapterId],chapterIds:[second.chapterId,root.chapterId]});
 s.deleteChapter(a.id,root.chapterId,args(s,root.chapterId));
 assert.throws(()=>s.deleteChapter(b.id,second.chapterId,args(s,second.chapterId)),e=>e.status===409);
 }finally{s.close();}
});
test('削除APIは認証・Origin・ユーザー切替・revision検証を行い、MCPの旧URLにも本文を残さない',async()=>{
 const {s,a,b,root}=fixture(),server=createApp({store:s,auth:{mode:'local'},basePath:'/novel'});server.listen(0,'127.0.0.1');await once(server,'listening');
 const home=`http://127.0.0.1:${server.address().port}/novel`,token=s.createSession(a.id).token,other=s.createSession(b.id).token;
 const request=(data=args(s,root.chapterId),headers={})=>fetch(home+'/api/chapters/'+root.chapterId,{method:'DELETE',headers:{Cookie:'session='+token,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
 assert.equal((await request(undefined,{Cookie:''})).status,401);assert.equal((await request(undefined,{Cookie:'session='+other})).status,403);
 assert.equal((await request(undefined,{Origin:'https://attacker.invalid'})).status,403);assert.equal((await request(undefined,{'X-Novel-User':String(b.id)})).status,409);
 assert.equal((await request({})).status,400);assert.equal((await request()).status,200);
 const result=rpc(s,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_chapter',arguments:{chapterId:root.chapterId}}});assert.equal(result.result.isError,true);
 assert.equal(rpc(s,{jsonrpc:'2.0',id:2,method:'tools/list'}).result.tools.length,4);
 assert.equal((await fetch(home+'/api/chapters/'+root.chapterId,{headers:{Cookie:'session='+token}})).status,404);
 }finally{await new Promise(r=>server.close(r));s.close();}
});
