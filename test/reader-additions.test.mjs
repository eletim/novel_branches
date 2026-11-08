import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {reorderableChapters} from '../public/reading.mjs';
function fixture(path=':memory:') {
 const s=new Store(path),a=s.addUser('writer','作者','password-author'),b=s.addUser('reader','読者','password-reader');
 const r=s.createStory(a.id,{title:'作品',summary:'',chapterTitle:'始まり',body:'あ😀\nい\r\n う'});
 const append=(branch,id,title)=>s.append(b.id,branch,{title,body:title,expectedHeadId:id});
 const second=append(r.branchId,r.chapterId,'二話'),third=append(r.branchId,second.chapterId,'三話');
 return {s,a,b,r,second,third,append};
}
test('文字数はUnicode文字・空白を数え改行を除き、作品集計では分岐の共通部分を重複させない',()=>{
 const {s,b,r,second}=fixture();try{
 assert.equal(s.chapter(r.chapterId).character_count,5);
 const fork=s.fork(b.id,second.chapterId,{title:'別の三話',body:'別😀'});
 assert.equal(s.story(r.storyId).character_count,11);assert.equal(s.listStories()[0].character_count,11);
 assert.equal(s.exportBranch(fork.branchId).text,'作品\n\n第1話　始まり\n\nあ😀\nい\r\n う\n\n第2話　二話\n\n二話\n\n第3話　別の三話\n\n別😀');
 }finally{s.close();}
});
test('話数の入れ替えは管理者のみ。ID・本文・作者・票・コメントを保持し古い順番と編集を拒否',()=>{
 const {s,a,b,r,second,third}=fixture();try{
 s.like(b.id,second.chapterId,true);s.addComment(b.id,second.chapterId,{body:'感想'});
 const original=s.path(r.branchId).map(c=>c.id),order=[third.chapterId,r.chapterId,second.chapterId],input={expectedPathIds:original,chapterIds:order};
 assert.throws(()=>s.reorder(b.id,r.branchId,input),e=>e.status===403);
 const before=s.chapter(second.chapterId);s.reorder(a.id,r.branchId,input);
 assert.deepEqual(s.path(r.branchId).map(c=>c.id),order);
 const after=s.chapter(second.chapterId);for(const key of ['id','body','author_id','likes','comment_count'])assert.equal(after[key],before[key]);
 assert.throws(()=>s.reorder(a.id,r.branchId,input),e=>e.status===409);
 assert.throws(()=>s.edit(b.id,second.chapterId,{title:'stale',body:'stale',expectedRevision:before.revision}),e=>e.status===409);
 assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{s.close();}
});
test('共有部分を固定して末尾のみ並べ替え、入れ子の全経路と分岐点を保つ',()=>{
 const {s,a,b,r,second,third,append}=fixture();try{
 const fork=s.fork(b.id,r.chapterId,{title:'分岐',body:'分岐'}),nested=s.fork(b.id,fork.chapterId,{title:'入れ子',body:'入れ子'});
 const before=s.path(nested.branchId),ids=s.path(r.branchId).map(c=>c.id);
 assert.deepEqual(reorderableChapters(s.story(r.storyId),r.branchId).map(c=>c.id),[second.chapterId,third.chapterId]);
 assert.throws(()=>s.reorder(a.id,r.branchId,{expectedPathIds:ids,chapterIds:ids.reverse()}),e=>e.status===409);
 s.reorder(a.id,r.branchId,{expectedPathIds:s.path(r.branchId).map(c=>c.id),chapterIds:[third.chapterId,second.chapterId]});
 assert.deepEqual(s.path(nested.branchId),before);assert.equal(s.chapter(third.chapterId).parent_id,r.chapterId);
 const stale=s.path(r.branchId).map(c=>c.id);append(r.branchId,second.chapterId,'四話');
 assert.throws(()=>s.reorder(a.id,r.branchId,{expectedPathIds:stale,chapterIds:[second.chapterId,third.chapterId]}),e=>e.status===409);
 // A newly-created fork freezes additional chapters even without changing the selected path.
 const latest=s.path(r.branchId).map(c=>c.id);s.fork(b.id,second.chapterId,{title:'同時の分岐',body:'保持'});
 assert.throws(()=>s.reorder(a.id,r.branchId,{expectedPathIds:latest,chapterIds:latest.slice(1).reverse()}),e=>e.status===409);
 }finally{s.close();}
});
test('コメントは話に属しカーソルでページ送り、本人のみ削除・再起動後も保存',()=>{
 const dir=mkdtempSync(join(tmpdir(),'novel-additions-'));const f=fixture(join(dir,'db'));let s=f.s;const {a,b,r,second}=f;
 try{
 assert.throws(()=>s.addComment(b.id,r.chapterId,{body:' '}));assert.throws(()=>s.addComment(b.id,r.chapterId,{body:'x'.repeat(2001)}));
 for(let i=0;i<32;i++)s.addComment(b.id,r.chapterId,{body:'感想'+i});
 const p=s.comments(r.chapterId);assert.equal(p.comments.length,30);assert.equal(s.comments(r.chapterId,{before:p.nextBefore}).comments.length,2);assert.equal(s.comments(second.chapterId).comments.length,0);
 assert.throws(()=>s.deleteComment(a.id,p.comments[0].id),e=>e.status===403);
 s.deleteComment(b.id,p.comments[0].id);s.close();s=new Store(join(dir,'db'));
 assert.equal(s.chapter(r.chapterId).comment_count,31);assert.equal(s.db.prepare('PRAGMA user_version').get().user_version,7);
 assert.throws(()=>s.comments(r.chapterId,{before:-1}));assert.throws(()=>s.addComment(a.id,9999,{body:'不存在'}),e=>e.status===404);
 }finally{s.close();rmSync(dir,{recursive:true,force:true});}
});
test('新APIは認証・Origin・別ユーザー対策を継承しサブパスからコピー・コメント・並べ替え可能',async()=>{
 const {s,a,b,r,second,third}=fixture(),server=createApp({store:s,auth:{mode:'local'},basePath:'/novel'});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`,token=s.createSession(a.id).token;
 const call=(path,method='GET',data,headers={})=>fetch(base+'/novel'+path,{method,headers:{Cookie:'session='+token,...data?{'Content-Type':'application/json'}:{},...headers},body:data?JSON.stringify(data):undefined});
 try{
 for(const path of [`/api/chapters/${r.chapterId}/comments`,`/api/branches/${r.branchId}/export`])assert.equal((await call(path,'GET',null,{Cookie:''})).status,401);
 assert.equal((await call(`/api/chapters/${r.chapterId}/comments`,'POST',{body:'hello'},{Origin:'http://attacker.invalid'})).status,403);
 assert.equal((await call(`/api/chapters/${r.chapterId}/comments`,'POST',{body:'hello'},{'X-Novel-User':String(b.id)})).status,409);
 const comment=await call(`/api/chapters/${r.chapterId}/comments`,'POST',{body:'<script>alert(1)</script>'});assert.equal(comment.status,201);
 assert.equal((await call('/api/comments/'+(await comment.json()).id,'DELETE',{})).status,200);
 assert.equal((await call(`/api/branches/${r.branchId}/reorder`,'PUT',{expectedPathIds:[r.chapterId,second.chapterId,third.chapterId],chapterIds:[third.chapterId,second.chapterId,r.chapterId]})).status,200);
 const exported=await call(`/api/branches/${r.branchId}/export`);assert.equal(exported.status,200);assert.match((await exported.json()).text,/第1話　三話/);
 assert.equal((await call('/favicon.svg')).headers.get('content-type'),'image/svg+xml');assert.equal((await fetch(base+'/favicon.svg')).status,404);
 }finally{await new Promise(r=>server.close(r));s.close();}
});
