import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function text(value, label, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new AppError(`${label}は${min}〜${max}文字で入力してください。`);
  return value.trim();
}
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export function passwordHash(password) {
  text(password, 'パスワード', 256, 10);
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function passwordMatches(password, hash) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, digest] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
}

export class Store {
  constructor(path = process.env.DB_PATH || './data/novels.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stories(id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL, author_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE IF NOT EXISTS branches(id INTEGER PRIMARY KEY, story_id INTEGER NOT NULL REFERENCES stories(id), title TEXT NOT NULL, author_id INTEGER NOT NULL REFERENCES users(id), fork_chapter_id INTEGER REFERENCES chapters(id), head_id INTEGER REFERENCES chapters(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE IF NOT EXISTS chapters(id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL REFERENCES branches(id), parent_id INTEGER REFERENCES chapters(id), title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE IF NOT EXISTS likes(user_id INTEGER NOT NULL REFERENCES users(id), chapter_id INTEGER NOT NULL REFERENCES chapters(id), PRIMARY KEY(user_id,chapter_id));
      CREATE INDEX IF NOT EXISTS branches_story ON branches(story_id);
      CREATE INDEX IF NOT EXISTS chapters_parent ON chapters(parent_id);
      CREATE INDEX IF NOT EXISTS likes_chapter ON likes(chapter_id);
      CREATE TABLE IF NOT EXISTS oidc_identities(issuer TEXT NOT NULL,subject TEXT NOT NULL,user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),PRIMARY KEY(issuer,subject));
      CREATE TABLE IF NOT EXISTS oidc_logins(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
      `);
    // Additive migration preserves existing users, stories, sessions and ownership.
    const columns = new Set(this.db.prepare('PRAGMA table_info(sessions)').all().map(c=>c.name));
    for (const [name, type] of Object.entries({auth_type:"TEXT NOT NULL DEFAULT 'local'",issuer:'TEXT',subject:'TEXT',sid:'TEXT',id_token:'TEXT'})) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS oidc_sessions ON sessions(issuer,sid,subject)');
    this.transaction(()=>{
      const episodeColumns=new Set(this.db.prepare('PRAGMA table_info(chapters)').all().map(c=>c.name));
      for(const [name,type] of Object.entries({author_id:'INTEGER REFERENCES users(id)',updated_at:'TEXT',revision:'INTEGER NOT NULL DEFAULT 1'})) {
        if(!episodeColumns.has(name))this.db.exec(`ALTER TABLE chapters ADD COLUMN ${name} ${type}`);
      }
      // Old versions restricted each branch to its author; preserve that attribution.
      this.db.exec(`UPDATE chapters SET author_id=(SELECT author_id FROM branches WHERE branches.id=chapters.branch_id) WHERE author_id IS NULL;
        UPDATE chapters SET updated_at=created_at WHERE updated_at IS NULL;
        `);
      const storyColumns=new Set(this.db.prepare('PRAGMA table_info(stories)').all().map(c=>c.name));
      if(!storyColumns.has('hidden_from_home'))this.db.exec('ALTER TABLE stories ADD COLUMN hidden_from_home INTEGER NOT NULL DEFAULT 0 CHECK(hidden_from_home IN (0,1))');
      if(!storyColumns.has('main_branch_id'))this.db.exec('ALTER TABLE stories ADD COLUMN main_branch_id INTEGER REFERENCES branches(id)');
      this.db.exec(`UPDATE stories SET main_branch_id=COALESCE((SELECT id FROM branches WHERE story_id=stories.id AND title='本編' ORDER BY id LIMIT 1),(SELECT id FROM branches WHERE story_id=stories.id ORDER BY id LIMIT 1)) WHERE main_branch_id IS NULL;
        `);
      if(!storyColumns.has('setting_notes'))this.db.exec("ALTER TABLE stories ADD COLUMN setting_notes TEXT NOT NULL DEFAULT ''");
      if(!storyColumns.has('revision'))this.db.exec('ALTER TABLE stories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
      if(!storyColumns.has('updated_at'))this.db.exec('ALTER TABLE stories ADD COLUMN updated_at TEXT');
      this.db.exec(`UPDATE stories SET updated_at=created_at WHERE updated_at IS NULL;
        PRAGMA user_version=5;`);
    });
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  addUser(username, displayName, password) {
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{2,40}$/.test(username)) throw new AppError('ユーザー名は英数字・_・-の2〜40文字です。');
    const hash = passwordHash(password);
    try {
      return this.db.prepare('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?) RETURNING id,username,display_name').get(username, text(displayName, '表示名', 60), hash);
    } catch (e) { if (e.code?.startsWith('ERR_SQLITE') && e.message.includes('UNIQUE')) throw new AppError('このユーザー名は使用済みです。',409); throw e; }
  }
  user(id) { return this.db.prepare('SELECT id,username,display_name FROM users WHERE id=?').get(id); }
  login(username, password) {
    const user = typeof username === 'string' ? this.db.prepare('SELECT * FROM users WHERE username=?').get(username) : null;
    const dummy = '0123456789abcdef0123456789abcdef:' + '0'.repeat(128);
    const valid = passwordMatches(password, user?.password_hash || dummy);
    if (!user || !valid) throw new AppError('ユーザー名またはパスワードが違います。',401);
    return this.createSession(user.id);
  }
  createSession(userId, { lifetimeMs = 7*86400000, authType = 'local', issuer = null, subject = null, sid = null, idToken = null } = {}) {
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO sessions(token_hash,user_id,expires,auth_type,issuer,subject,sid,id_token) VALUES(?,?,?,?,?,?,?,?)').run(tokenHash(token),userId,Date.now()+lifetimeMs,authType,issuer,subject,sid,idToken);
    return {token,user:this.user(userId)};
  }
  sessionDetails(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(tokenHash(token),Date.now());
  }
  session(token, authType = 'local') {
    const row = this.sessionDetails(token);
    return row && row.auth_type === authType ? this.user(row.user_id) : null;
  }
  oidcUser(issuer, subject, displayName) {
    if (typeof subject !== 'string' || !subject || subject.length > 512) throw new AppError('ユーザー識別子が不正です。',401);
    const name = text(String(displayName).slice(0,60),'表示名',60);
    return this.transaction(()=>{
      const identity = this.db.prepare('SELECT user_id FROM oidc_identities WHERE issuer=? AND subject=?').get(issuer,subject);
      if (identity) {
        this.db.prepare('UPDATE users SET display_name=? WHERE id=?').run(name,identity.user_id);
        return this.user(identity.user_id);
      }
      // Never merge users based on email or a mutable display name.
      const username = 'oidc_'+randomBytes(16).toString('hex');
      const user = this.addUser(username,name,randomBytes(32).toString('hex'));
      this.db.prepare('INSERT INTO oidc_identities VALUES(?,?,?)').run(issuer,subject,user.id);
      return user;
    });
  }
  saveOidcLogin({state,browser,nonce,verifier}) {
    this.db.prepare('DELETE FROM oidc_logins WHERE expires<?').run(Date.now());
    if (this.db.prepare('SELECT COUNT(*) n FROM oidc_logins').get().n >= 1000) throw new AppError('ログインが混み合っています。少し待って再試行してください。',429);
    this.db.prepare('INSERT INTO oidc_logins VALUES(?,?,?,?,?)').run(tokenHash(state),tokenHash(browser),nonce,verifier,Date.now()+600000);
  }
  consumeOidcLogin(state,browser) {
    if (typeof state !== 'string' || state.length > 256 || typeof browser !== 'string' || browser.length > 256) return null;
    return this.transaction(()=>{
      const login = this.db.prepare('SELECT nonce,verifier FROM oidc_logins WHERE state_hash=? AND browser_hash=? AND expires>?').get(tokenHash(state),tokenHash(browser),Date.now());
      if (login) this.db.prepare('DELETE FROM oidc_logins WHERE state_hash=?').run(tokenHash(state));
      return login;
    });
  }
  revokeOidcSessions(issuer,sid,subject) {
    if (sid) this.db.prepare('DELETE FROM sessions WHERE auth_type=? AND issuer=? AND sid=?').run('oidc',issuer,sid);
    else if (subject) this.db.prepare('DELETE FROM sessions WHERE auth_type=? AND issuer=? AND subject=?').run('oidc',issuer,subject);
  }
  logout(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token)); }
  listStories({ query = '', sort = 'new', limit = 50, offset = 0, includeHidden = true } = {}) {
    query = text(query || ' ', '検索', 200, 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new AppError('ページ指定が不正です。');
    return this.db.prepare(`SELECT s.id,s.title,s.summary,s.author_id,s.created_at,s.hidden_from_home,s.main_branch_id,s.revision,s.updated_at,u.display_name author,
      (SELECT COUNT(*) FROM branches b WHERE b.story_id=s.id) branch_count,
      (SELECT COUNT(*) FROM chapters c JOIN branches b ON c.branch_id=b.id WHERE b.story_id=s.id) chapter_count,
      (SELECT COUNT(*) FROM likes l JOIN chapters c ON l.chapter_id=c.id JOIN branches b ON c.branch_id=b.id WHERE b.story_id=s.id) likes
      FROM stories s JOIN users u ON u.id=s.author_id WHERE (? OR s.hidden_from_home=0) AND (instr(s.title,?)>0 OR instr(s.summary,?)>0)
      ORDER BY ${sort === 'popular' ? 'likes DESC,' : ''} s.id DESC LIMIT ? OFFSET ?`).all(includeHidden ? 1 : 0, query, query, limit, offset);
  }
  story(id) {
    const s = this.db.prepare('SELECT s.*,u.display_name author FROM stories s JOIN users u ON u.id=s.author_id WHERE s.id=?').get(id);
    if (!s) throw new AppError('作品が見つかりません。',404);
    s.branches = this.db.prepare(`SELECT b.*,u.display_name author,(SELECT COUNT(*) FROM likes l JOIN chapters c ON l.chapter_id=c.id WHERE c.branch_id=b.id) likes FROM branches b JOIN users u ON u.id=b.author_id WHERE b.story_id=? ORDER BY b.id`).all(id);
    s.chapters = this.db.prepare(`SELECT c.id,c.branch_id,c.parent_id,c.title,c.created_at,c.updated_at,c.revision,c.author_id,u.display_name author,(SELECT COUNT(*) FROM likes l WHERE l.chapter_id=c.id) likes FROM chapters c JOIN branches b ON b.id=c.branch_id JOIN users u ON u.id=c.author_id WHERE b.story_id=? ORDER BY c.id`).all(id);
    return s;
  }
  setStoryVisibility(userId,id,input) {return this.updateStory(userId,id,input);}
  updateStory(userId,id,input) {
    return this.transaction(()=>{
      const story=this.story(id);
      if(story.author_id!==userId)throw new AppError('作品情報を編集できるのは最初の制作者だけです。',403);
      const allowed=['title','summary','hiddenFromHome','settingNotes','expectedRevision'];
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||Object.keys(input).length<2)throw new AppError('作品情報の指定が不正です。');
      if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)throw new AppError('編集元の版を指定してください。');
      if(input.expectedRevision!==story.revision)throw new AppError('別の更新が保存されています。入力を控え、最新の作品情報を確認してください。',409);
      const title='title' in input?text(input.title,'作品名',120):story.title;
      const summary='summary' in input?text(input.summary,'あらすじ',2000,0):story.summary;
      if('hiddenFromHome' in input&&typeof input.hiddenFromHome!=='boolean')throw new AppError('表示設定を真偽値で指定してください。');
      if('settingNotes' in input&&(typeof input.settingNotes!=='string'||input.settingNotes.length>100000))throw new AppError('設定メモは100000文字以内で入力してください。');
      const notes='settingNotes' in input?input.settingNotes:story.setting_notes;
      const hidden='hiddenFromHome' in input?(input.hiddenFromHome?1:0):story.hidden_from_home;
      const updatedAt=new Date(Math.max(Date.now(),Date.parse(story.updated_at||story.created_at)+1)).toISOString();
      this.db.prepare('UPDATE stories SET title=?,summary=?,hidden_from_home=?,setting_notes=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(title,summary,hidden,notes,updatedAt,id,input.expectedRevision);
      return this.story(id);
    });
  }
  chapter(id, viewer = 0) {
    const c = this.db.prepare(`SELECT c.*,b.story_id,b.title branch_title,u.display_name author,(SELECT COUNT(*) FROM likes WHERE chapter_id=c.id) likes,EXISTS(SELECT 1 FROM likes WHERE chapter_id=c.id AND user_id=?) liked FROM chapters c JOIN branches b ON b.id=c.branch_id JOIN users u ON u.id=c.author_id WHERE c.id=?`).get(viewer, id);
    if (!c) throw new AppError('話が見つかりません。',404);
    c.children = this.db.prepare('SELECT c.id,c.title,c.branch_id,c.parent_id,c.author_id,c.updated_at,c.revision,b.title branch_title,u.display_name author FROM chapters c JOIN branches b ON b.id=c.branch_id JOIN users u ON u.id=c.author_id WHERE c.parent_id=? ORDER BY c.id').all(id);
    return c;
  }
  path(branchId) {
    const branch = this.db.prepare('SELECT * FROM branches WHERE id=?').get(branchId);
    if (!branch) throw new AppError('分岐が見つかりません。',404);
    return this.db.prepare(`WITH RECURSIVE path(id,parent_id,depth) AS (
      SELECT id,parent_id,0 FROM chapters WHERE id=?
      UNION ALL SELECT c.id,c.parent_id,p.depth+1 FROM chapters c JOIN path p ON c.id=p.parent_id
      ) SELECT c.id,c.parent_id,c.title,c.branch_id,c.author_id,c.created_at,c.updated_at,c.revision,u.display_name author
      FROM path p JOIN chapters c ON c.id=p.id JOIN users u ON u.id=c.author_id ORDER BY p.depth DESC`).all(branch.head_id);
  }

  createStory(userId, input) {
    const title = text(input.title, '作品名', 120), summary = text(input.summary || '', 'あらすじ', 2000, 0);
    const chapterTitle = text(input.chapterTitle, '話のタイトル', 120), body = text(input.body, '本文', 100000);
    return this.transaction(() => {
      const s = this.db.prepare('INSERT INTO stories(title,summary,author_id) VALUES(?,?,?)').run(title,summary,userId);
      const storyId = Number(s.lastInsertRowid);
      const b = this.db.prepare('INSERT INTO branches(story_id,title,author_id) VALUES(?,?,?)').run(storyId, '本編',userId);
      const branchId = Number(b.lastInsertRowid);
      this.db.prepare('UPDATE stories SET main_branch_id=?,updated_at=created_at WHERE id=?').run(branchId,storyId);
      const chapterId = this.insertChapter(branchId,null,chapterTitle,body,userId);
      return { storyId,branchId,chapterId };
    });
  }
  insertChapter(branchId, parent, title, body, userId) {
    const id = Number(this.db.prepare('INSERT INTO chapters(branch_id,parent_id,title,body,author_id,updated_at) VALUES(?,?,?,?,?,strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))').run(branchId,parent,title,body,userId).lastInsertRowid);
    this.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(id, branchId);
    return id;
  }
  append(userId, branchId, input) {
    const title = text(input.title, '話のタイトル', 120), body = text(input.body, '本文',100000);
    return this.transaction(() => {
      const branch = this.db.prepare('SELECT * FROM branches WHERE id=?').get(branchId);
      if (!branch) throw new AppError('分岐が見つかりません。',404);
      if (input.expectedHeadId !== branch.head_id) throw new AppError('別の話が追加されています。再読み込みして確認してください。',409);
      return { storyId: branch.story_id, branchId, chapterId: this.insertChapter(branchId,branch.head_id,title,body,userId) };
    });
  }
  fork(userId, chapterId, input) {
    const branchTitle = text(input.branchTitle || ('分岐：'+String(input.title||'')).slice(0,120), '分岐名',120), title = text(input.title,'話のタイトル',120), body = text(input.body,'本文',100000);
    return this.transaction(() => {
      const source = this.chapter(chapterId);
      const branchId = Number(this.db.prepare('INSERT INTO branches(story_id,title,author_id,fork_chapter_id) VALUES(?,?,?,?)').run(source.story_id,branchTitle,userId,chapterId).lastInsertRowid);
      return { storyId: source.story_id, branchId, chapterId: this.insertChapter(branchId,chapterId,title,body,userId) };
    });
  }
  alternate(userId, chapterId, input) {
    const title=text(input.title,'話のタイトル',120),body=text(input.body,'本文',100000);
    return this.transaction(()=>{
      const source=this.chapter(chapterId);
      const branchId=Number(this.db.prepare('INSERT INTO branches(story_id,title,author_id,fork_chapter_id) VALUES(?,?,?,?)').run(source.story_id,('別案：'+title).slice(0,120),userId,source.parent_id).lastInsertRowid);
      return {storyId:source.story_id,branchId,chapterId:this.insertChapter(branchId,source.parent_id,title,body,userId)};
    });
  }
  edit(userId, chapterId, input) {
    return this.transaction(()=>{
      const chapter=this.chapter(chapterId);
      if(chapter.author_id!==userId)throw new AppError('この話を編集できるのは制作者だけです。',403);
      if(Object.keys(input).some(k=>!['title','body','expectedRevision'].includes(k)))throw new AppError('タイトル・本文以外は変更できません。');
      if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)throw new AppError('編集元の版を指定してください。');
      if(input.expectedRevision!==chapter.revision)throw new AppError('別の編集が保存されています。本文を控え、最新の内容を確認してください。',409);
      const title=text(input.title,'話のタイトル',120),body=text(input.body,'本文',100000);
      const updatedAt=new Date(Math.max(Date.now(),Date.parse(chapter.updated_at)+1)).toISOString();
      this.db.prepare('UPDATE chapters SET title=?,body=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(title,body,updatedAt,chapterId,input.expectedRevision);
      return this.chapter(chapterId,userId);
    });
  }
  like(userId, chapterId, liked) {
    this.chapter(chapterId);
    if (typeof liked !== 'boolean') throw new AppError('likedは真偽値で指定してください。');
    if (liked) this.db.prepare('INSERT OR IGNORE INTO likes VALUES(?,?)').run(userId,chapterId);
    else this.db.prepare('DELETE FROM likes WHERE user_id=? AND chapter_id=?').run(userId,chapterId);
    return this.chapter(chapterId,userId);
  }
}
