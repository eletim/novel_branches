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
      PRAGMA user_version=1;`);
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
    const token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token), user.id, Date.now()+7*86400000);
    return { token, user: this.user(user.id) };
  }
  session(token) {
    if (!token) return null;
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires>?').get(tokenHash(token), Date.now());
    return row ? this.user(row.user_id) : null;
  }
  logout(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token)); }
  listStories({ query = '', sort = 'new', limit = 50, offset = 0 } = {}) {
    query = text(query || ' ', '検索', 200, 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new AppError('ページ指定が不正です。');
    return this.db.prepare(`SELECT s.*,u.display_name author,
      (SELECT COUNT(*) FROM branches b WHERE b.story_id=s.id) branch_count,
      (SELECT COUNT(*) FROM chapters c JOIN branches b ON c.branch_id=b.id WHERE b.story_id=s.id) chapter_count,
      (SELECT COUNT(*) FROM likes l JOIN chapters c ON l.chapter_id=c.id JOIN branches b ON c.branch_id=b.id WHERE b.story_id=s.id) likes
      FROM stories s JOIN users u ON u.id=s.author_id WHERE instr(s.title,?)>0 OR instr(s.summary,?)>0
      ORDER BY ${sort === 'popular' ? 'likes DESC,' : ''} s.id DESC LIMIT ? OFFSET ?`).all(query, query, limit, offset);
  }
  story(id) {
    const s = this.db.prepare('SELECT s.*,u.display_name author FROM stories s JOIN users u ON u.id=s.author_id WHERE s.id=?').get(id);
    if (!s) throw new AppError('作品が見つかりません。',404);
    s.branches = this.db.prepare(`SELECT b.*,u.display_name author,(SELECT COUNT(*) FROM likes l JOIN chapters c ON l.chapter_id=c.id WHERE c.branch_id=b.id) likes FROM branches b JOIN users u ON u.id=b.author_id WHERE b.story_id=? ORDER BY b.id`).all(id);
    s.chapters = this.db.prepare(`SELECT c.id,c.branch_id,c.parent_id,c.title,c.created_at,u.display_name author,(SELECT COUNT(*) FROM likes l WHERE l.chapter_id=c.id) likes FROM chapters c JOIN branches b ON b.id=c.branch_id JOIN users u ON u.id=b.author_id WHERE b.story_id=? ORDER BY c.id`).all(id);
    return s;
  }
  chapter(id, viewer = 0) {
    const c = this.db.prepare(`SELECT c.*,b.story_id,b.title branch_title,b.author_id,u.display_name author,(SELECT COUNT(*) FROM likes WHERE chapter_id=c.id) likes,EXISTS(SELECT 1 FROM likes WHERE chapter_id=c.id AND user_id=?) liked FROM chapters c JOIN branches b ON b.id=c.branch_id JOIN users u ON u.id=b.author_id WHERE c.id=?`).get(viewer, id);
    if (!c) throw new AppError('話が見つかりません。',404);
    c.children = this.db.prepare('SELECT c.id,c.title,c.branch_id,b.title branch_title,u.display_name author FROM chapters c JOIN branches b ON b.id=c.branch_id JOIN users u ON u.id=b.author_id WHERE c.parent_id=? ORDER BY c.id').all(id);
    return c;
  }
  path(branchId) {
    const branch = this.db.prepare('SELECT * FROM branches WHERE id=?').get(branchId);
    if (!branch) throw new AppError('分岐が見つかりません。',404);
    return this.db.prepare(`WITH RECURSIVE path(id,parent_id,title,branch_id,depth) AS (
      SELECT id,parent_id,title,branch_id,0 FROM chapters WHERE id=?
      UNION ALL SELECT c.id,c.parent_id,c.title,c.branch_id,p.depth+1 FROM chapters c JOIN path p ON c.id=p.parent_id
      ) SELECT id,parent_id,title,branch_id FROM path ORDER BY depth DESC`).all(branch.head_id);
  }
  createStory(userId, input) {
    const title = text(input.title, '作品名', 120), summary = text(input.summary || '', 'あらすじ', 2000, 0);
    const chapterTitle = text(input.chapterTitle, '話のタイトル', 120), body = text(input.body, '本文', 100000);
    return this.transaction(() => {
      const s = this.db.prepare('INSERT INTO stories(title,summary,author_id) VALUES(?,?,?)').run(title,summary,userId);
      const storyId = Number(s.lastInsertRowid);
      const b = this.db.prepare('INSERT INTO branches(story_id,title,author_id) VALUES(?,?,?)').run(storyId, '本編',userId);
      const branchId = Number(b.lastInsertRowid);
      const chapterId = this.insertChapter(branchId,null,chapterTitle,body);
      return { storyId,branchId,chapterId };
    });
  }
  insertChapter(branchId, parent, title, body) {
    const id = Number(this.db.prepare('INSERT INTO chapters(branch_id,parent_id,title,body) VALUES(?,?,?,?)').run(branchId,parent,title,body).lastInsertRowid);
    this.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(id, branchId);
    return id;
  }
  append(userId, branchId, input) {
    const title = text(input.title, '話のタイトル', 120), body = text(input.body, '本文',100000);
    return this.transaction(() => {
      const branch = this.db.prepare('SELECT * FROM branches WHERE id=?').get(branchId);
      if (!branch) throw new AppError('分岐が見つかりません。',404);
      if (branch.author_id !== userId) throw new AppError('この続きは作者が投稿できます。別の展開は分岐から投稿してください。',403);
      if (input.expectedHeadId !== branch.head_id) throw new AppError('別の話が追加されています。再読み込みして確認してください。',409);
      return { storyId: branch.story_id, branchId, chapterId: this.insertChapter(branchId,branch.head_id,title,body) };
    });
  }
  fork(userId, chapterId, input) {
    const branchTitle = text(input.branchTitle, '分岐名',120), title = text(input.title,'話のタイトル',120), body = text(input.body,'本文',100000);
    return this.transaction(() => {
      const source = this.chapter(chapterId);
      const branchId = Number(this.db.prepare('INSERT INTO branches(story_id,title,author_id,fork_chapter_id) VALUES(?,?,?,?)').run(source.story_id,branchTitle,userId,chapterId).lastInsertRowid);
      return { storyId: source.story_id, branchId, chapterId: this.insertChapter(branchId,chapterId,title,body) };
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
