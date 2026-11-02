import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('参加者作成CLIは0600へ保存して秘密を出力せず、既存ユーザーと既存ファイルを上書きしない',()=>{
 const root=mkdtempSync(join(tmpdir(),'participant-cli-'));
 try{for(const dir of ['scripts','deploy','bin','private'])mkdirSync(join(root,dir),{mode:0o700});copyFileSync('scripts/public-create-participant.py',join(root,'scripts/create.py'));writeFileSync(join(root,'deploy/.env'),'KC_ADMIN_PASSWORD=dummy-only\n');
 writeFileSync(join(root,'bin/docker'),`#!/usr/bin/python3\nimport json,sys,os\nc=json.load(sys.stdin)\nexisting=os.environ.get('MOCK_EXISTING')=='1'\nprint(json.dumps({'exists':bool(existing or c.get('create')), 'created':bool(c.get('create') and not existing), 'username':'yui','enabled':True,'roles':['novel-member'],'requiredActions':['UPDATE_PASSWORD']}))\n`,{mode:0o700});
 const file=join(root,'private/yui.password'),run=existing=>spawnSync('python3',[join(root,'scripts/create.py'),'--username','yui','--display-name','yui','--initial-password-file',file],{encoding:'utf8',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,MOCK_EXISTING:existing?'1':'0'}});
 const created=run(false);assert.equal(created.status,0);const password=readFileSync(file,'utf8');assert.ok(password.trim().length>=40);assert.equal(statSync(file).mode&0o777,0o600);assert.ok(!created.stdout.includes(password.trim()));assert.ok(!created.stderr.includes(password.trim()));
 const existing=run(true);assert.equal(existing.status,0);assert.match(existing.stdout,/Existing account preserved/);assert.equal(readFileSync(file,'utf8'),password);
 const refused=run(false);assert.equal(refused.status,1);assert.equal(readFileSync(file,'utf8'),password);assert.ok(!refused.stdout.includes(password.trim()));
 }finally{rmSync(root,{recursive:true,force:true});}
});
