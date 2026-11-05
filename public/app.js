import {DEFAULT_READER_SETTINGS,normalizeReaderSettings,loadReaderSettings,saveReaderSettings} from './reader-settings.mjs';
import {branchPath,selectReading,candidatesFor,branchForCandidate,reorderableChapters} from './reading.mjs';
const basePath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const $ = s => document.querySelector(s);
const app = $('#app'), dialog = $('#editor');
let user, auth = {mode:'local'}, viewGeneration = 0, toastTimer;
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let readerSettings=loadReaderSettings();
function editIcon(id,label) {
  return `<button class="quiet icon-button edit-entry" id="${id}" title="${label}" aria-label="${label}" aria-haspopup="dialog"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z"/></svg></button>`;
}
function applyReaderSettings() {
  document.body.dataset.readerTheme=readerSettings.theme;
  document.body.dataset.readerFont=readerSettings.font;
  document.body.dataset.readerSize=readerSettings.size;
}
function clearReaderSettings() {
  for(const key of ['readerTheme','readerFont','readerSize'])delete document.body.dataset[key];
}
function closeReaderSettings(focus=true) {
  const panel=$('#reader-settings'),button=$('#open-reader-settings');
  if(panel)panel.hidden=true;if(button){button.setAttribute('aria-expanded','false');if(focus)button.focus();}
}
function readerSegments(setting,label,options) {
  return `<div class="reader-setting-group"><h3 id="reader-${setting}-label">${label}</h3><div id="reader-${setting}" class="reader-segments segments-${options.length}" role="radiogroup" aria-labelledby="reader-${setting}-label" data-setting="${setting}">${options.map(([value,text])=>`<button type="button" class="reader-choice" role="radio" data-value="${value}" aria-checked="false" tabindex="-1">${text}</button>`).join('')}</div></div>`;
}
function bindReaderSettings() {
  const button=$('#open-reader-settings'),panel=$('#reader-settings');
  const sync=()=>{for(const group of panel.querySelectorAll('[role=radiogroup]'))for(const choice of group.querySelectorAll('[role=radio]')){const selected=String(readerSettings[group.dataset.setting])===choice.dataset.value;choice.setAttribute('aria-checked',String(selected));choice.tabIndex=selected?0:-1;}};
  const preview=()=>{applyReaderSettings();sync();$('#reader-settings-status').textContent=saveReaderSettings(readerSettings)?'':'このブラウザに保存できません。現在の画面には反映しています。';};
  const choose=(group,choice)=>{readerSettings=normalizeReaderSettings({...readerSettings,[group.dataset.setting]:group.dataset.setting==='size'?Number(choice.dataset.value):choice.dataset.value});preview();};
  sync();
  button.onclick=()=>{if(!panel.hidden){closeReaderSettings();return;}panel.hidden=false;button.setAttribute('aria-expanded','true');$('#reader-size [aria-checked="true"]').focus();};
  $('#close-reader-settings').onclick=()=>closeReaderSettings();
  for(const group of panel.querySelectorAll('[role=radiogroup]')){
    for(const choice of group.querySelectorAll('[role=radio]'))choice.onclick=()=>choose(group,choice);
    group.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;const choices=[...group.querySelectorAll('[role=radio]')],current=choices.indexOf(e.target);if(current<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?choices.length-1:(current+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+choices.length)%choices.length;choose(group,choices[next]);choices[next].focus();};
  }
  $('#reset-reader-settings').onclick=()=>{readerSettings={...DEFAULT_READER_SETTINGS};preview();};
}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!dialog.open&&$('#reader-settings')&&!$('#reader-settings').hidden){e.preventDefault();closeReaderSettings();}});
async function api(path,method='GET',data,expectedUserId=user?.id) {
  if(data && path!=='/login' && !user)throw Error('ログインしてください。下書きはこの画面に残っています。');
  const res = await fetch(basePath+'/api'+path,{method,headers:data ? {'Content-Type':'application/json',...(user ? {'X-Novel-User':String(expectedUserId)} : {})} : {},body:data ? JSON.stringify(data) : undefined});
  const result = await res.json();
  if(!res.ok) {if(res.status===401 && path!='/login') {user=null;nav();} throw Error(result.error || '通信できませんでした。');}
  return result;
}
function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').style.display='block';toastTimer=setTimeout(()=>$('#toast').style.display='none',3500);}
function nav() {
  $('#nav').innerHTML = user ? `<span class="username">${esc(user.display_name)}</span>${editIcon('write','新しい作品を書く')}<button class="quiet small" id="logout">ログアウト</button>` : '<span class="meta">小さな創作の部屋</span>';
  if(user) {$('#write').onclick=()=>editor('new');$('#logout').onclick=async()=>{try{const result=await api('/logout','POST',{});if(result.logoutUrl){location.assign(result.logoutUrl);return;}user=null;nav();await render();}catch(e){toast(e.message);}};}
}
function login() {
  clearReaderSettings();
  app.innerHTML=`<section class="hero"><div><span class="eyebrow">A STORY CAN HAVE MORE THAN ONE FUTURE</span><h1>その物語には、<br>まだ別の続きがある。</h1><p>読む。書く。分かれて、広がる。<br>ひとつの物語から生まれる、みんなの平行世界。</p></div>${art()}</section><section class="login"><span class="eyebrow">WELCOME TO YOUR WRITING ROOM</span><h2>創作の部屋に入る</h2>${auth.mode==='oidc'?'<p class="hint">参加用アカウントでログインしてください。</p><a class="button" href="'+basePath+'/auth/login">ログイン →</a>':'<form id="login"><label for="username">ユーザー名</label><input id="username" name="username" autocomplete="username" required maxlength="40"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256"><p class="error" role="alert"></p><button type="submit">ログイン →</button></form>'}<p class="hint">参加用のアカウントは管理者から受け取ってください。</p></section>`;
  if($('#login'))$('#login').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button');button.disabled=true;try{user=(await api('/login','POST',Object.fromEntries(new FormData(form)))).user;nav();await render();}catch(err){form.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}};
}
function art(){return '<div class="hero-art" aria-label="共通の話から、2つの世界へ分岐"><div class="worlds"><span class="origin"><small>THE BEGINNING</small>ひとつの物語</span><span class="connector">⑂</span><span><small>WORLD A</small>あなたの続き</span><span><small>WORLD B</small>誰かの続き</span></div></div>';}
async function library(params,generation) {
  const view=params.get('view')==='all'?'all':'normal',q=params.get('q')||'', sort=params.get('sort')||'new', offset=Math.max(0,Number(params.get('offset'))||0);
  const {stories}=await api(`/stories?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}&offset=${offset}&limit=12&view=${view}`);
  if(generation!==viewGeneration)return;
  app.innerHTML=`<section><div class="toolbar"><h2>作品一覧</h2><form class="search" id="search"><input name="q" aria-label="作品を検索" placeholder="作品名・あらすじで探す" value="${esc(q)}" maxlength="200"><select name="view" aria-label="作品の表示"><option value="normal" ${view==='normal'?'selected':''}>通常</option><option value="all" ${view==='all'?'selected':''}>すべて</option></select><select name="sort" aria-label="並び順"><option value="new" ${sort==='new'?'selected':''}>新着順</option><option value="popular" ${sort==='popular'?'selected':''}>グッド順</option></select><button class="secondary small">検索</button></form></div><div class="cards">${stories.map(s=>`<a class="card" href="#story/${s.id}"><div class="card-content"><h3>${esc(s.title)}</h3><div class="meta">${esc(s.author)}</div><p class="summary">${esc(s.summary||'ここから、物語がはじまります。')}</p><div class="stats"><span>${s.branch_count}経路</span><span>全${s.chapter_count}話</span><span title="全経路の本文・共通の話は1回だけ集計・改行を除く">${characterLabel(s.character_count)}</span><span>♡ ${s.likes}</span></div></div></a>`).join('') || `<div class="empty"><h3>${q?'作品が見つかりませんでした':'最初の物語を、ここから。'}</h3><p>${q?'検索する言葉を変えてみてください。':'鉛筆アイコンから、第一話を投稿できます。'}</p></div>`}</div><div class="pagination">${offset?'<button class="secondary" id="prev">← 前のページ</button>':''}${stories.length===12?'<button class="secondary" id="next">次のページ →</button>':''}</div></section>`;
  $('#search [name=view]').onchange=()=>$('#search').requestSubmit();
  $('#search').onsubmit=e=>{e.preventDefault();location.hash='?'+new URLSearchParams(new FormData(e.currentTarget));};
  const page = n=>{params.set('offset',n);location.hash='?'+params;};
  if($('#prev'))$('#prev').onclick=()=>page(Math.max(0,offset-12));if($('#next'))$('#next').onclick=()=>page(offset+12);
}
function updatedTime(chapter) {
  const raw=chapter.updated_at||chapter.created_at,date=new Date(raw);
  return `<time datetime="${esc(raw)}" title="${esc(date.toLocaleString('ja-JP'))}">${esc(date.toLocaleString('ja-JP',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</time>`;
}
const characterLabel=n=>Number(n||0).toLocaleString('ja-JP')+'字';
function episodeRow(c,index,href) {
  return `<span class="toc-number">第${index+1}話</span><a class="toc-title" href="${href}">${esc(c.title)}</a><span class="toc-meta"><span class="toc-author">${esc(c.author)}</span>${updatedTime(c)}<span class="character-count" title="本文のみ・改行を除く">${characterLabel(c.character_count)}</span></span>`;
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
  app.innerHTML=`<section class="story-info"><div class="info-top"><a class="back info-to-toc" href="#story/${id}?branch=${branch.id}">← 目次</a>${story.can_manage?editIcon('edit-story-info','作品情報を編集'):''}</div><h1>${esc(story.title)}</h1><p class="meta">最初の制作者：${esc(story.author)}</p><h2>あらすじ</h2><p class="info-text">${esc(story.summary)}</p><p class="meta">ホーム一覧：${story.hidden_from_home?'デフォルト非表示':'通常表示'}</p><p class="meta">作品全体：${characterLabel(story.character_count)}（共通の話は1回だけ集計）</p><h2>設定メモ</h2><div class="setting-notes info-text">${esc(story.setting_notes)||'<span class="meta">未記入</span>'}</div></section>`;
  if($('#edit-story-info'))$('#edit-story-info').onclick=()=>storyInfoEditor(story,branch.id);
}
function storyInfoEditor(story,branchId) {
  if(dialog.open)dialog.close();
  const editingUserId=user.id,key=`novel-branches:draft:${editingUserId}:story-info:${story.id}`;
  let draft={};try{draft=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
  dialog.innerHTML=`<div class="dialog-head"><h2>作品情報の編集</h2><button class="quiet icon-button" id="close-editor" title="閉じる" aria-label="閉じる">✕</button></div><form id="story-info-form"><label for="info-title">作品タイトル</label><input id="info-title" name="title" maxlength="120" required value="${esc(draft.title??story.title)}"><label for="info-summary">あらすじ</label><textarea id="info-summary" name="summary" class="short" maxlength="2000">${esc(draft.summary??story.summary)}</textarea><label for="info-visibility">ホーム一覧</label><select id="info-visibility" name="visibility"><option value="normal">通常表示</option><option value="hidden" ${(draft.visibility??(story.hidden_from_home?'hidden':'normal'))==='hidden'?'selected':''}>デフォルト非表示</option></select><label for="info-notes">設定メモ</label><textarea id="info-notes" name="settingNotes" maxlength="100000">${esc(draft.settingNotes??story.setting_notes)}</textarea><input type="hidden" name="expectedRevision" value="${esc(draft.expectedRevision??story.revision)}"><div class="form-actions"><span class="hint" id="draft-status">下書きはこのブラウザに自動保存</span><button type="submit">保存</button></div><button type="button" class="quiet small" id="reload-story-info">下書きを破棄して最新の内容を読み直す</button><p class="error" role="alert"></p></form>`;
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
  app.innerHTML=`<section class="story-toc"><div class="info-top"><a class="back" href="#">← 作品一覧</a><a class="quiet small" id="story-info-link" href="#info/${id}?branch=${branch.id}">作品情報</a></div><h1>${esc(story.title)}</h1><p class="meta story-creator">最初の制作者：${esc(story.author)}</p><p class="summary story-summary">${esc(story.summary)}</p><div class="toc-tools"><span class="meta" title="選択中の経路の本文・改行を除く">${characterLabel(path.reduce((sum,c)=>sum+c.character_count,0))}</span><button class="quiet small" id="copy-path">全文コピー</button>${story.can_manage?editIcon("reorder-chapters","話数の入れ替え"):""}<div class="reading-controls">${branchSelect(story,branch)}</div></div><h2 class="sr-only">目次</h2><ol class="toc-list">${path.map((c,i)=>`<li class="toc-item" data-chapter="${c.id}"><div class="toc-row">${episodeRow(c,i,`#chapter/${c.id}?branch=${branch.id}`)}${branchButton('candidates-'+c.id,i+1,candidatesFor(story,c).length-1)}</div><div class="toc-candidates" id="candidates-${c.id}" hidden>${candidateRows(story,c,i,branch)}</div></li>`).join('')}</ol></section>`;
  bindBranches();bindBranchSelect(story);
  $('#copy-path').onclick=()=>copyText(()=>api('/branches/'+branch.id+'/export').then(r=>r.text));
  if($('#reorder-chapters'))$('#reorder-chapters').onclick=()=>reorderEditor(story,branch);
}
async function chapterView(id,generation,params) {
  const c=await api('/chapters/'+id),story=await api('/stories/'+c.story_id);
  const {branch,path}=selectReading(story,params.get('branch'),c.id),index=path.findIndex(ch=>ch.id===c.id);
  const previous=path[index-1],next=path[index+1],suffix=`?branch=${branch.id}`;
  if(generation!==viewGeneration)return;
  app.innerHTML=`<div class="reader-shell"><div class="reader-top"><a class="back to-toc" href="#story/${c.story_id}${suffix}">${esc(story.title)} · 目次</a><div class="reader-tools"><button class="quiet icon-button reader-settings-trigger" id="open-reader-settings" title="ビューアー設定" aria-label="ビューアー設定" aria-expanded="false" aria-controls="reader-settings"><span aria-hidden="true">Aa</span></button>${editIcon('open-editor','この話の執筆メニュー')}</div></div><section id="reader-settings" class="reader-settings" aria-label="ビューアー設定" hidden><div class="settings-heading"><h2>ビューアー設定</h2><button class="quiet icon-button" id="close-reader-settings" aria-label="ビューアー設定を閉じる" title="閉じる">×</button></div><div class="settings-controls">${readerSegments('size','文字サイズ',[[16,'小'],[18,'中'],[24,'大'],[28,'特大']])}${readerSegments('theme','背景色',[['white','白'],['dark','黒'],['paper','生成り'],['blue','水色']])}${readerSegments('font','フォント',[['mincho','明朝'],['gothic','ゴシック'],['meiryo','メイリオ']])}</div><button class="quiet small" id="reset-reader-settings">初期設定に戻す</button><p id="reader-settings-status" class="hint" role="status"></p></section><div class="reader-heading"><span class="eyebrow">第${index+1}話</span><h1>${esc(c.title)}</h1><div class="meta chapter-creator">${esc(c.author)} · ${updatedTime(c)} · <span title="本文のみ・改行を除く">${characterLabel(c.character_count)}</span></div><div class="reader-branches"><div class="reading-controls">${branchSelect(story,branch)}</div>${branchButton('reader-candidates',index+1,candidatesFor(story,c).length-1)}<div id="reader-candidates" class="toc-candidates" hidden>${candidateRows(story,c,index,branch)}</div></div></div><article class="reader-body">${esc(c.body)}</article><nav class="chapter-nav" aria-label="話の前後移動">${previous?`<a class="previous-chapter" href="#chapter/${previous.id}${suffix}">← 前の話</a>`:'<span></span>'}<a class="to-toc" href="#story/${c.story_id}${suffix}">目次</a>${next?`<a class="next-chapter" href="#chapter/${next.id}${suffix}">次の話 →</a>`:'<span></span>'}</nav><div class="reader-actions"><button id="like" class="quiet ${c.liked?'liked':''}" aria-pressed="${!!c.liked}">${c.liked?'♥':'♡'} グッド ${c.likes}</button><button class="quiet small" id="copy-chapter">この話をコピー</button></div><details class="comments-panel"><summary>コメント <span id="comment-count">${c.comment_count}</span></summary><div id="comments-content"></div></details></div>`;
  applyReaderSettings();bindReaderSettings();bindBranches();bindBranchSelect(story,index);
  $('#copy-chapter').onclick=()=>copyText(()=>Promise.resolve(`${story.title}\n\n第${index+1}話　${c.title}\n\n${c.body}`));
  bindComments(c,generation);
  $('#open-editor').onclick=()=>{
    closeReaderSettings(false);
    dialog.innerHTML=`<div class="dialog-head"><h2>執筆</h2><button class="quiet icon-button" id="close-editor" title="閉じる" aria-label="閉じる">✕</button></div><div class="editor-menu">${c.author_id===user.id?'<button id="edit-chapter" class="secondary">この話の編集</button>':''}${branch.head_id===c.id?'<button id="append" class="secondary">次の話の追加</button>':''}<button id="alternate" class="secondary">この話の別案</button><button id="fork" class="secondary">次の話から分岐</button></div><p class="hint">編集はこの話の制作者のみ。続話・別案・分岐は参加者なら追加できます。途中の話から続きを作る場合は「次の話から分岐」を選んでください。</p>`;
    $('#close-editor').onclick=()=>dialog.close();
    for(const [selector,mode,context] of [['#edit-chapter','edit',c],['#append','append',branch],['#alternate','alternate',c],['#fork','fork',c]])if($(selector))$(selector).onclick=()=>editor(mode,context,branch.id);
    dialog.showModal();
  };
  $('#like').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const updated=await api(`/chapters/${c.id}/like`,'PUT',{liked:!c.liked});c.liked=updated.liked;button.textContent=`${c.liked?'♥':'♡'} グッド ${updated.likes}`;button.className=c.liked?'quiet liked':'quiet';button.setAttribute('aria-pressed',!!c.liked);}catch(err){toast(err.message);}finally{button.disabled=false;}};
}
async function copyText(load) {
  let value;
  try {
    // ClipboardItem preserves the click activation while an entire route is fetched.
    const pending=load();
    if(navigator.clipboard?.write&&window.ClipboardItem){
      const item=new ClipboardItem({'text/plain':pending.then(text=>{value=text;return new Blob([text],{type:'text/plain'});})});
      try{await navigator.clipboard.write([item]);toast('タイトルと本文をコピーしました。');return;}catch{}
    }
    value=await pending;
    if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(value);toast('タイトルと本文をコピーしました。');return;}catch{}}
    if(dialog.open)dialog.close();
    dialog.innerHTML=`<div class="dialog-head"><h2>全文コピー</h2><button class="quiet icon-button" id="close-copy" aria-label="閉じる">×</button></div><p class="hint">コピーを許可できないため、下の文章を選択してコピーしてください。</p><textarea id="copy-text" aria-label="コピーするタイトルと本文" readonly>${esc(value)}</textarea>`;
    $('#close-copy').onclick=()=>dialog.close();dialog.showModal();$('#copy-text').select();
  }catch(e){toast(e.message);}
}
function reorderEditor(story,branch) {
  const editingUserId=user.id,path=branchPath(story,branch.id),movable=reorderableChapters(story,branch.id),order=[...movable];
  if(dialog.open)dialog.close();
  dialog.innerHTML=`<div class="dialog-head"><h2>話数の入れ替え</h2><button class="quiet icon-button" id="close-reorder" aria-label="閉じる">×</button></div><p class="hint">ほかの経路と共有しない末尾の話を入れ替えます。本文・作者・グッド・コメントは各話に残ります。</p>${order.length<2?'<p>入れ替えられる話がありません。共有していない話が2話以上あると操作できます。</p>':'<ol id="reorder-list"></ol><button id="save-order">順番を保存</button>'}<p class="error" role="alert"></p>`;
  $('#close-reorder').onclick=()=>dialog.close();
  const draw=()=>{
    $('#reorder-list').innerHTML=order.map((c,i)=>`<li><span>第${path.length-order.length+i+1}話　${esc(c.title)}</span><button class="quiet icon-button" data-index="${i}" data-step="-1" aria-label="${esc(c.title)}を前へ" ${i===0?'disabled':''}>↑</button><button class="quiet icon-button" data-index="${i}" data-step="1" aria-label="${esc(c.title)}を後ろへ" ${i===order.length-1?'disabled':''}>↓</button></li>`).join('');
    for(const button of $('#reorder-list').querySelectorAll('button'))button.onclick=()=>{const i=Number(button.dataset.index),j=i+Number(button.dataset.step),step=button.dataset.step;[order[i],order[j]]=[order[j],order[i]];draw();const target=$(`#reorder-list [data-index="${j}"][data-step="${step}"]`);(target.disabled?target.parentElement.querySelector('button:not(:disabled)'):target).focus();};
  };
  if(order.length>=2){draw();$('#save-order').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{await api('/branches/'+branch.id+'/reorder','PUT',{expectedPathIds:path.map(c=>c.id),chapterIds:order.map(c=>c.id)},editingUserId);dialog.close();toast('話の順番を保存しました。');await render();}catch(err){dialog.querySelector('.error').textContent=err.message;}finally{button.disabled=false;}};}
  dialog.showModal();
}
function bindComments(chapter,generation) {
  const panel=$('.comments-panel'),content=$('#comments-content'),commentUserId=user.id;
  const key=`novel-branches:draft:${commentUserId}:comment:${chapter.id}`;
  let initialized=false,nextBefore=null;
  panel.ontoggle=async()=>{
    if(!panel.open||initialized)return;initialized=true;
    let draft='';try{draft=localStorage.getItem(key)||'';}catch{}
    content.innerHTML=`<form id="comment-form"><label for="comment-body">この話へのコメント</label><textarea id="comment-body" class="short" maxlength="2000" required>${esc(draft)}</textarea><div class="form-actions"><span class="hint" id="comment-draft-status">下書きはこのブラウザに保存</span><button type="submit" class="secondary small">投稿</button></div><p class="error" role="alert"></p></form><div id="comment-list"></div><button class="quiet small" id="more-comments" hidden>以前のコメント</button><p id="comments-error" class="error" role="alert"></p><button class="quiet small" id="retry-comments" hidden>読み直す</button>`;
    const form=$('#comment-form'),field=$('#comment-body'),list=$('#comment-list'),more=$('#more-comments'),error=$('#comments-error'),retry=$('#retry-comments');
    const current=()=>generation===viewGeneration&&content.isConnected;
    const save=()=>{try{localStorage.setItem(key,field.value);}catch{$('#comment-draft-status').textContent='下書きを保存できません。入力を控えてください。';}};
    field.oninput=save;
    const load=async(reset=false)=>{
      more.disabled=true;retry.hidden=true;error.textContent='';
      try{
        const result=await api(`/chapters/${chapter.id}/comments?before=${reset?0:nextBefore||0}`);
        if(!current())return;if(reset)list.replaceChildren();
        for(const c of result.comments){
          const row=document.createElement('div');row.className='comment';row.dataset.comment=String(c.id);
          row.innerHTML=`<div class="meta">${esc(c.author)} · ${updatedTime(c)}${c.author_id===commentUserId?'<button class="quiet small delete-comment">削除</button>':''}</div><p class="comment-body">${esc(c.body)}</p>`;
          const remove=row.querySelector('button');if(remove)remove.onclick=async()=>{if(!confirm('このコメントを削除しますか？'))return;remove.disabled=true;try{await api('/comments/'+c.id,'DELETE',{},commentUserId);if(!current())return;row.remove();chapter.comment_count--;$('#comment-count').textContent=chapter.comment_count;}catch(e){error.textContent=e.message;}finally{remove.disabled=false;}};
          list.append(row);
        }
        nextBefore=result.nextBefore;more.hidden=!nextBefore;
        if(!list.children.length)list.innerHTML='<p class="hint">まだコメントはありません。</p>';
      }catch(e){if(current()){error.textContent=e.message;retry.hidden=false;retry.onclick=()=>load(reset);}}finally{more.disabled=false;}
    };
    more.onclick=()=>load();
    form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;save();form.querySelector('.error').textContent='';try{await api('/chapters/'+chapter.id+'/comments','POST',{body:field.value},commentUserId);try{localStorage.removeItem(key);}catch{}if(!current())return;field.value='';chapter.comment_count++;$('#comment-count').textContent=chapter.comment_count;await load(true);}catch(err){form.querySelector('.error').textContent=err.message;if(!user&&auth.mode==='oidc'){const link=document.createElement('a');link.href=basePath+'/auth/login';link.textContent='再ログイン';form.querySelector('.error').append(document.createElement('br'),link);}}finally{button.disabled=false;}};
    await load(true);
  };
}
function editor(mode,context={},readingBranch=0) {
  closeReaderSettings(false);
  if(dialog.open)dialog.close();
  const editingUserId=user.id,draftKey=`novel-branches:draft:${editingUserId}:${mode}:${context.id||0}`;
  let draft={};try{draft=JSON.parse(localStorage.getItem(draftKey)||'{}');}catch{}
  const field=(name,label,max,value='',textarea=false)=>`<label for="edit-${name}">${label}</label>${textarea?`<textarea class="${name==='summary'?'short':''}" id="edit-${name}" name="${name}" maxlength="${max}" ${name==='summary'?'':'required'}>${esc(draft[name]??value)}</textarea>`:`<input id="edit-${name}" name="${name}" maxlength="${max}" value="${esc(draft[name]??value)}" required>`}`;
  const heading={new:'新しい作品を書く',fork:'この話の続きから分岐を書く',alternate:'この話の別案を書く',append:'続話を追加する',edit:'この話を編集する'}[mode];
  dialog.innerHTML=`<div class="dialog-head"><h2>${heading}</h2><button class="quiet icon-button" id="close-editor" title="閉じる" aria-label="閉じる">✕</button></div><p class="hint">${mode==='edit'?'制作者と話のつながりは変更されません。共通の話を参照する経路にも編集が反映されます。':mode==='alternate'?'直前までの話を共通にして、同じ話数の別案を投稿します。':mode==='fork'?'この話までを共通にして、次の話を別の経路として投稿します。':mode==='append'?'選んだ経路の最新話に続話を追加します。':'作品と最初の一話を投稿します。'}</p><form id="edit-form">${mode==='new'?field('title','作品名',120)+field('summary','あらすじ（任意）',2000,'',true):''}${field(mode==='new'?'chapterTitle':'title','話のタイトル',120,mode==='edit'?context.title:'')}${field('body','本文',100000,mode==='edit'?context.body:'',true)}${mode==='edit'?`<input type="hidden" name="expectedRevision" value="${esc(draft.expectedRevision??context.revision)}">`:mode==='append'?`<input type="hidden" name="expectedHeadId" value="${esc(draft.expectedHeadId??context.head_id)}">`:''}<div class="form-actions"><span class="hint" id="draft-status">下書きはこのブラウザに自動保存</span><button type="submit">${mode==='edit'?'編集を保存する':'この話を投稿する'}</button></div>${['edit','append'].includes(mode)?'<button type="button" class="secondary small" id="reload-edit">下書きを破棄して最新の内容を読み直す</button>':''}<p class="error" role="alert"></p></form>`;
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
  if(route.startsWith('chapter/'))applyReaderSettings();else clearReaderSettings();
  try{if(route.startsWith('info/'))await storyInfo(Number(route.split('/')[1]),generation,params);else if(route.startsWith('story/'))await storyView(Number(route.split('/')[1]),generation,params);else if(route.startsWith('chapter/'))await chapterView(Number(route.split('/')[1]),generation,params);else await library(params,generation);}catch(e){if(generation===viewGeneration){if(!user)login();else app.innerHTML=`<div class="empty"><h3>読み込めませんでした</h3><p>${esc(e.message)}</p><a class="button secondary" href="#">一覧へ戻る</a></div>`;}}window.scrollTo(0,0);
}
window.addEventListener('hashchange',render);
try{const me=await api('/me');user=me.user;auth=me.auth||auth;nav();await render();}catch(e){app.innerHTML=`<p role="alert">${esc(e.message)} 再読み込みしてください。</p>`;}
