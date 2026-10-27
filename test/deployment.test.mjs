import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, passwordHash } from '../src/store.mjs';

test('v0.1のDBを開くと、既存ユーザー・セッション・作品を保持して認証用テーブルを追加する',()=>{
  const dir=mkdtempSync(join(tmpdir(),'novel-migration-')),path=join(dir,'v1.db');
  const old=new DatabaseSync(path);
  old.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,password_hash TEXT NOT NULL);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);PRAGMA user_version=1;");
  old.prepare('INSERT INTO users VALUES(1,?,?,?)').run('alice','旧ユーザー',passwordHash('existing-password'));old.close();
  const store=new Store(path);
  try{
    assert.equal(store.user(1).display_name,'旧ユーザー');assert.equal(store.login('alice','existing-password').user.id,1);
    const root=store.createStory(1,{title:'移行後も書ける',chapterTitle:'一話',body:'本文'});assert.equal(store.story(root.storyId).author_id,1);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,2);
    const oidc=store.oidcUser('https://issuer.example','sub-1','Alice');assert.notEqual(oidc.id,1);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('配布するrealmは登録・パスワードgrant・ワイルドカードredirectを許可しない',()=>{
  const realm=JSON.parse(readFileSync('deploy/keycloak/novel-branches-realm.json','utf8'));
  assert.equal(realm.registrationAllowed,false);assert.equal(realm.bruteForceProtected,true);assert.equal(realm.users,undefined);
  for(const client of realm.clients){assert.equal(client.directAccessGrantsEnabled,false);assert.equal(client.implicitFlowEnabled,false);assert.equal(client.serviceAccountsEnabled,false);assert.ok(client.redirectUris.every(uri=>!uri.includes('*')));}
  const web=realm.clients.find(c=>c.clientId==='novel-web');assert.equal(web.publicClient,false);assert.equal(web.attributes['pkce.code.challenge.method'],'S256');assert.equal(web.attributes['backchannel.logout.session.required'],'true');
  const mcp=realm.clients.find(c=>c.clientId==='novel-mcp');assert.equal(mcp.standardFlowEnabled,false);assert.deepEqual(mcp.redirectUris,[]);
});
