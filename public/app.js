import {selectReading,candidatesFor,branchForCandidate} from './reading.mjs';
const basePath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const $ = s => document.querySelector(s);
const app = $('#app'), dialog = $('#editor');
let user, auth = {mode:'local'}, viewGeneration = 0, toastTimer;
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,method='GET',data,expectedUserId=user?.id) {
  if(data && path!=='/login' && !user)throw Error('ログインしてください。下書きはこの画面に残っています。');
  const res = await fetch(basePath+'/api'+path,{method,headers:data ? {'Content-Type':'application/json',...(user ? {'X-Novel-User':String(expectedUserId)} : {})} : {},body:data ? JSON.stringify(data) : undefined});
  const result = await res.json();
  if(!res.ok) {if(res.status===401 && path!='/login') {user=null;nav();} throw Error(result.error || '通信できませんでした。');}
  return result;
}
function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').style.display='block';toastTimer=setTimeout(()=>$('#toast').style.display='none',3500);}
function nav() {
  $('#nav').innerHTML = user ? `<span class="username">${esc(user.display_name)}</span><button class="small" id="write">＋ 作品を書く</button><button class="secondary small" id="logout">ログアウト</button>` : '<span class="meta">小さな創作の部屋</span>';
  if(user) {$('#write').onclick=()=>editor('new');$('#logout').onclick=async()=>{try{const result=await api('/logout','POST',{});if(result.logoutUrl){location.assign(result.logoutUrl);return;}user=null;nav();await render();}catch(e){toast(e.message);}};}
}
function login() {
  app.innerHTML=`<section class="hero"><div><span class="eyebrow">A STORY CAN HAVE MORE THAN ONE FUTURE</span><h1>その物語には、<br>まだ別の続きがある。</h1><p>読む。書く。分かれて、広がる。<br>ひとつの物語から生まれる、みんなの平行世界。</p></div>${art()}</section><section class="login"><span class="eyebrow">WELCOME TO YOUR WRITING ROOM</span><h2>創作の部屋に入る</h2>${auth.mode==='oidc'?'<p class="hint">参加用アカウントでログインしてください。</p><a class="button" href="'+basePath+'/auth/login">ログイン →</a>':'<form id="login"><label for="username">ユーザー名</label><input id="username" name="username" autocomplete="username" required maxlength="40"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><p class="error" role="alert"></p><button type="submit">ログイン →</button></form>'}<p class="hint">参加用のアカウントは管理者から受け取ってください。</p></section>`;
  if($('#login'))$('#login').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{user=(await api('/login','POST',Object.fromEntries(new FormData(form)))).user;nav();await render();}catch(err){form.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}};
}
function art(){return '<div class="hero-art" aria-label="共通の話から、2つの世界へ分岐"><div class="worlds"><span class="origin"><small>THE BEGINNING</small>ひとつの物語</span><span class="connector">⑂</span><span><small>WORLD A</small>あなたの続き</span><span><small>WORLD B</small>誰かの続き</span></div></div>';}
async function library(params,generation) {
  const q=params.get('q')||'', sort=params.get('sort')||'new', offset=Math.max(0,Number(params.get('offset'))||0);
  const {stories}=await api(`/stories?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}&offset=${offset}&limit=12`);
  if(generation!==viewGeneration)return;
  app.innerHTML=`<section class="hero"><div><span class="eyebrow">READ · BRANCH · WRITE</span><h1>物語の先に、<br>あなたの世界を。</h1><p>好きな話の、その先から。<br>別の続きを書いて、もうひとつの世界を育てよう。</p><button id="hero-write" class="secondary">最初の一話を書く ↗</button></div>${art()}</section><section><div class="toolbar"><h2>物語を見つける <span class="meta">/ LIBRARY</span></h2><form class="search" id="search"><input name="q" aria-label="作品を検索" placeholder="作品名・あらすじで探す" value="${esc(q)}" maxlength="200"><select name="sort" aria-label="並び順"><option value="new" ${sort==='new'?'selected':''}>新着順</option><option value="popular" ${sort==='popular'?'selected':''}>グッド順</option></select><button class="secondary small">検索</button></form></div><div class="cards">${stories.map(s=>`<a class="card" href="#story/${s.id}"><div class="book-cover"><span>物 語 の 種</span></div><div class="card-content"><span class="tag">${s.branch_count>1?'広がる平行世界':'はじまりの物語'}</span><h3>${esc(s.title)}</h3><div class="meta">${esc(s.author)}</div><p class="summary">${esc(s.summary||'ここから、物語がはじまります。')}</p><div class="stats"><span>⑂ ${s.branch_count}つの展開</span><span>全${s.chapter_count}話</span><span>♡ ${s.likes}</span></div></div></a>`).join('') || `<div class="empty"><h3>${q?'作品が見つかりませんでした':'最初の物語を、ここから。'}</h3><p>${q?'検索する言葉を変えてみてください。':'「作品を書く」から、第一話を投稿できます。'}</p></div>`}</div><div class="pagination">${offset?'<button class="secondary" id="prev">← 前のページ</button>':''}${stories.length===12?'<button class="secondary" id="next">次のページ →</button>':''}</div></section>`;
  $('#hero-write').onclick=()=>editor('new');
  $('#search').onsubmit=e=>{e.preventDefault();location.hash='?'+new URLSearchParams(new FormData(e.currentTarget));};
  const page = n=>{params.set('offset',n);location.hash='?'+params;};
  if($('#prev'))$('#prev').onclick=()=>page(Math.max(0,offset-12));if($('#next'))$('#next').onclick=()=>page(offset+12);
}
function updatedTime(chapter) {
  const raw=chapter.updated_at||chapter.created_at,date=new Date(raw);
  return `<time datetime="${esc(raw)}" title="${esc(date.toLocaleString('ja-JP'))}">${esc(date.toLocaleString('ja-JP',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time>`;
}
async function storyView(id,generation,params) {
  const story=await api('/stories/'+id),{branch,path}=selectReading(story,params.get('branch'));
  if(generation!==viewGeneration)return;
  const row=(c,index,href)=>`<span class="toc-number">第${index+1}話</span><a class="toc-title" href="${href}">${esc(c.title)}</a><span class="toc-author">${esc(c.author)}</span>${updatedTime(c)}`;
  app.innerHTML=`<section class="story-toc"><a class="back" href="#">← 作品一覧へ</a><h1>${esc(story.title)}</h1><p class="meta story-creator">最初の制作者：${esc(story.author)}</p><p class="summary story-summary">${esc(story.summary)}</p><h2 class="sr-only">目次</h2><ol class="toc-list">${path.map((c,i)=>{
    const candidates=candidatesFor(story,c);
    return `<li class="toc-item" data-chapter="${c.id}"><div class="toc-row">${row(c,i,`#chapter/${c.id}?branch=${branch.id}`)}${candidates.length>1?`<button class="secondary small branch-toggle" aria-expanded="false" aria-controls="candidates-${c.id}">branch - ${candidates.length}</button>`:'<span></span>'}</div><div class="toc-candidates" id="candidates-${c.id}" hidden>${candidates.map(candidate=>`<div class="toc-candidate ${candidate.id===c.id?'selected':''}" data-candidate="${candidate.id}">${row(candidate,i,`#story/${story.id}?branch=${branchForCandidate(story,candidate,branch.id)}`)}${candidate.id===c.id?'<span class="meta">選択中</span>':''}</div>`).join('')}</div><button class="toc-alternate" data-alternate="${c.id}">第${i+1}話の別案を書く</button></li>`;
  }).join('')}</ol><div class="toc-actions"><button id="append-story">続話を追加する</button></div></section>`;
  document.querySelectorAll('.branch-toggle').forEach(button=>button.onclick=()=>{const open=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!open));document.getElementById(button.getAttribute('aria-controls')).hidden=open;});
  document.querySelectorAll('[data-alternate]').forEach(button=>button.onclick=()=>editor('alternate',story.chapters.find(c=>c.id===Number(button.dataset.alternate)),branch.id));
  $('#append-story').onclick=()=>editor('append',branch,branch.id);
}
async function chapterView(id,generation,params) {
  const c=await api('/chapters/'+id),story=await api('/stories/'+c.story_id);
  const {branch,path}=selectReading(story,params.get('branch'),c.id),index=path.findIndex(ch=>ch.id===c.id);
  const previous=path[index-1],next=path[index+1],suffix=`?branch=${branch.id}`;
  if(generation!==viewGeneration)return;
  app.innerHTML=`<div class="reader-shell"><a class="back to-toc" href="#story/${c.story_id}${suffix}">← ${esc(story.title)} · 目次</a><div class="reader-heading"><span class="eyebrow">第${index+1}話</span><h1>${esc(c.title)}</h1><div class="meta chapter-creator">制作者：${esc(c.author)} · 最終更新 ${updatedTime(c)}</div></div><article class="reader-body">${esc(c.body)}</article><div class="reader-actions"><button id="like" class="${c.liked?'liked':'secondary'}" aria-pressed="${!!c.liked}">${c.liked?'♥':'♡'} グッド ${c.likes}</button>${c.author_id===user.id?'<button id="edit-chapter" class="secondary">この話を編集</button>':''}<button id="alternate" class="secondary">この話の別案を書く</button><button id="fork" class="secondary">ここから分岐を書く</button>${branch.head_id===c.id?'<button id="append">続話を追加する</button>':''}</div><nav class="chapter-nav" aria-label="話の前後移動">${previous?`<a class="previous-chapter" href="#chapter/${previous.id}${suffix}">← 前の話：${esc(previous.title)}</a>`:'<span></span>'}${next?`<a class="next-chapter" href="#chapter/${next.id}${suffix}">次の話：${esc(next.title)} →</a>`:'<span></span>'}</nav><p class="hint">共通の話の編集は、その話を参照するすべての経路に反映されます。</p></div>`;
  $('#fork').onclick=()=>editor('fork',c,branch.id);$('#alternate').onclick=()=>editor('alternate',c,branch.id);
  if($('#append'))$('#append').onclick=()=>editor('append',branch,branch.id);
  if($('#edit-chapter'))$('#edit-chapter').onclick=()=>editor('edit',c,branch.id);
  $('#like').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const updated=await api(`/chapters/${c.id}/like`,'PUT',{liked:!c.liked});c.liked=updated.liked;button.textContent=`${c.liked?'♥':'♡'} グッド ${updated.likes}`;button.className=c.liked?'liked':'secondary';button.setAttribute('aria-pressed',!!c.liked);}catch(err){toast(err.message);}finally{button.disabled=false;}};
}
function editor(mode,context={},readingBranch=0) {
  const editingUserId=user.id,draftKey=`novel-branches:draft:${editingUserId}:${mode}:${context.id||0}`;
  let draft={};try{draft=JSON.parse(localStorage.getItem(draftKey)||'{}');}catch{}
  const field=(name,label,max,value='',textarea=false)=>`<label for="edit-${name}">${label}</label>${textarea?`<textarea class="${name==='summary'?'short':''}" id="edit-${name}" name="${name}" maxlength="${max}" ${name==='summary'?'':'required'}>${esc(draft[name]??value)}</textarea>`:`<input id="edit-${name}" name="${name}" maxlength="${max}" value="${esc(draft[name]??value)}" required>`}`;
  const heading={new:'新しい作品を書く',fork:'この話の続きから分岐を書く',alternate:'この話の別案を書く',append:'続話を追加する',edit:'この話を編集する'}[mode];
  dialog.innerHTML=`<div class="dialog-head"><h2>${heading}</h2><button class="secondary small" id="close-editor" aria-label="閉じる">✕</button></div><p class="hint">${mode==='edit'?'制作者と話のつながりは変更されません。共通の話を参照する経路にも編集が反映されます。':mode==='alternate'?'直前までの話を共通にして、同じ話数の別案を投稿します。':mode==='fork'?'この話までを共通にして、次の話を別の経路として投稿します。':mode==='append'?'選んだ経路の最新話に続話を追加します。':'作品と最初の一話を投稿します。'}</p><form id="edit-form">${mode==='new'?field('title','作品名',120)+field('summary','あらすじ（任意）',2000,'',true):''}${field(mode==='new'?'chapterTitle':'title','話のタイトル',120,mode==='edit'?context.title:'')}${field('body','本文',100000,mode==='edit'?context.body:'',true)}${mode==='edit'?`<input type="hidden" name="expectedRevision" value="${esc(draft.expectedRevision??context.revision)}">`:mode==='append'?`<input type="hidden" name="expectedHeadId" value="${esc(draft.expectedHeadId??context.head_id)}">`:''}<div class="form-actions"><span class="hint" id="draft-status">下書きはこのブラウザに自動保存</span><button type="submit">${mode==='edit'?'編集を保存する':'この話を投稿する'}</button></div>${['edit','append'].includes(mode)?'<button type="button" class="secondary small" id="reload-edit">下書きを破棄して最新の内容を読み直す</button>':''}<p class="error" role="alert"></p></form>`;
  const form=$('#edit-form');$('#close-editor').onclick=()=>dialog.close();
  const saveDraft=()=>{try{localStorage.setItem(draftKey,JSON.stringify(Object.fromEntries(new FormData(form))));$('#draft-status').textContent='下書き保存済み（このブラウザ）';}catch{$('#draft-status').textContent='下書きを保存できません。送信前に本文を控えてください。';}};
  form.oninput=saveDraft;
  if($('#reload-edit'))$('#reload-edit').onclick=async()=>{if(!confirm('入力中の下書きを破棄し、最新の内容を読み直しますか？'))return;try{const fresh=mode==='edit'?await api('/chapters/'+context.id):(await api('/stories/'+context.story_id)).branches.find(b=>b.id===context.id);localStorage.removeItem(draftKey);dialog.close();editor(mode,fresh,readingBranch);}catch(e){form.querySelector('.error').textContent=e.message;}};
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;form.querySelector('.error').textContent='';saveDraft();try{
    const input=Object.fromEntries(new FormData(form));let path,method='POST';
    if(mode==='new')path='/stories';else if(mode==='edit'){path='/chapters/'+context.id;method='PATCH';input.expectedRevision=Number(input.expectedRevision);}else if(mode==='append'){path=`/branches/${context.id}/chapters`;input.expectedHeadId=Number(input.expectedHeadId);}else path=`/chapters/${context.id}/${mode}`;
    const created=await api(path,method,input,editingUserId);try{localStorage.removeItem(draftKey);}catch{}dialog.close();toast(mode==='edit'?'編集を保存しました。':'投稿しました。');
    const hash=`#chapter/${created.chapterId||context.id}?branch=${created.branchId||readingBranch||context.branch_id}`;
    if(location.hash===hash)await render();else location.hash=hash;
  }catch(err){form.querySelector('.error').textContent=err.message;
    if(!user&&auth.mode==='oidc'){const link=document.createElement('a');link.href=basePath+'/auth/login';link.className='button';link.textContent='再ログイン（本文を控えてから進んでください）';form.querySelector('.error').append(document.createElement('br'),link);}
  }finally{button.disabled=false;}};
  dialog.showModal();
}
async function render() {
  const generation=++viewGeneration;
  if(!user){login();return;}
  app.innerHTML='<p class="hint">物語を読み込み中…</p>';
  const hash=location.hash.slice(1), [route,query]=hash.split('?'), params=new URLSearchParams(query||'');
  try{if(route.startsWith('story/'))await storyView(Number(route.split('/')[1]),generation,params);else if(route.startsWith('chapter/'))await chapterView(Number(route.split('/')[1]),generation,params);else await library(params,generation);}catch(e){if(generation===viewGeneration){if(!user)login();else app.innerHTML=`<div class="empty"><h3>読み込めませんでした</h3><p>${esc(e.message)}</p><a class="button secondary" href="#">一覧へ戻る</a></div>`;}}window.scrollTo(0,0);
}
window.addEventListener('hashchange',render);
try{const me=await api('/me');user=me.user;auth=me.auth||auth;nav();await render();}catch(e){app.innerHTML=`<p role="alert">${esc(e.message)} 再読み込みしてください。</p>`;}
