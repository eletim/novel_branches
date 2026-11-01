// Separate actual installed Meiryo rendering from a genuine no-Meiryo fallback.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync,readFileSync,symlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {Store} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
const publicMode=process.argv.includes('--public');let store,server,origin,first,password;
if(publicMode){process.loadEnvFile('deploy/.test/public.env');origin=process.env.APP_ORIGIN+process.env.APP_BASE_PATH;assert.equal(origin,'https://eletim.jp/novel');first=JSON.parse(readFileSync('deploy/.test/evidence/episodes-public/episodes.json')).first;}
else{store=new Store(':memory:');password=randomBytes(32).toString('hex');const user=store.addUser('font-member','Font tester',password);first=store.createStory(user.id,{title:'Font check',chapterTitle:'描画確認',body:'日本語の本文を実際のメイリオとゴシック体で描画します。朝の図書室と静かな森。'}).chapterId;server=createApp({store,auth:{mode:'local'},basePath:'/novel',secureCookies:false});server.listen(0,'127.0.0.1');await once(server,'listening');origin=`http://127.0.0.1:${server.address().port}/novel`;}
const folder=resolve('deploy/.test/font-rendering');mkdirSync(folder,{recursive:true,mode:0o700});
const modes=[{name:'fallback',env:{...process.env}}];delete modes[0].env.FONTCONFIG_FILE;delete modes[0].env.FONTCONFIG_PATH;
if(existsSync('/mnt/c/Windows/Fonts/meiryo.ttc')){
 const links=folder+'/host-installed',cache=folder+'/cache';mkdirSync(links,{recursive:true,mode:0o700});mkdirSync(cache,{recursive:true,mode:0o700});
 // A private, test-process-only fontconfig points to fonts already installed on Windows.
 // Do not copy, bundle, redistribute or serve Microsoft's font files.
 for(const name of ['meiryo.ttc','meiryob.ttc'])if(existsSync('/mnt/c/Windows/Fonts/'+name)&&!existsSync(links+'/'+name))symlinkSync('/mnt/c/Windows/Fonts/'+name,links+'/'+name);
 const config=folder+'/with-host-meiryo.conf';writeFileSync(config,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><include>/etc/fonts/fonts.conf</include><dir>${links}</dir><cachedir>${cache}</cachedir></fontconfig>`,{mode:0o600});
 modes.push({name:'installed',env:{...process.env,FONTCONFIG_FILE:config}});
}
const results=[];
try{for(const mode of modes){const browser=await chromium.launch({env:mode.env});try{const p=await browser.newPage();await p.goto(origin+'/');if(publicMode){await p.locator('.login a').click();await p.locator('#username').fill(process.env.TEST_USER_PREFIX+'member');await p.locator('#password').fill(process.env.TEST_MEMBER_PASSWORD);await p.locator('#kc-login').click();}else{await p.locator('#username').fill('font-member');await p.locator('#password').fill(password);await p.locator('#login button').click();}await p.locator('#write').waitFor();await p.goto(origin+'/#chapter/'+first);await p.locator('.reader-body').waitFor();await p.locator('#open-reader-settings').click();await p.locator('#reader-font [data-value=meiryo]').click();await p.evaluate(()=>document.fonts.ready);
 const cdp=await p.context().newCDPSession(p);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.reader-body'});const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});const used=fonts.filter(f=>f.glyphCount>0),actual=used.some(f=>/meiryo|メイリオ/i.test(f.familyName+' '+f.postScriptName));assert.ok(used.length);assert.equal(actual,mode.name==='installed');if(actual)assert.ok(used.some(f=>/meiryo/i.test(f.familyName)&&!f.isCustomFont));results.push({mode:mode.name,actualMeiryo:actual,fonts:used.map(({familyName,postScriptName,isCustomFont,glyphCount})=>({familyName,postScriptName,isCustomFont,glyphCount}))});console.log('PASS '+mode.name+' font rendering: '+used.map(f=>f.familyName+' (glyphs '+f.glyphCount+')').join(', '));
 }finally{await browser.close();}}
 writeFileSync(folder+'/'+(publicMode?'public':'local')+'.json',JSON.stringify(results,null,2),{mode:0o600});if(modes.length===1)console.log('SKIP actual installed Meiryo: host font unavailable; fallback verified separately');
}catch{console.error('Font rendering verification failed; authentication details suppressed');process.exitCode=1;}finally{if(server){await new Promise(r=>server.close(r));store.close();}}
