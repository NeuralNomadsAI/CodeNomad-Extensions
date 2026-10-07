// Run: node scripts/test-mcp-assets.mjs <CodeNomad checkout with installed dev dependencies>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const checkout=path.resolve(process.argv[2]), require=createRequire(path.join(checkout,'package.json'));
const {chromium}=require('playwright'), {tsImport}=require('tsx/esm/api');
const {panelExtensionDocument}=await tsImport(pathToFileURL(path.join(checkout,'packages/ui/src/components/panel-extensions/frame-document.ts')).href,import.meta.url);
const html=await readFile(new URL('../extensions/mcp-assets/panel.html',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.CODENOMAD_BROWSER_PATH||undefined});
const seed=await browser.newPage();
const png=await seed.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;canvas.getContext('2d').fillRect(0,0,64,48);return canvas.toDataURL('image/png');});
await seed.close();
const server=createServer((_request,response)=>{
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end(`<iframe title="MCP Assets" sandbox="allow-scripts" style="width:100%;height:calc(100vh - 16px);border:0" srcdoc="${panelExtensionDocument(html,'test',2).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')}" onload="init(this)"></iframe><script>
    let channel, context={apiVersion:2,sessionId:'s',locale:'fr-FR',appearance:'dark',colors:{background:'#343a43',surface:'#252a31'}};
    window.update=(value)=>{context={...context,...value};channel.postMessage({type:'context',context});};
    window.changed=()=>channel.postMessage({type:'assets:changed'});
    window.reads=[];
    window.listCount=0;window.listReplies=[];
    window.releaseLists=()=>{window.holdLists=false;for(const reply of window.listReplies)reply();window.listReplies=[];};
    function init(frame){const connection=new MessageChannel();channel=connection.port1;channel.onmessage=async e=>{
      if(e.data.type==='ready'){channel.postMessage({type:'context',context});return;}
      const {id,method,input}=e.data;if(e.data.type!=='assets:request')return;
      let result;
      if(method==='list'){result={entries:context.sessionId==='empty'?[]:[
        {target:{messageID:'image',part:0,index:0,digest:'a'.repeat(64)},name:'Landscape',mime:'image/png',tool:'mcp.paint',available:true},
        {target:{messageID:'text',part:0,index:0,digest:'b'.repeat(64)},name:'Notes.txt',mime:'text/plain',tool:'mcp.notes',available:true},
        {target:{messageID:'remote',part:0,index:0,digest:'c'.repeat(64)},name:'Remote file',mime:'application/pdf',tool:'mcp.file',available:false}],cursor:null};}
      else {window.reads.push(input);result=input.target.messageID==='text'?{mime:'text/plain',uri:'data:text/plain;base64,SGVsbG8='}:{mime:'image/png',uri:window.corruptImages?'data:image/png;base64,bm90IGFuIGltYWdl':${JSON.stringify(png)}};}
      const reply=()=>channel.postMessage({type:'assets:result',id,result});
      if(method==='list'){window.listCount++;if(window.holdLists){window.listReplies.push(reply);return;}}
      reply();
    };frame.contentWindow.postMessage({type:'codenomad:init'},'*',[connection.port2]);}
  </script>`);
});
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const view=await browser.newPage({viewport:{width:390,height:600}});await view.goto(`http://127.0.0.1:${server.address().port}`);
  const frame=view.frameLocator('iframe');await frame.locator('.asset').nth(2).waitFor();
  assert.equal(await frame.locator('.asset').count(),3);
  for (const selector of ['html','body']) assert.equal(await frame.locator(selector).evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(52, 58, 67)');
  await view.evaluate(()=>window.update({colors:{background:'#e1e5eb',surface:'#ffffff'}}));
  await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await frame.locator('body').evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(225, 229, 235)');
  await frame.locator('.asset').first().click();await frame.locator('dialog[open] img').waitFor();
  await frame.locator('dialog[open] img').evaluate(image=>image.decode());
  await frame.getByRole('button',{name:'Fermer'}).click();
  await frame.getByRole('button',{name:'Notes.txt'}).click();assert.equal(await frame.locator('pre').innerText(),'Hello');
  await view.keyboard.press('Escape');assert.equal(await frame.locator('dialog[open]').count(),0);
  await frame.getByRole('button',{name:'Remote file'}).click();await frame.getByText('Aperçu indisponible pour cette pièce jointe.').waitFor();
  await frame.getByRole('button',{name:'Fermer'}).click();
  assert(await view.evaluate(()=>window.reads.some(value=>value.thumbnail===true)));
  const before=await view.evaluate(()=>window.listCount);
  await view.evaluate(()=>{window.holdLists=true;window.changed();});
  await view.waitForFunction(()=>window.listReplies.length===1);
  await view.evaluate(()=>{for(let n=0;n<5;n++)window.changed();});
  await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await view.evaluate(()=>window.listReplies.length),1,'Invalidations do not overlap metadata requests');
  await view.evaluate(()=>window.releaseLists());
  await view.waitForFunction(count=>window.listCount===count+2,before);
  await frame.locator('.asset').nth(2).waitFor();
  assert.equal(await frame.locator('#status').innerText(),'');
  await frame.locator('.preview img').first().evaluate(image=>image.decode());
  await frame.locator('body').evaluate(()=>{
    window.created=0;window.revoked=0;
    const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
    URL.createObjectURL=(...args)=>{window.created++;return create(...args);};
    URL.revokeObjectURL=(...args)=>{window.revoked++;return revoke(...args);};
  });
  await view.evaluate(()=>{window.corruptImages=true;});
  for(let n=0;n<3;n++){
    await frame.locator('.asset').first().click();
    await frame.locator('dialog[open]').getByText('Aperçu indisponible pour cette pièce jointe.').waitFor();
    await frame.getByRole('button',{name:'Fermer'}).click();
  }
  assert.deepEqual(await frame.locator('body').evaluate(()=>[window.created,window.revoked]),[3,3],'Failed lightboxes release their bytes immediately');
  await view.evaluate(()=>{window.corruptImages=false;});
  await view.evaluate(()=>window.update({sessionId:'empty'}));await frame.getByText('Aucun asset sur cette page.').waitFor();assert.equal(await frame.locator('.asset').count(),0);
  await view.evaluate(()=>window.update({sessionId:'s',locale:'he-IL'}));await frame.locator('.asset').nth(2).waitFor();
  assert.equal(await frame.locator('html').getAttribute('dir'),'rtl');
  assert.equal(await frame.locator('body').evaluate(element=>element.scrollWidth<=element.clientWidth),true);
  if(process.env.CODENOMAD_PANEL_CAPTURE_DIR){await mkdir(process.env.CODENOMAD_PANEL_CAPTURE_DIR,{recursive:true});await view.screenshot({path:path.join(process.env.CODENOMAD_PANEL_CAPTURE_DIR,'mcp-assets-rtl.png')});}
  console.log('PASS: gallery palette, grid, thumbnails, image/text lightbox, invalidation coalescing, failed-image cleanup, unavailable files, Escape, session clearing and RTL');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
