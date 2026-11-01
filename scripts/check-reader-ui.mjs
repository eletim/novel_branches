import assert from 'node:assert/strict';
function contrast(a,b){const lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
export async function checkEditIcons(p){
 assert.equal(await p.getByRole('button',{name:'Editor',exact:true}).count(),0);
 for(const button of await p.locator('.edit-entry').all()){assert.equal((await button.innerText()).trim(),'');assert.ok(await button.getAttribute('aria-label'));assert.ok(await button.getAttribute('title'));const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44);}
}
export async function checkReaderUI(p,{other,origin,first,selected,body,out}){
 const writes=[];const record=req=>{if(!['GET','HEAD'].includes(req.method()))writes.push(req.method());};p.on('request',record);
 const route=origin+'/#chapter/'+first+'?'+selected;
 const open=async()=>{await p.locator('#open-reader-settings').click();await p.locator('#reader-settings').waitFor({state:'visible'});};
 for(const [width,height,label]of [[1280,900,'desktop'],[375,812,'mobile']]){
  await p.setViewportSize({width,height});await p.goto(route);await p.locator('.reader-body').waitFor();await checkEditIcons(p);
  const box=await p.locator('.reader-body').boundingBox();assert.ok(width>1000?box.width>=1000:box.width>=width-26,'actual text width increased');assert.ok(width>1000?box.x<(width-730)/2+65:box.x<=13);assert.equal(await p.locator('.reader-body').textContent(),body.trim());
  await p.screenshot({path:out+'/reader-wide-'+label+'.png',fullPage:true});
  await p.locator('#open-reader-settings').focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#open-reader-settings').getAttribute('aria-expanded'),'true');assert.equal(await p.evaluate(()=>document.activeElement.id),'reader-font');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.id),'reader-theme');
  for(const font of ['mincho','gothic']){await p.locator('#reader-font').selectOption(font);if(font==='mincho')assert.ok(await p.evaluate(async()=>{const loaded=await document.fonts.load('18px "Novel Reader Mincho"','あ');return loaded.length>0&&loaded.every(f=>f.status==='loaded');}));const family=await p.locator('.reader-body').evaluate(el=>getComputedStyle(el).fontFamily);assert.match(family,font==='mincho'?/Mincho|Serif|serif/:/Meiryo|メイリオ|sans-serif/);}
  for(const size of [16,18,20,24,28]){await p.locator('#reader-size').selectOption(String(size));assert.equal(await p.locator('.reader-body').evaluate(el=>getComputedStyle(el).fontSize),size+'px');}
  for(const theme of ['paper','white','dark']){
   await p.locator('#reader-theme').selectOption(theme);assert.equal(await p.locator('body').getAttribute('data-reader-theme'),theme);
   const colors=await p.evaluate(()=>{const style=selector=>getComputedStyle(document.querySelector(selector));return {bg:style('body').backgroundColor,text:style('.reader-body').color,link:style('.next-chapter').color,meta:style('.chapter-creator').color,controlBg:style('#reader-theme').backgroundColor,controlText:style('#reader-theme').color,icon:style('#open-editor').color};});
   for(const key of ['text','link','meta','icon'])assert.ok(contrast(colors[key],colors.bg)>=4.5,theme+' readable '+key);assert.ok(contrast(colors.controlText,colors.controlBg)>=4.5,theme+' readable controls');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await p.locator('#reader-font').selectOption('mincho');await p.locator('#reader-size').selectOption('24');await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:out+'/reader-settings-'+label+'.png',fullPage:false});
  await p.keyboard.press('Escape');assert.equal(await p.locator('#reader-settings').isVisible(),false);assert.equal(await p.evaluate(()=>document.activeElement.id),'open-reader-settings');await open();await p.locator('#open-reader-settings').click();assert.equal(await p.locator('#reader-settings').isVisible(),false);await open();await p.locator('#close-reader-settings').click();assert.equal(await p.evaluate(()=>document.activeElement.id),'open-reader-settings');
  await p.locator('.next-chapter').click();await p.locator('.reader-heading h1').filter({hasText:'分岐第二話'}).waitFor();assert.ok(new URL(p.url()).hash.endsWith('?'+selected));assert.equal(await p.locator('body').getAttribute('data-reader-theme'),'dark');assert.equal(await p.locator('.reader-body').evaluate(el=>getComputedStyle(el).fontSize),'24px');await p.reload();await p.locator('.reader-body').waitFor();assert.equal(await p.locator('body').getAttribute('data-reader-font'),'mincho');assert.equal(await p.locator('.reader-body').evaluate(el=>getComputedStyle(el).fontSize),'24px');
  await p.locator('.to-toc').first().click();await p.locator('.toc-list').waitFor();assert.equal(await p.locator('body').getAttribute('data-reader-theme'),null);await checkEditIcons(p);
  await p.goto(route);await p.locator('.reader-body').waitFor();assert.equal(await p.locator('body').getAttribute('data-reader-theme'),'dark');await p.locator('#open-editor').focus();await p.keyboard.press('Enter');await p.locator('#editor').waitFor({state:'visible'});await p.keyboard.press('Escape');await p.locator('#editor').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>document.activeElement.id),'open-editor');
  await open();await p.locator('#reset-reader-settings').click();assert.equal(await p.locator('body').getAttribute('data-reader-theme'),'paper');assert.equal(await p.locator('body').getAttribute('data-reader-font'),'gothic');assert.equal(await p.locator('.reader-body').evaluate(el=>getComputedStyle(el).fontSize),'18px');await p.locator('#close-reader-settings').click();await p.reload();await p.locator('.reader-body').waitFor();assert.equal(await p.locator('body').getAttribute('data-reader-theme'),'paper');
 }
 await other.goto(route);await other.locator('.reader-body').waitFor();assert.equal(await other.locator('body').getAttribute('data-reader-theme'),'paper');assert.equal(await other.locator('.reader-body').evaluate(el=>getComputedStyle(el).fontSize),'18px');await p.setViewportSize({width:1280,height:900});
 p.off('request',record);assert.deepEqual(writes,[]);
 console.log('PASS reader UI: actual 1056px desktop/351px mobile text, long Japanese/newlines, fonts/5 sizes/3 contrast-tested palettes, preview/reset/persistence, keyboard and 44px icon entries');
}
