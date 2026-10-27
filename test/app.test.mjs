import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Store } from '../src/store.mjs';
import { createApp } from '../src/server.mjs';
import { rpc, tools } from '../src/mcp.mjs';
const input={title:'原作',summary:'紹介',chapterTitle:'第1話',body:'共通の物語。'};
function fixture() {
  const store=new Store(':memory:');
  const a=store.addUser('alice','アリス','password-alice'),b=store.addUser('bob','ボブ','password-bob');
  const root=store.createStory(a.id,input);
  return {store,a,b,root};
}
test('任意の話から分岐し、入れ子の分岐でも共通の話を順番に辿れる',()=>{
  const {store,a,b,root}=fixture();
  try {
    const second=store.append(a.id,root.branchId,{title:'本編2',body:'東へ',expectedHeadId:root.chapterId});
    const fork=store.fork(b.id,root.chapterId,{branchTitle:'西の世界',title:'分岐2',body:'西へ'});
    const nested=store.fork(a.id,fork.chapterId,{branchTitle:'地下の世界',title:'分岐3',body:'地下へ'});
    assert.deepEqual(store.path(root.branchId).map(c=>c.id),[root.chapterId,second.chapterId]);
    assert.deepEqual(store.path(nested.branchId).map(c=>c.id),[root.chapterId,fork.chapterId,nested.chapterId]);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM chapters').get().n,4);
    assert.equal(store.chapter(root.chapterId).body,input.body);
    assert.equal(store.chapter(root.chapterId).children.length,2);
    assert.equal(store.story(root.storyId).branches.length,3);
  } finally {store.close();}
});
test('作者の所有権と古い画面からの投稿競合を確認する',()=>{
  const {store,a,b,root}=fixture();
  try {
    assert.throws(()=>store.append(b.id,root.branchId,{title:'侵入',body:'test',expectedHeadId:root.chapterId}),e=>e.status===403);
    store.append(a.id,root.branchId,{title:'次',body:'test',expectedHeadId:root.chapterId});
    assert.throws(()=>store.append(a.id,root.branchId,{title:'古い画面',body:'test',expectedHeadId:root.chapterId}),e=>e.status===409);
    assert.equal(store.story(root.storyId).chapters.length,2);
  } finally {store.close();}
});
test('グッドはユーザーごとに1票、取消できてランキングへ反映される',()=>{
  const {store,a,b,root}=fixture();
  try {
    store.like(a.id,root.chapterId,true);store.like(a.id,root.chapterId,true);store.like(b.id,root.chapterId,true);
    assert.equal(store.chapter(root.chapterId,a.id).likes,2);
    store.like(a.id,root.chapterId,false);assert.equal(store.chapter(root.chapterId,a.id).liked,0);
    store.createStory(b.id,{...input,title:'新しい作品'});
    assert.equal(store.listStories({sort:'popular'})[0].id,root.storyId);
    assert.equal(store.listStories({query:'原作'})[0].likes,1);
  } finally {store.close();}
});
test('空の投稿・欠損ID・不正な引数でデータが増えない',()=>{
  const {store,a,root}=fixture();
  try {
    assert.throws(()=>store.fork(a.id,9999,{branchTitle:'不存在',title:'次',body:'text'}),e=>e.status===404);
    assert.throws(()=>store.createStory(a.id,{...input,body:' '}));
    assert.throws(()=>store.like(a.id,root.chapterId,'true'));
    assert.throws(()=>store.listStories({limit:-1}));
    assert.equal(store.story(root.storyId).branches.length,1);
    assert.equal(store.listStories().length,1);
  } finally {store.close();}
});
test('DBを閉じて開いても本文・分岐・票・セッションが保存される',()=>{
  const dir=mkdtempSync(join(tmpdir(),'novels-')),path=join(dir,'test.db');
  let store=new Store(path);
  try {
    const u=store.addUser('alice','Alice','password-alice'),s=store.createStory(u.id,input),login=store.login('alice','password-alice');
    store.fork(u.id,s.chapterId,{branchTitle:'別世界',title:'続き',body:'保存される'});store.like(u.id,s.chapterId,true);store.close();store=new Store(path);
    assert.equal(store.chapter(s.chapterId).body,input.body);assert.equal(store.story(s.storyId).branches.length,2);assert.equal(store.chapter(s.chapterId).likes,1);assert.equal(store.session(login.token).id,u.id);
    store.logout(login.token);assert.equal(store.session(login.token),null);
    assert.throws(()=>store.login('alice','incorrect'),e=>e.status===401);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('MCPが閲覧ツールだけを公開し、本文・分岐を取得する',()=>{
  const {store,root}=fixture();
  try {
    const request=(method,params)=>rpc(store,{jsonrpc:'2.0',id:1,method,params});
    assert.equal(request('initialize',{protocolVersion:'2025-06-18'}).result.protocolVersion,'2025-06-18');
    assert.equal(request('tools/list').result.tools.length,4);
    for(const tool of tools)assert.equal(tool.annotations.readOnlyHint,true);
    assert.equal(request('tools/call',{name:'get_chapter',arguments:{chapterId:root.chapterId}}).result.structuredContent.body,input.body);
    assert.equal(request('tools/call',{name:'get_branch_path',arguments:{branchId:root.branchId}}).result.structuredContent.chapters[0].id,root.chapterId);
    assert.equal(request('tools/call',{name:'get_chapter',arguments:{chapterId:'1'}}).result.isError,true);
    assert.equal(request('tools/call',{name:'delete_story'}).error.code,-32602);
    assert.equal(rpc(store,{jsonrpc:'2.0',method:'notifications/initialized'}),null);
    assert.equal(rpc(store,{}).error.code,-32600);
  } finally {store.close();}
});
test('HTTPで2人がログイン・投稿・分岐・評価し、MCPでも同じ本文を読める',async()=>{
  const {store,a,root}=fixture();
  const server=createApp({store,mcpToken:'test-token',origin:'http://localhost:3000'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,method='GET',data,cookie,headers={})=>fetch(base+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:data?JSON.stringify(data):undefined});
  try {
    assert.equal((await request('/api/stories')).status,401);
    const login=await request('/api/login','POST',{username:'alice',password:'password-alice'}),cookie=login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'),/HttpOnly/);
    assert.equal((await login.json()).user.id,a.id);
    const bobLogin=await request('/api/login','POST',{username:'bob',password:'password-bob'}),bob=bobLogin.headers.get('set-cookie').split(';')[0];
    const fork=await request(`/api/chapters/${root.chapterId}/fork`,'POST',{branchTitle:'Bob世界',title:'Bob2',body:'Bobの本文'},bob),f=await fork.json();assert.equal(fork.status,201);
    assert.equal((await request(`/api/branches/${root.branchId}/chapters`,'POST',{title:'NG',body:'NG',expectedHeadId:root.chapterId},bob)).status,403);
    const posted=await request('/api/stories','POST',{...input,title:'Webから投稿'},cookie);assert.equal(posted.status,201);
    assert.equal((await request(`/api/chapters/${f.chapterId}/like`,'PUT',{liked:true},cookie)).status,200);
    assert.equal((await (await request(`/api/chapters/${f.chapterId}`, 'GET',undefined,bob)).json()).likes,1);
    assert.equal((await request('/api/stories','POST',input,cookie,{Origin:'https://evil.example'})).status,403);
    assert.equal((await request('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/list'})).status,401);
    const headers={Authorization:'Bearer test-token',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18'};
    const mcp=await request('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_chapter',arguments:{chapterId:f.chapterId}}},null,headers);
    assert.equal((await mcp.json()).result.structuredContent.body,'Bobの本文');
    assert.equal((await request('/mcp','POST',{jsonrpc:'2.0',method:'notifications/initialized'},null,headers)).status,202);
    assert.equal((await request('/mcp','GET',undefined,null,headers)).status,405);
    assert.equal((await request('/mcp','POST',{jsonrpc:'2.0',id:2,method:'ping'},null,{...headers,Origin:'https://evil.example'})).status,403);
    const home=await request('/');assert.match(await home.text(),/みんなで小説を作ろう/);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
    await request('/api/logout','POST',{},cookie);assert.equal((await request('/api/stories','GET',undefined,cookie)).status,401);
  } finally {await new Promise(resolve=>server.close(resolve));store.close();}
});
test('stdioの標準出力はMCP JSONのみで、複数リクエストと通知を扱う',async()=>{
  const child=spawn(process.execPath,['src/stdio.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,DB_PATH:':memory:'},stdio:['pipe','pipe','pipe']});
  let output='',stderr='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>stderr+=c);
  child.stdin.end([{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'}].map(JSON.stringify).join('\n')+'\n');
  const [code]=await once(child,'close');assert.equal(code,0,stderr);
  const lines=output.trim().split('\n').map(JSON.parse);assert.equal(lines.length,2);assert.equal(lines[1].result.tools.length,4);
});
