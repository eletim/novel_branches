const $ = s => document.querySelector(s);
const app = $('#app'), dialog = $('#editor');
let user, viewGeneration = 0, toastTimer;
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(path,method='GET',data) {
  const res = await fetch('/api'+path,{method,headers:data ? {'Content-Type':'application/json'} : {},body:data ? JSON.stringify(data) : undefined});
  const result = await res.json();
  if(!res.ok) {if(res.status===401 && path!='/login') {user=null;nav();} throw Error(result.error || '通信できませんでした。');}
  return result;
}
function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').style.display='block';toastTimer=setTimeout(()=>$('#toast').style.display='none',3500);}
function nav() {
  $('#nav').innerHTML = user ? `<span class="username">${esc(user.display_name)}</span><button class="small" id="write">＋ 作品を書く</button><button class="secondary small" id="logout">ログアウト</button>` : '<span class="meta">小さな創作の部屋</span>';
  if(user) {$('#write').onclick=()=>editor('new');$('#logout').onclick=async()=>{try{await api('/logout','POST',{});user=null;nav();await render();}catch(e){toast(e.message);}};}
}
function login() {
  app.innerHTML=`<section class="hero"><div><span class="eyebrow">A STORY CAN HAVE MORE THAN ONE FUTURE</span><h1>その物語には、<br>まだ別の続きがある。</h1><p>読む。書く。分かれて、広がる。<br>ひとつの物語から生まれる、みんなの平行世界。</p></div>${art()}</section><section class="login"><span class="eyebrow">WELCOME TO YOUR WRITING ROOM</span><h2>創作の部屋に入る</h2><form id="login"><label for="username">ユーザー名</label><input id="username" name="username" autocomplete="username" required maxlength="40"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><p class="error" role="alert"></p><button type="submit">ログイン →</button></form><p class="hint">参加用のアカウントは管理者から受け取ってください。</p></section>`;
  $('#login').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{user=(await api('/login','POST',Object.fromEntries(new FormData(form)))).user;nav();await render();}catch(err){form.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}};
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
async function storyView(id,generation) {
  const story=await api('/stories/'+id);
  const paths=await Promise.all(story.branches.map(b=>api(`/branches/${b.id}/path`)));
  if(generation!==viewGeneration)return;
  const children = new Map();for(const c of story.chapters){const key=c.parent_id||0;if(!children.has(key))children.set(key,[]);children.get(key).push(c);}
  // Iterative rendering keeps deeply branched stories from overflowing the call stack.
  let tree='',stack=[{key:0,close:false}];while(stack.length){const item=stack.pop();if(item.close){tree+='</li></ul>';continue;}const list=children.get(item.key)||[];for(let i=list.length-1;i>=0;i--){stack.push({chapter:list[i]});}if(item.chapter){const c=item.chapter;tree+=`<ul class="tree"><li><a href="#chapter/${c.id}">${esc(c.title)} <small>♡ ${c.likes}</small></a><small>${esc(c.author)}</small>`;stack.push({close:true});stack.push({key:c.id});}}
  app.innerHTML=`<a class="back" href="#">← 物語の一覧へ</a><div class="story-heading"><span class="eyebrow">A GROWING STORY</span><h1>${esc(story.title)}</h1><div class="meta">はじまりの作者：${esc(story.author)} · ${story.branches.length}つの展開</div><p class="summary">${esc(story.summary)}</p></div><div class="layout"><section><h2 class="section-title">読む世界を選ぶ</h2><div class="branch-list">${story.branches.map((b,i)=>`<article class="branch-item"><span class="tag">${b.fork_chapter_id?'PARALLEL WORLD':'ORIGINAL WORLD'}</span><h3>${esc(b.title)}</h3><div class="meta">${esc(b.author)} · ♡ ${b.likes}${b.fork_chapter_id?` · <a href="#chapter/${b.fork_chapter_id}">分岐元の話へ ↗</a>`:''}</div><ol>${paths[i].chapters.map(c=>`<li class="${c.branch_id!==b.id?'inherited':''}"><a href="#chapter/${c.id}">${esc(c.title)}</a>${c.branch_id!==b.id?' <span class="tag">共通</span>':''}</li>`).join('')}</ol><div class="branch-actions"><a class="button small" href="#chapter/${paths[i].chapters[0].id}">最初から読む →</a><a class="button secondary small" href="#chapter/${b.head_id}">最新話へ</a>${b.author_id===user.id?`<button class="secondary small" data-append="${b.id}">続きを書く</button>`:''}</div></article>`).join('')}</div></section><aside class="panel"><h2>物語の分岐</h2><p class="hint">タイトルを選ぶと、その話を読めます。</p>${tree}<p class="hint">共通の話は同じ本文を参照します。<br>グッドは各話に付けられます。</p></aside></div>`;
  document.querySelectorAll('[data-append]').forEach(button=>button.onclick=()=>editor('append',story.branches.find(b=>b.id===Number(button.dataset.append))));
}
async function chapterView(id,generation) {
  const c=await api('/chapters/'+id), story=await api('/stories/'+c.story_id), branch=story.branches.find(b=>b.id===c.branch_id);
  if(generation!==viewGeneration)return;
  app.innerHTML=`<div class="reader-shell"><a class="back" href="#story/${c.story_id}">← ${esc(story.title)} · 展開を選ぶ</a><div class="reader-heading"><span class="eyebrow">${esc(c.branch_title)}</span><h1>${esc(c.title)}</h1><div class="meta">${esc(c.author)} · ${new Date(c.created_at).toLocaleDateString('ja-JP')}</div></div><article class="reader-body">${esc(c.body)}</article><div class="reader-actions"><button id="like" class="${c.liked?'liked':'secondary'}" aria-pressed="${!!c.liked}">${c.liked?'♥':'♡'} グッド ${c.likes}</button><button id="fork" class="secondary">⑂ ここから別の続きを書く</button>${branch.author_id===user.id && branch.head_id===c.id?'<button id="append">続きを書く →</button>':''}</div><p class="hint">「ここから別の続きを書く」は、この話までを共通にして次の話を投稿します。</p><section class="continuations"><h2 class="section-title">この先の物語</h2>${c.children.map(next=>`<a href="#chapter/${next.id}"><span class="tag">${next.branch_id===c.branch_id?'この世界の続き':'別の世界へ分岐'}</span><h3>${esc(next.title)} →</h3><span class="meta">${esc(next.branch_title)} · ${esc(next.author)}</span></a>`).join('') || '<p class="hint">この先は、まだ書かれていません。</p>'}</section>${c.parent_id?`<a class="back" href="#chapter/${c.parent_id}">← 前の話へ</a>`:''}</div>`;
  $('#fork').onclick=()=>editor('fork',c);if($('#append'))$('#append').onclick=()=>editor('append',branch);
  $('#like').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const updated=await api(`/chapters/${c.id}/like`,'PUT',{liked:!c.liked});c.liked=updated.liked;button.textContent=`${c.liked?'♥':'♡'} グッド ${updated.likes}`;button.className=c.liked?'liked':'secondary';button.setAttribute('aria-pressed',!!c.liked);}catch(err){toast(err.message);}finally{button.disabled=false;}};
}
function editor(mode,context={}) {
  const draftKey=`novel-branches:draft:${user.id}:${mode}:${context.id||0}`;
  let draft={};try{draft=JSON.parse(localStorage.getItem(draftKey)||'{}');}catch{}
  const field=(name,label,max,value='',textarea=false)=>`<label for="edit-${name}">${label}</label>${textarea?`<textarea class="${name==='summary'?'short':''}" id="edit-${name}" name="${name}" maxlength="${max}" ${name==='summary'?'':'required'}>${esc(draft[name]??value)}</textarea>`:`<input id="edit-${name}" name="${name}" maxlength="${max}" value="${esc(draft[name]??value)}" required>`}`;
  dialog.innerHTML=`<div class="dialog-head"><div><span class="eyebrow">WRITE YOUR WORLD</span><h2>${mode==='new'?'新しい物語をはじめる':mode==='fork'?'別の続きを書く':'続きを書く'}</h2></div><button class="secondary small" id="close-editor" aria-label="閉じる">✕</button></div><p class="hint">${mode==='fork'?`「${esc(context.title)}」の読了後から分岐します。`:mode==='append'?`「${esc(context.title)}」の最新話に続きます。`:'作品の紹介と、最初の一話を投稿します。'}</p><form id="edit-form">${mode==='new'?field('title','作品名',120)+field('summary','あらすじ（任意）',2000,'',true):''}${mode==='fork'?field('branchTitle','分岐名',120):''}${field(mode==='new'?'chapterTitle':'title','話のタイトル',120)}${field('body','本文',100000,'',true)}<div class="form-actions"><span class="hint" id="draft-status">下書きはこのブラウザに自動保存</span><button type="submit">この話を投稿する →</button></div><p class="hint">投稿した話は、この初期版では編集できません。</p><p class="error" role="alert"></p></form>`;
  const form=$('#edit-form');
  $('#close-editor').onclick=()=>dialog.close();
  const saveDraft=()=>{try{localStorage.setItem(draftKey,JSON.stringify(Object.fromEntries(new FormData(form))));$('#draft-status').textContent='下書き保存済み（このブラウザ）';}catch{$('#draft-status').textContent='下書きを保存できません。投稿前に本文を控えてください。';}};
  form.oninput=saveDraft;
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;form.querySelector('.error').textContent='';try{const input=Object.fromEntries(new FormData(form));const path=mode==='new'?'/stories':mode==='fork'?`/chapters/${context.id}/fork`:`/branches/${context.id}/chapters`;if(mode==='append')input.expectedHeadId=context.head_id;const created=await api(path,'POST',input);try{localStorage.removeItem(draftKey);}catch{}dialog.close();toast('投稿しました。物語の世界が広がりました。');location.hash='chapter/'+created.chapterId;}catch(err){form.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}};
  dialog.showModal();
}
async function render() {
  const generation=++viewGeneration;
  if(!user){login();return;}
  app.innerHTML='<p class="hint">物語を読み込み中…</p>';
  const hash=location.hash.slice(1), [route,query]=hash.split('?'), params=new URLSearchParams(query||'');
  try{if(route.startsWith('story/'))await storyView(Number(route.split('/')[1]),generation);else if(route.startsWith('chapter/'))await chapterView(Number(route.split('/')[1]),generation);else await library(params,generation);}catch(e){if(generation===viewGeneration){if(!user)login();else app.innerHTML=`<div class="empty"><h3>読み込めませんでした</h3><p>${esc(e.message)}</p><a class="button secondary" href="#">一覧へ戻る</a></div>`;}}window.scrollTo(0,0);
}
window.addEventListener('hashchange',render);
try{user=(await api('/me')).user;nav();await render();}catch(e){app.innerHTML=`<p role="alert">${esc(e.message)} 再読み込みしてください。</p>`;}
