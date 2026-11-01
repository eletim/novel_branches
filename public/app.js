import {branchPath,selectReading,candidatesFor,branchForCandidate} from './reading.mjs';
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
  $('#nav').innerHTML = user ? `<span class="username">${esc(user.display_name)}</span><button class="quiet small" id="write">作品を書く</button><button class="quiet small" id="logout">ログアウト</button>` : '<span class="meta">小さな創作の部屋</span>';
  if(user) {$('#write').onclick=()=>editor('new');$('#logout').onclick=async()=>{try{const result=await api('/logout','POST',{});if(result.logoutUrl){location.assign(result.logoutUrl);return;}user=null;nav();await render();}catch(e){toast(e.message);}};}
}
function login() {
  app.innerHTML=`<section class="hero"><div><span class="eyebrow">A STORY CAN HAVE MORE THAN ONE FUTURE</span><h1>その物語には、<br>まだ別の続きがある。</h1><p>読む。書く。分かれて、広がる。<br>ひとつの物語から生まれる、みんなの平行世界。</p></div>${art()}</section><section class="login"><span class="eyebrow">WELCOME TO YOUR WRITING ROOM</span><h2>創作の部屋に入る</h2>${auth.mode==='oidc'?'<p class="hint">参加用アカウントでログインしてください。</p><a class="button" href="'+basePath+'/auth/login">ログイン →</a>':'<form id="login"><label for="username">ユーザー名</label><input id="username" name="username" autocomplete="username" required maxlength="40"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><p class="error" role="alert"></p><button type="submit">ログイン →</button></form>'}<p class="hint">参加用のアカウントは管理者から受け取ってください。</p></section>`;
  if($('#login'))$('#login').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{user=(await api('/login','POST',Object.fromEntries(new FormData(form)))).user;nav();await render();}catch(err){form.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}};
}
function art(){return '<div class="hero-art" aria-label="共通の話から、2つの世界へ分岐"><div class="worlds"><span class="origin"><small>THE BEGINNING</small>ひとつの物語</span><span class="connector">⑂</span><span><small>WORLD A</small>あなたの続き</span><span><small>WORLD B</small>誰かの続き</span></div></div>';}
async function library(params,generation) {
  const view=params.get('view')==='all'?'all':'normal',q=params.get('q')||'', sort=params.get('sort')||'new', offset=Math.max(0,Number(params.get('offset'))||0);
  const {stories}=await api(`/stories?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}&offset=${offset}&limit=12&view=${view}`);
  if(generation!==viewGeneration)return;
  app.innerHTML=`<section><div class="toolbar"><h2>作品一覧</h2><form class="search" id="search"><input name="q" aria-label="作品を検索" placeholder="作品名・あらすじで探す" value="${esc(q)}" maxlength="200"><select name="view" aria-label="作品の表示"><option value="normal" ${view==='normal'?'selected':''}>通常</option><option value="all" ${view==='all'?'selected':''}>すべて</option></select><select name="sort" aria-label="並び順"><option value="new" ${sort==='new'?'selected':''}>新着順</option><option value="popular" ${sort==='popular'?'selected':''}>グッド順</option></select><button class="secondary small">検索</button></form></div><div class="cards">${stories.map(s=>`<a class="card" href="#story/${s.id}"><div class="card-content"><h3>${esc(s.title)}</h3><div class="meta">${esc(s.author)}</div><p class="summary">${esc(s.summary||'ここから、物語がはじまります。')}</p><div class="stats"><span>${s.branch_count}経路</span><span>全${s.chapter_count}話</span><span>♡ ${s.likes}</span></div></div></a>`).join('') || `<div class="empty"><h3>${q?'作品が見つかりませんでした':'最初の物語を、ここから。'}</h3><p>${q?'検索する言葉を変えてみてください。':'「作品を書く」から、第一話を投稿できます。'}</p></div>`}</div><div class="pagination">${offset?'<button class="secondary" id="prev">← 前のページ</button>':''}${stories.length===12?'<button class="secondary" id="next">次のページ →</button>':''}</div></section>`;
  $('#search [name=view]').onchange=()=>$('#search').requestSubmit();
  $('#search').onsubmit=e=>{e.preventDefault();location.hash='?'+new URLSearchParams(new FormData(e.currentTarget));};
  const page = n=>{params.set('offset',n);location.hash='?'+params;};
  if($('#prev'))$('#prev').onclick=()=>page(Math.max(0,offset-12));if($('#next'))$('#next').onclick=()=>page(offset+12);
}
function updatedTime(chapter) {
  const raw=chapter.updated_at||chapter.created_at,date=new Date(raw);
  return `<time datetime="${esc(raw)}" title="${esc(date.toLocaleString('ja-JP'))}">${esc(date.toLocaleString('ja-JP',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time>`;
}
function episodeRow(c,index,href) {
  return `<span class="toc-number">第${index+1}話</span><a class="toc-title" href="${href}">${esc(c.title)}</a><span class="toc-meta"><span class="toc-author">${esc(c.author)}</span>${updatedTime(c)}</span>`;
}
function branchButton(id,number,count) {
  return `<button class="branch-toggle" aria-label="第${number}話のほかの別案 ${count}件" ${count===0?'disabled':''} aria-expanded="false" aria-controls="${id}"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V12M12 12L5 6V3M12 12l7-6V3"/></svg><span class="branch-count" aria-hidden="true">${count}</span></button>`;
}
function bindBranches() {
  document.querySelectorAll('.branch-toggle').forEach(button=>button.onclick=()=>{const open=button.getAttribute('aria-expanded')==='true';button.setAttribute('aria-expanded',String(!open));document.getElementById(button.getAttribute('aria-controls')).hidden=open;});
}
function candidateRows(story,c,index,branch) {
  return candidatesFor(story,c).filter(candidate=>candidate.id!==c.id).map(candidate=>`<div class="toc-candidate" data-candidate="${candidate.id}">${episodeRow(candidate,index,`#chapter/${candidate.id}?branch=${branchForCandidate(story,candidate,branch.id)}`)}</div>`).join('');
}
function branchSelect(story,branch) {
  return `<select class="reading-branch" aria-label="読書経路">${story.branches.map(b=>`<option value="${b.id}" ${b.id===branch.id?'selected':''}>${esc(b.id===story.main_branch_id?'Main':b.title)}</option>`).join('')}</select>`;
}
function bindBranchSelect(story,chapterIndex=null) {
  $('.reading-branch').onchange=e=>{
    const id=Number(e.target.value),path=branchPath(story,id),chapter=chapterIndex===null?null:path[Math.min(chapterIndex,path.length-1)];
    location.hash=chapter?`#chapter/${chapter.id}?branch=${id}`:`#story/${story.id}?branch=${id}`;
  };
}
async function storyInfo(id,generation,params) {
  const story=await api('/stories/'+id),{branch}=selectReading(story,params.get('branch'));
  if(generation!==viewGeneration)return;
  app.innerHTML=`<section class="story-info"><div class="info-top"><a class="back info-to-toc" href="#story/${id}?branch=${branch.id}">← 目次</a>${story.author_id===user.id?'<button class="quiet small" id="edit-story-info">編集</button>':''}</div><h1>${esc(story.title)}</h1><p class="meta">最初の制作者：${esc(story.author)}</p><h2>あらすじ</h2><p class="info-text">${esc(story.summary)}</p><p class="meta">ホーム一覧：${story.hidden_from_home?'デフォルト非表示':'通常表示'}</p><h2>設定メモ</h2><div class="setting-notes info-text">${esc(story.setting_notes)||'<span class="meta">未記入</span>'}</div></section>`;
  if($('#edit-story-info'))$('#edit-story-info').onclick=()=>storyInfoEditor(story,branch.id);
}
function storyInfoEditor(story,branchId) {
  if(dialog.open)dialog.close();
  const editingUserId=user.id,key=`novel-branches:draft:${editingUserId}:story-info:${story.id}`;
  let draft={};try{draft=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
  dialog.innerHTML=`<div class="dialog-head"><h2>作品情報の編集</h2><button class="quiet small" id="close-editor" aria-label="閉じる">✕</button></div><form id="story-info-form"><label for="info-title">作品タイトル</label><input id="info-title" name="title" maxlength="120" required value="${esc(draft.title??story.title)}"><label for="info-summary">あらすじ</label><textarea id="info-summary" name="summary" class="short" maxlength="2000">${esc(draft.summary??story.summary)}</textarea><label for="info-visibility">ホーム一覧</label><select id="info-visibility" name="visibility"><option value="normal">通常表示</option><option value="hidden" ${(draft.visibility??(story.hidden_from_home?'hidden':'normal'))==='hidden'?'selected':''}>デフォルト非表示</option></select><label for="info-notes">設定メモ</label><textarea id="info-notes" name="settingNotes" maxlength="100000">${esc(draft.settingNotes??story.setting_notes)}</textarea><input type="hidden" name="expectedRevision" value="${esc(draft.expectedRevision??story.revision)}"><div class="form-actions"><span class="hint" id="draft-status">下書きはこのブラウザに自動保存</span><button type="submit">保存</button></div><button type="button" class="quiet small" id="reload-story-info">下書きを破棄して最新の内容を読み直す</button><p class="error" role="alert"></p></form>`;
  const form=$('#story-info-form');$('#close-editor').onclick=()=>dialog.close();
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(Object.fromEntries(new FormData(form))));$('#draft-status').textContent='下書き保存済み（このブラウザ）';}catch{$('#draft-status').textContent='下書きを保存できません。内容を控えてください。';}};
  form.oninput=save;form.onchange=save;
  $('#reload-story-info').onclick=async()=>{if(!confirm('入力中の下書きを破棄し、最新の作品情報を読み直しますか？'))return;try{const fresh=await api('/stories/'+story.id);localStorage.removeItem(key);storyInfoEditor(fresh,branchId);}catch(e){form.querySelector('.error').textContent=e.message;}};
  form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;save();form.querySelector('.error').textContent='';const values=Object.fromEntries(new FormData(form));try{await api('/stories/'+story.id,'PATCH',{title:values.title,summary:values.summary,settingNotes:values.settingNotes,hiddenFromHome:values.visibility==='hidden',expectedRevision:Number(values.expectedRevision)},editingUserId);try{localStorage.removeItem(key);}catch{}dialog.close();toast('作品情報を保存しました。');await render();}catch(e){form.querySelector('.error').textContent=e.message;if(!user&&auth.mode==='oidc'){const a=document.createElement('a');a.href=basePath+'/auth/login';a.textContent='再ログイン';form.querySelector('.error').append(document.createElement('br'),a);}}finally{button.disabled=false;}};
  dialog.showModal();
}
async function storyView(id,generation,params) {
  const story=await api('/stories/'+id),{branch,path}=selectReading(story,params.get('branch'));
  if(generation!==viewGeneration)return;
  app.innerHTML=`<section class="story-toc"><div class="info-top"><a class="back" href="#">← 作品一覧</a><a class="quiet small" id="story-info-link" href="#info/${id}?branch=${branch.id}">作品情報</a></div><h1>${esc(story.title)}</h1><p class="meta story-creator">最初の制作者：${esc(story.author)}</p><p class="summary story-summary">${esc(story.summary)}</p><div class="reading-controls">${branchSelect(story,branch)}</div><h2 class="sr-only">目次</h2><ol class="toc-list">${path.map((c,i)=>`<li class="toc-item" data-chapter="${c.id}"><div class="toc-row">${episodeRow(c,i,`#chapter/${c.id}?branch=${branch.id}`)}${branchButton('candidates-'+c.id,i+1,candidatesFor(story,c).length-1)}</div><div class="toc-candidates" id="candidates-${c.id}" hidden>${candidateRows(story,c,i,branch)}</div></li>`).join('')}</ol></section>`;
  bindBranches();bindBranchSelect(story);
}
async function chapterView(id,generation,params) {
  const c=await api('/chapters/'+id),story=await api('/stories/'+c.story_id);
  const {branch,path}=selectReading(story,params.get('branch'),c.id),index=path.findIndex(ch=>ch.id===c.id);
  const previous=path[index-1],next=path[index+1],suffix=`?branch=${branch.id}`;
  if(generation!==viewGeneration)return;
  app.innerHTML=`<div class="reader-shell"><div class="reader-top"><a class="back to-toc" href="#story/${c.story_id}${suffix}">${esc(story.title)} · 目次</a><button class="quiet small" id="open-editor">Editor</button></div><div class="reader-heading"><span class="eyebrow">第${index+1}話</span><h1>${esc(c.title)}</h1><div class="meta chapter-creator">${esc(c.author)} · ${updatedTime(c)}</div><div class="reading-controls">${branchSelect(story,branch)}</div><div class="reader-branches">${branchButton('reader-candidates',index+1,candidatesFor(story,c).length-1)}<div id="reader-candidates" class="toc-candidates" hidden>${candidateRows(story,c,index,branch)}</div></div></div><article class="reader-body">${esc(c.body)}</article><nav class="chapter-nav" aria-label="話の前後移動">${previous?`<a class="previous-chapter" href="#chapter/${previous.id}${suffix}">← 前の話</a>`:'<span></span>'}<a class="to-toc" href="#story/${c.story_id}${suffix}">目次</a>${next?`<a class="next-chapter" href="#chapter/${next.id}${suffix}">次の話 →</a>`:'<span></span>'}</nav><div class="reader-actions"><button id="like" class="quiet ${c.liked?'liked':''}" aria-pressed="${!!c.liked}">${c.liked?'♥':'♡'} グッド ${c.likes}</button></div></div>`;
  bindBranches();bindBranchSelect(story,index);
  $('#open-editor').onclick=()=>{
    dialog.innerHTML=`<div class="dialog-head"><h2>Editor</h2><button class="quiet small" id="close-editor" aria-label="閉じる">✕</button></div><div class="editor-menu">${c.author_id===user.id?'<button id="edit-chapter" class="secondary">この話の編集</button>':''}${branch.head_id===c.id?'<button id="append" class="secondary">次の話の追加</button>':''}<button id="alternate" class="secondary">この話の別案</button><button id="fork" class="secondary">次の話から分岐</button></div><p class="hint">編集はこの話の制作者のみ。続話・別案・分岐は参加者なら追加できます。途中の話から続きを作る場合は「次の話から分岐」を選んでください。</p>`;
    $('#close-editor').onclick=()=>dialog.close();
    for(const [selector,mode,context] of [['#edit-chapter','edit',c],['#append','append',branch],['#alternate','alternate',c],['#fork','fork',c]])if($(selector))$(selector).onclick=()=>editor(mode,context,branch.id);
    dialog.showModal();
  };
  $('#like').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const updated=await api(`/chapters/${c.id}/like`,'PUT',{liked:!c.liked});c.liked=updated.liked;button.textContent=`${c.liked?'♥':'♡'} グッド ${updated.likes}`;button.className=c.liked?'quiet liked':'quiet';button.setAttribute('aria-pressed',!!c.liked);}catch(err){toast(err.message);}finally{button.disabled=false;}};
}
function editor(mode,context={},readingBranch=0) {
  if(dialog.open)dialog.close();
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
  try{if(route.startsWith('info/'))await storyInfo(Number(route.split('/')[1]),generation,params);else if(route.startsWith('story/'))await storyView(Number(route.split('/')[1]),generation,params);else if(route.startsWith('chapter/'))await chapterView(Number(route.split('/')[1]),generation,params);else await library(params,generation);}catch(e){if(generation===viewGeneration){if(!user)login();else app.innerHTML=`<div class="empty"><h3>読み込めませんでした</h3><p>${esc(e.message)}</p><a class="button secondary" href="#">一覧へ戻る</a></div>`;}}window.scrollTo(0,0);
}
window.addEventListener('hashchange',render);
try{const me=await api('/me');user=me.user;auth=me.auth||auth;nav();await render();}catch(e){app.innerHTML=`<p role="alert">${esc(e.message)} 再読み込みしてください。</p>`;}
