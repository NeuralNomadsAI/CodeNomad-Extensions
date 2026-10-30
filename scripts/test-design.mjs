// Run: node scripts/test-design.mjs <CodeNomad checkout with installed dev dependencies>
// The real frame document, prefill composition and archive validation come from that
// checkout; the API 4 host side is a deterministic simulation of its channel.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout=path.resolve(process.argv[2]), require=createRequire(path.join(checkout,'package.json'));
const {chromium}=require('playwright'), {tsImport}=require('tsx/esm/api');
const load=file=>tsImport(pathToFileURL(path.join(checkout,file)).href,import.meta.url);
const {panelExtensionDocument}=await load('packages/ui/src/components/panel-extensions/frame-document.ts');
const {composePrefill,prefillMarkers}=await load('packages/ui/src/components/panel-extensions/composer-prefill.ts');
const {readPanelExtensionArchive}=await load('packages/server/src/panel-extensions/archive.ts');
const root=fileURLToPath(new URL('..',import.meta.url)), source=path.join(root,'extensions/design');
const html=await readFile(path.join(source,'panel.html'),'utf8'), manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));

// Package: the real host validator accepts the deterministic ZIP; notice and translations are complete.
const LOCALES=['en','fr','de','es','he','ja','ne','ru','tr','zh'];
const T=JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
assert.deepEqual(Object.keys(T).sort(),[...LOCALES].sort());
const marks=text=>[...String(text).matchAll(/\{\{?\w+\}\}?/g)].map(match=>match[0]).sort().join();
for (const locale of LOCALES) for (const group of [null,'R','D']) {
  const en=group?T.en[group]:T.en, other=group?T[locale][group]:T[locale];
  assert.deepEqual(Object.keys(other).sort(),Object.keys(en).sort(),`${locale} ${group??''} keys`);
  for (const [key,value] of Object.entries(en)) if (typeof value==='string') {
    assert(other[key].trim(),`${locale}.${key} is empty`); assert.equal(marks(other[key]),marks(value),`${locale}.${key} placeholders`);
  }
}
assert.match(html,/^<!-- MIT License — Copyright \(c\) 2026 NeuralNomadsAI\nDesign reuses and adapts code of the MCP Assets addon/);
assert.deepEqual([...manifest.permissions].sort(),['composer.prefill','images.conversation','opencode.designAgent','panel.preferences','session.context','session.images.prompts','session.images.read']);
const dist=await mkdtemp(path.join(os.tmpdir(),'design-package-'));
try {
  execFileSync(process.env.PYTHON||'python',[path.join(root,'scripts/package.py'),source,dist]);
  const zip=await readFile(path.join(dist,`${manifest.id}-${manifest.version}.zip`));
  assert(zip.length<=2*1024*1024,'ZIP within 2 MiB');
  const pkg=await readPanelExtensionArchive(zip);
  assert.deepEqual(pkg.manifest,manifest); assert.equal(pkg.html,html);
} finally { await rm(dist,{recursive:true,force:true}); }
console.log('PASS: package accepted by the host validator; MIT notice, manifest permissions and 10 complete locales');

// Fixture: one Images conversation with two pages, a work conversation, many and empty ones.
const T0=Date.UTC(2026,9,30,9,0), hex=n=>n.toString(16).padStart(2,'0').repeat(32), key=text=>(text+'_'.repeat(22)).slice(0,22);
let n=0;
const image=(label,series,extra={})=>({kind:'image',target:{messageID:`msg_${series}`,part:++n,index:0,digest:hex(n)},series:key(series),time:T0+n*60000,label,mime:'image/png',origin:'unverifiable',...extra});
const proven=(label,series,generationKey,parentKeys=[],extra={})=>image(label,series,{origin:'proven',generationKey,parentKeys,otherRefs:0,...extra});
const generation=(series,tool,outcome,extra={})=>({kind:'generation',target:{messageID:`msg_${series}`,part:++n,digest:hex(n)},series:key(series),time:T0+n*60000,key:key('g'+n),tool,outcome,...extra});
const K={a:key('KA'),a2:key('KA2'),b:key('KB'),old:key('KOLD'),n:key('KN')}, MODEL='fixture/image-1';
const askShow=generation('S2','completed','completed',{key:K.n,prompt:'Banner, bold',model:MODEL});
// Two failures in two replies: one with its prompt, one known only by its time.
const failed={};
const pages={
  ses_images:[{entries:[
    generation('S2','completed','completed',{key:K.a2,prompt:'Refine icon-a, flatter background',model:MODEL}),
    proven('icon-a2','S2',K.a2,[K.a],{otherRefs:1,prompt:'Refine icon-a, flatter background',model:MODEL}), image('icon-x','S2'), image(null,'S2'),
    generation('S2','running','none'), generation('S2','streaming','none'), failed.s2=generation('S2','error','none',{prompt:'Logo, bold {{1}} `monogram`',model:MODEL}),
    generation('S2','completed','unknown'), askShow, generation('S2','completed','cancelled'), generation('S2','unknown','none'),
    proven('icon-a','S1',K.a,[],{prompt:'App icon, minimal direction',model:MODEL}), proven('icon-b','S1',K.b,[K.old],{prompt:'App icon, bold',model:MODEL}),
    failed.s1=generation('S1','completed','error'),
    generation('S1','completed','completed',{key:K.a,prompt:'App icon, minimal direction',model:MODEL}), generation('S1','completed','completed',{key:K.b,prompt:'App icon, bold',model:MODEL}),
  ],cursor:'1'},{entries:[proven('icon-old','S0',K.old,[],{prompt:'App icon, first pass',model:MODEL}), generation('S0','completed','completed',{key:K.old})],cursor:null}],
  ses_work:[{entries:[image('work-shot','W')],cursor:null}],
  ses_many:[{entries:Array.from({length:21},(_,index)=>image(`many-${index+1}`,'M')),cursor:null}],
  ses_fresh:[{entries:[],cursor:null}], ses_empty:[{entries:[],cursor:null}],
};
const all=Object.values(pages).flatMap(list=>list.flatMap(page=>page.entries));
const byLabel=label=>all.find(entry=>entry.kind==='image'&&entry.label===label);
const refs=Object.fromEntries([...['icon-a2','icon-a','icon-b','icon-old'].map(label=>[byLabel(label).target.digest,`.codenomad/design/icon/${label}.png`]),[askShow.target.digest,'.codenomad/design/banner/banner-bold-a.png']]);
const ALLOWED=['images.status','images.list','images.read','composer.prefill','conversation.status','conversation.open','conversation.startNew','preferences.get','preferences.set'];

const browser=await chromium.launch({executablePath:process.env.CODENOMAD_BROWSER_PATH||undefined});
const seed=await browser.newPage();
const labels=[...new Set(all.filter(entry=>entry.kind==='image').map(entry=>entry.label??'outside'))];
const png=await seed.evaluate(labels=>Object.fromEntries(labels.map((label,index)=>{
  const draw=size=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const g=canvas.getContext('2d');g.fillStyle=`hsl(${index*47%360} 70% 50%)`;g.fillRect(0,0,size,size);g.fillStyle='#fff';g.fillRect(size/4,size/4,size/(2+index%3),size/2);return canvas.toDataURL('image/png');};
  return [label,{thumb:draw(32),full:draw(96)}];
})),labels);
await seed.close();
const fixture={pages,refs,png,imagesSessions:['ses_images','ses_many','ses_fresh'],lastUsed:T0+86400000};
const doc=panelExtensionDocument(html,'design-test',4,manifest.permissions);

const hostScript=`
const doc=await (await fetch('/doc')).text(), fixture=await (await fetch('/fixture')).json();
const H=window.H={context:{apiVersion:4,sessionId:'ses_images',locale:'en',appearance:'dark',colors:{background:'#343a43',surface:'#252a31',text:'#e8ecf1',muted:'#a9b2bf',border:'#4a5361',focus:'#7fb2f0'}},
  status:{generation:'available',imageModels:true,designAgent:'present',contentVersion:1,chatModelSeesImages:true},lookup:'absent',gitExclusion:'excluded',
  store:{},storeMode:'ok',draft:'',lastPrefill:-Infinity,refused:[],calls:[],unknown:0,topMessages:0,maxInFlight:0,conflictOnce:false,delay:15,delays:{},answered:[],mounts:0,after:null};
let port, frame;
window.addEventListener('message',event=>{ if(frame&&event.source===frame.contentWindow) H.topMessages++; });
H.mount=()=>{
  const mine=++H.mounts; document.querySelector('iframe')?.remove(); port?.close();
  frame=document.createElement('iframe'); frame.title='Design'; frame.setAttribute('sandbox','allow-scripts'); frame.style.cssText='width:100%;height:100%;border:0;display:block';
  frame.onload=()=>{ if(mine!==H.mounts) return; const channel=new MessageChannel(), own=channel.port1; own.inFlight=0; port=own;
    own.onmessage=event=>handle(own,event.data); frame.contentWindow.postMessage({type:'codenomad:init'},'*',[channel.port2]); };
  frame.srcdoc=doc; document.body.append(frame);
};
H.update=value=>{ H.context={...H.context,...value}; port.postMessage({type:'context',context:H.context}); };
H.navigate=sessionId=>{ H.context={...H.context,sessionId}; H.mount(); };
H.changed=(detail)=>port.postMessage({type:'images:changed',gallery:!!detail.gallery,status:!!detail.status});
H.count=name=>H.calls.filter(call=>call.name===name).length;
function handle(own,data){
  if(data?.type==='ready'){ own.postMessage({type:'context',context:H.context}); return; }
  if(data?.type!=='api4:request') return;
  const {id,capability,method,input}=data, name=capability+'.'+method;
  H.calls.push({name,input:JSON.parse(JSON.stringify(input??null))}); own.inFlight++; H.maxInFlight=Math.max(H.maxInFlight,own.inFlight);
  const answer=message=>setTimeout(()=>{ own.inFlight--; own.postMessage({type:'api4:result',id,...message}); H.answered.push(name);
    if(H.after){ const after=H.after; H.after=null; setTimeout(after,0); } },H.delays[name]??H.delay);
  Promise.resolve().then(()=>run(name,input??{})).then(result=>answer({result}),()=>answer({error:true}));
}
function run(name,input){
  const session=H.context.sessionId, images=fixture.imagesSessions.includes(session);
  switch(name){
    case 'images.status': return H.status;
    case 'images.list': {
      if(!session) return {status:'page',entries:[],cursor:null};
      if(input.cursor&&H.conflictOnce){ H.conflictOnce=false; return {status:'blocked',reason:'conflict'}; }
      const page=fixture.pages[session][Number(input.cursor??0)];
      // Prompts reach only a marked Images conversation.
      const entries=page.entries.map(entry=>{ if(images) return entry; const {prompt,promptTruncated,model,...rest}=entry; return rest; });
      return {status:'page',entries,cursor:page.cursor};
    }
    case 'images.read': {
      const entry=Object.values(fixture.pages).flat().flatMap(page=>page.entries).find(item=>item.kind==='image'&&item.target.digest===input.target.digest);
      if(!entry) return {status:'blocked',reason:'missing'};
      if(!input.thumbnail&&entry.label===null) return {status:'not-previewable'};
      const art=fixture.png[entry.label??'outside']; return {status:'asset',mime:'image/png',uri:input.thumbnail?art.thumb:art.full};
    }
    case 'composer.prefill': return prefill(input);
    case 'conversation.status': return images ? {lookup:'found',imageCount:null,lastUsed:fixture.lastUsed,displayedIsImages:true,gitExclusion:H.gitExclusion}
      : {lookup:H.lookup,imageCount:H.lookup==='found'?4:null,lastUsed:H.lookup==='found'?fixture.lastUsed:null,displayedIsImages:false,gitExclusion:H.lookup==='found'?H.gitExclusion:null};
    case 'conversation.open': { const created=H.lookup==='absent'; H.lookup='found'; H.after=()=>H.navigate('ses_images'); return {opened:true,created}; }
    case 'conversation.startNew': H.after=()=>H.navigate('ses_fresh'); return {opened:true};
    case 'preferences.get': return H.storeMode==='unavailable'?'unavailable':H.store;
    case 'preferences.set': {
      if(H.storeMode==='unavailable') return 'unavailable';
      if(!input.value||typeof input.value!=='object'||Array.isArray(input.value)) return 'invalid';
      const text=JSON.stringify(input.value); if(new TextEncoder().encode(text).length>4096) return 'too-large';
      H.store=JSON.parse(text); return 'saved';
    }
    default: H.unknown++; throw new Error('unknown');
  }
}
async function prefill({text,refs=[]}){
  if(typeof text!=='string'||refs.length>16) return 'invalid';
  if(!H.context.sessionId) return 'no-session';
  const now=Date.now(); if(now-H.lastPrefill<1000) return 'busy'; H.lastPrefill=now;
  if(await window.prefillMarkers(text,refs.length)==='invalid') return 'invalid';
  const paths=refs.map(ref=>H.refused.includes(ref.digest)?null:fixture.refs[ref.digest]??null);
  if(paths.some(item=>item===null)) return 'invalid';
  const composed=await window.composePrefill(H.draft,text,paths);
  if(composed.status==='added') H.draft=composed.draft;
  return composed.status;
}
H.mount();`;
const server=createServer((request,response)=>{
  const body={'/doc':doc,'/fixture':JSON.stringify(fixture),'/host.js':hostScript}[request.url]??'<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}</style><script type="module" src="/host.js"></script>';
  response.setHeader('Content-Type',request.url==='/host.js'?'text/javascript':request.url==='/fixture'?'application/json':'text/html; charset=utf-8');
  response.end(body);
});

const errors=[];
const until=async(check,message,timeout=6000)=>{const end=Date.now()+timeout;for(;;){const value=await check().catch(()=>undefined);if(value)return value;if(Date.now()>end)throw new Error('Timed out: '+message);await new Promise(resolve=>setTimeout(resolve,25));}};
async function open(width,height){
  const view=await browser.newPage({viewport:{width,height}});
  view.on('pageerror',error=>errors.push(String(error)));
  view.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await view.exposeFunction('composePrefill',(draft,text,paths)=>composePrefill(draft,text,paths));
  await view.exposeFunction('prefillMarkers',(text,count)=>prefillMarkers(text,count));
  await view.goto(`http://127.0.0.1:${server.address().port}/`);
  const frame=view.frameLocator('iframe');
  return {view,frame,host:(fn,arg)=>view.evaluate(fn,arg)};
}
const text=locator=>locator.evaluate(node=>node.textContent);
// Gallery tiles only: lineage chips in the selection carry the same labels.
const tile=(frame,options)=>frame.locator('#series').getByRole('button',options);
const tileLabels=frame=>frame.locator('.tile .caption > span').allTextContents();
async function ready(frame,count){await until(async()=>(await frame.locator('.tile').count())===count&&(await frame.locator('#status').textContent())==='',`${count} tiles`);}
async function loaded(frame){await until(()=>frame.locator('body').evaluate(()=>[...document.querySelectorAll('.tile')].every(tile=>tile.querySelector('img')?.complete)),'every thumbnail');}
// Labels, series and the pixels of every thumbnail (canvas hash), for reconstruction checks.
const fingerprint=frame=>frame.locator('body').evaluate(async()=>({series:[...document.querySelectorAll('#series h3')].map(node=>node.textContent),
  tiles:await Promise.all([...document.querySelectorAll('.tile')].map(async tile=>{const image=tile.querySelector('img');await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const g=canvas.getContext('2d');g.drawImage(image,0,0);
    let hash=0;for(const value of g.getImageData(0,0,canvas.width,canvas.height).data)hash=(hash*31+value)>>>0;return `${tile.textContent}#${hash}`;}))}));
const tick=view=>view.waitForTimeout(1050);
// Columns of the newest series' grid, read once the gallery settled.
const columns=frame=>frame.locator('#series .grid').first().evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length);
const capture=async(view,name)=>{if(!process.env.CODENOMAD_PANEL_CAPTURE_DIR)return;await mkdir(process.env.CODENOMAD_PANEL_CAPTURE_DIR,{recursive:true});
  await view.screenshot({path:path.join(process.env.CODENOMAD_PANEL_CAPTURE_DIR,`design-${name}.png`)});};
const notice=frame=>frame.locator('#notice').textContent();

try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const {view,frame,host}=await open(420,2600);
  await ready(frame,5);

  // AC-34: series, labels, origin badges, generation states, host colours.
  assert.deepEqual(await tileLabels(frame),['icon-a2','icon-x','Outside the project','icon-a','icon-b']);
  assert.equal(await frame.locator('#series h3').count(),2);
  assert.equal(await frame.locator('.tile .badge').count(),2);
  assert.equal(await frame.locator('#gensTitle').textContent(),'Generations (11)');
  assert.deepEqual((await frame.locator('.gen').evaluateAll(nodes=>nodes.map(node=>node.dataset.state))).sort(),
    ['cancelled','done','done','done','failed','failed','launched','no-read','preparing','preparing','unknown'].sort());
  assert.equal(await frame.locator('#gens').evaluate(node=>node.open),true);
  assert.equal(await frame.locator('.gen').first().locator('.prompt').textContent(),'Refine icon-a, flatter background');
  for (const selector of ['html','body']) assert.equal(await frame.locator(selector).evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(52, 58, 67)');
  assert.equal(await frame.locator('#card').getAttribute('data-state'),'images');
  assert.equal(await frame.locator('#recipes button').count(),6);
  assert.equal(await frame.locator('#turns').inputValue(),'3');
  assert.equal(await columns(frame),2,'two columns at 420 px');
  await view.setViewportSize({width:600,height:2600}); await until(async()=>await columns(frame)===3,'three columns when wide',2000);
  await view.setViewportSize({width:420,height:2600}); await until(async()=>await columns(frame)===2,'two columns again',2000);
  assert.deepEqual(await frame.locator('body').evaluate(()=>Object.keys(window.codenomad).sort()),['apiVersion','composer','conversation','getContext','images','onContext','preferences']);
  console.log('PASS: series, labels, origin badges, generation states, colours and declared bridge objects');

  // AC-58: unverifiable keeps pixels only and cannot be referenced; proven shows prompt, model and parents.
  await tile(frame,{name:/^icon-x/}).click();
  const detail=frame.locator('#selection');
  await until(()=>detail.locator('.big img').evaluate(image=>image.complete&&image.naturalWidth>0),'unverifiable pixels');
  assert.match(await text(detail),/origin not verifiable/);
  assert.equal(await detail.locator('dt').count(),0,'no prompt, model or parent');
  for (const name of ['Refine','Variants','Apply direction','Save to project…']) assert.equal(await detail.getByRole('button',{name,exact:true}).isDisabled(),true,name);
  assert.match(await text(detail),/Only images of this project with a verifiable origin can be referenced\./);
  await tile(frame,{name:'Outside the project'}).click();
  assert.equal(await detail.getByRole('button',{name:'Refine',exact:true}).isDisabled(),true,'outside the project');
  await tile(frame,{name:/^icon-a2/}).click();
  assert.deepEqual(await detail.locator('dt').allTextContents(),['Prompt','Model','Made from']);
  assert.equal(await detail.locator('dd.prompt').textContent(),'Refine icon-a, flatter background');
  assert.match(await text(detail.locator('[data-lineage=parents]')),/^icon-a1 other reference\(s\)$/);
  assert.equal(await detail.getByRole('button',{name:'Refine',exact:true}).isDisabled(),false);
  await capture(view,'detail');
  await detail.locator('[data-lineage=parents]').getByRole('button',{name:'icon-a'}).click();
  assert.equal(await text(detail.locator('[data-lineage=children]')),'icon-a2','children by key');
  await tile(frame,{name:/^icon-b/}).click();
  assert.equal(await text(detail.locator('[data-lineage=parents]')),'in older images');
  await frame.getByRole('button',{name:'Older images'}).click();
  await ready(frame,6);
  assert.equal(await text(detail.locator('[data-lineage=parents]')),'icon-old','parent on another page linked by key');
  console.log('PASS: unverifiable origin shows pixels only, refusal of references, proven prompt/model/parents and lineage across pages');

  // Compare with 16, 32 and 64 px previews.
  await frame.getByRole('button',{name:'Compare'}).click();
  assert.equal(await frame.getByRole('button',{name:'Compare'}).getAttribute('aria-pressed'),'true');
  assert.equal(await text(detail),'Select two images to compare.');
  await tile(frame,{name:/^icon-a$/}).click();
  assert.equal(await detail.locator('figure').count(),2);
  await until(()=>detail.locator('.sizes img').evaluateAll(images=>images.every(image=>image.complete&&image.naturalWidth>0)),'small sizes');
  assert.deepEqual(await detail.locator('.sizes img').evaluateAll(images=>images.map(image=>image.getBoundingClientRect().width)),[16,32,64,16,32,64]);
  assert.equal(await detail.locator('.pair').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),2);
  assert.equal(await detail.locator('.widen').isVisible(),false);
  await capture(view,'compare');
  await frame.getByRole('button',{name:'Compare'}).click();
  console.log('PASS: side-by-side comparison with 16, 32 and 64 px previews');

  // Keyboard: focus ring, selection, viewer arrows and Escape.
  await frame.locator('#refresh').focus(); await view.keyboard.press('Tab');
  assert.equal(await frame.locator('body').evaluate(()=>document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle),'solid');
  await tile(frame,{name:/^icon-a2/}).focus(); await view.keyboard.press('Enter');
  assert.equal(await tile(frame,{name:/^icon-a2/}).getAttribute('aria-pressed'),'true');
  await detail.getByRole('button',{name:'View full size'}).focus(); await view.keyboard.press('Enter');
  await frame.locator('dialog[open] #full img').evaluate(image=>image.decode());
  assert.equal(await frame.locator('#viewTitle').textContent(),'icon-a2');
  await view.keyboard.press('ArrowRight'); await until(async()=>(await frame.locator('#viewTitle').textContent())==='icon-x','next image');
  await view.keyboard.press('ArrowRight'); await frame.locator('dialog[open]').getByText('Preview unavailable for this image.').waitFor();
  await view.keyboard.press('Escape'); assert.equal(await frame.locator('dialog[open]').count(),0);
  console.log('PASS: keyboard focus ring, selection, viewer arrows, unavailable full size and Escape');

  // AC-35, AC-37, AC-38, S7, S8: every request only prefills the composer, with the live region answering.
  const prefills=[];
  const press=async(locator,expected)=>{await tick(view);await locator.click();await until(async()=>(await notice(frame))===expected,expected);prefills.push(await host(()=>H.draft));};
  if ((await tile(frame,{name:/^icon-a2/}).getAttribute('aria-pressed'))!=='true') await tile(frame,{name:/^icon-a2/}).click();
  const added='Added to the message box. Edit it, then send.', path2='`.codenomad/design/icon/icon-a2.png`';
  await press(detail.getByRole('button',{name:'Refine',exact:true}),added);
  assert.equal(await host(()=>H.draft),`Refine image icon-a2 (${path2}) keeping its direction. 3 image(s): `);
  await detail.getByRole('button',{name:'Variants'}).click();
  await until(async()=>(await notice(frame))==='The message box is busy. Try again in a moment.','busy within a second');
  await press(detail.getByRole('button',{name:'Variants'}),added);
  await detail.getByRole('combobox',{name:'Direction'}).selectOption('friendly');
  await press(detail.getByRole('button',{name:'Apply direction'}),added);
  await press(detail.getByRole('button',{name:'Save to project…'}),added);
  await press(frame.getByRole('button',{name:'App icon'}),added);
  await press(frame.locator('.gen[data-state=no-read]').getByRole('button',{name:'Ask the agent to show it'}),added);
  // Each Retry names its own generation: time and prompt (braces and backticks removed), else time alone.
  const shown=time=>frame.locator('body').evaluate((_,time)=>new Intl.DateTimeFormat('en',{dateStyle:'short',timeStyle:'short'}).format(time),time);
  const [failedAt2,failedAt1]=[await shown(failed.s2.time),await shown(failed.s1.time)];
  assert.notEqual(failedAt2,failedAt1);
  await press(frame.locator('.gen[data-state=failed]').nth(0).getByRole('button',{name:'Retry'}),added);
  await press(frame.locator('.gen[data-state=failed]').nth(1).getByRole('button',{name:'Retry'}),added);
  assert.equal(await host(()=>H.draft),[
    `Refine image icon-a2 (${path2}) keeping its direction. 3 image(s): `,
    `Make variants of image icon-a2 (${path2}) keeping its composition. 3 image(s): `,
    `Apply the Friendly direction (\`friendly\`) to image icon-a2 (${path2}). 3 image(s): `,
    `Copy ${path2} into the project, to: `,
    'New design: App icon (recipe `app-icon`). 3 image(s). Brief: ',
    'Read the generated image `.codenomad/design/banner/banner-bold-a.png` and show it here with your critique.',
    `Retry the failed image generation from ${failedAt2} (prompt: “Logo, bold 1 monogram”). 3 image(s): `,
    `Retry the failed image generation from ${failedAt1}. 3 image(s): `].join('\n\n'));
  await host(digest=>H.refused.push(digest),byLabel('icon-a2').target.digest);
  await press(detail.getByRole('button',{name:'Refine',exact:true}),'The message box refused this request: its draft is a command or ends with a mention, or the image can no longer be referenced.');
  await host(()=>{H.refused=[];});
  await frame.getByRole('combobox',{name:'Images per turn'}).selectOption('2');
  await until(()=>host(()=>H.store.imagesPerTurn===2),'preference saved');
  await press(detail.getByRole('button',{name:'Refine',exact:true}),added);
  assert(await host(()=>H.draft.endsWith('keeping its direction. 2 image(s): ')));
  const calls=await host(()=>({names:[...new Set(H.calls.map(call=>call.name))],unknown:H.unknown,top:H.topMessages,refs:H.calls.filter(call=>call.name==='composer.prefill').map(call=>call.input.refs?.length??0)}));
  assert(calls.names.every(name=>ALLOWED.includes(name)),calls.names.join());
  assert.deepEqual([calls.unknown,calls.top],[0,0]);
  assert.deepEqual(calls.refs,[1,1,1,1,1,0,1,0,0,1,1],'retry and recipes carry no reference');
  console.log('PASS: refine, variants, direction, save, recipe, ask-to-show and retry only prefill; busy, refused references and images per turn');

  // AC-37: the setting survives remounts; invalid or unavailable preferences give 3.
  await host(()=>H.mount()); await ready(frame,5);
  assert.equal(await frame.locator('#turns').inputValue(),'2');
  for (const [store,mode] of [[{imagesPerTurn:9},'ok'],[{imagesPerTurn:'4'},'ok'],[{},'unavailable']]) {
    await host(([store,mode])=>{H.store=store;H.storeMode=mode;H.mount();},[store,mode]); await ready(frame,5);
    assert.equal(await frame.locator('#turns').inputValue(),'3',JSON.stringify(store)+mode);
  }
  // A late stored value never overrides the user's choice.
  await host(()=>{H.store={};H.storeMode='ok';H.delays={'preferences.get':1500};H.answered=[];H.mount();});
  await until(()=>frame.locator('#turnsBox').isVisible(),'selector shown before preferences answer',3000);
  assert.equal(await host(()=>H.answered.includes('preferences.get')),false,'preferences still pending');
  await frame.getByRole('combobox',{name:'Images per turn'}).selectOption('2');
  await until(()=>host(()=>H.store.imagesPerTurn===2),'choice saved');
  await until(()=>host(()=>H.answered.includes('preferences.get')),'late preferences answer');
  await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  assert.equal(await frame.locator('#turns').inputValue(),'2','late answer ignored');
  await host(()=>{H.delays={};H.store={};});
  console.log('PASS: images per turn kept across remounts, invalid, unavailable and late preferences');

  // AC-34: identical reconstruction, pixels included, after a conversation and a tab round trip.
  await host(()=>H.mount()); await ready(frame,5); await loaded(frame);
  const before=await fingerprint(frame);
  assert.equal(new Set(before.tiles.map(tile=>tile.split('#')[1])).size,5,'distinct pixels');
  await host(()=>H.update({sessionId:'ses_work'})); await ready(frame,1);
  await host(()=>H.update({sessionId:'ses_images'})); await ready(frame,5); await loaded(frame);
  assert.deepEqual(await fingerprint(frame),before,'conversation round trip');
  await host(()=>H.mount()); await ready(frame,5); await loaded(frame);
  assert.deepEqual(await fingerprint(frame),before,'tab round trip');
  console.log('PASS: identical gallery and thumbnail pixels after conversation and tab round trips');

  // Invalidations: status re-reads status only; gallery restarts from the first page; a conflict too.
  const count=name=>host(name=>H.count(name),name);
  const [lists,statuses]=[await count('images.list'),await count('images.status')];
  await host(()=>H.changed({status:true}));
  await until(async()=>await count('images.status')===statuses+1&&await count('conversation.status')>0,'status re-read');
  assert.equal(await count('images.list'),lists);
  await frame.getByRole('button',{name:'Older images'}).click(); await ready(frame,6);
  await host(()=>H.changed({gallery:true})); await ready(frame,5);
  assert.equal(await host(()=>H.calls.filter(call=>call.name==='images.list').at(-1).input.cursor),undefined);
  await host(()=>{H.conflictOnce=true;}); await frame.getByRole('button',{name:'Older images'}).click();
  await until(async()=>!(await host(()=>H.conflictOnce)),'conflict served'); await ready(frame,5);
  console.log('PASS: status and gallery invalidations, first-page restart and cursor conflict recovery');

  // AC-36: S2, S2u, S3, S4, S14 and S17 are hints without buttons; shortcuts follow the agent.
  const notes=()=>frame.locator('#notes .note').evaluateAll(nodes=>nodes.map(node=>`${node.dataset.state}:${node.textContent}`));
  const setStatus=async(patch,git='excluded')=>{await host(([patch,git])=>{H.status={...H.status,...patch};H.gitExclusion=git;H.changed({status:true});},[patch,git]);};
  await setStatus({designAgent:'absent',contentVersion:null});
  await until(async()=>(await notes()).join()==='s2:Design agent not available. Enable the Design extension, or see the Design help.','S2');
  assert.equal(await frame.locator('#shortcuts').isHidden(),true);
  await setStatus({designAgent:'user'});
  await until(async()=>(await notes()).join()==='s2u:Your own Design agent is used.','S2u');
  assert.equal(await frame.locator('#recipes button').count(),6);
  await setStatus({designAgent:'present',contentVersion:1,generation:'disabled'});
  await until(async()=>(await notes()).join()==='s3:Image generation is turned off. Turn it on in Settings → Providers → Images.','S3');
  await setStatus({generation:'unsupported'});
  await until(async()=>(await notes()).join()==='s3x:The connected OpenCode doesn’t offer image generation.','S3 unsupported');
  await setStatus({generation:'available',imageModels:false});
  await until(async()=>(await notes()).join()==='s4:No connected provider offers an image model. Connect one in Settings → Providers.','S4');
  await setStatus({imageModels:true,chatModelSeesImages:false},'unavailable');
  await until(async()=>(await notes()).join('|')==='s14:This conversation’s model doesn’t receive images: the agent can’t critique them visually.|s17:Images in this location may appear in Git.','S14, S17');
  assert.equal(await frame.locator('.tile').count(),5,'S14 keeps the gallery');
  assert.equal(await frame.locator('#notes button, #notes a').count(),0,'hints only');
  await setStatus({chatModelSeesImages:true},'unavailable');
  await until(async()=>(await notes()).join()==='s17:Images in this location may appear in Git.','S17 alone');
  await setStatus({},'excluded');
  console.log('PASS: S2, S2u, S3, S4, S14 and S17 hints, shortcuts per agent state');

  // S13, S1, S1u, found, S1 opening, New Images conversation, empty states, no conversation.
  await host(()=>{H.lookup='absent';H.update({sessionId:'ses_work'});}); await ready(frame,1);
  assert.equal(await frame.locator('#card').getAttribute('data-state'),'s1');
  assert.match(await text(frame.locator('#card')),/^Create images with the Design agentA dedicated Images conversation.*Image generation onImage model availableDesign agent readyOpen the Images conversation$/);
  assert.equal(await frame.locator('#shortcuts').isHidden(),true); assert.equal(await frame.locator('#turnsBox').isHidden(),true);
  assert.equal(await frame.locator('#where').textContent(),'This conversation');
  await capture(view,'s1');
  await tile(frame,{name:/^work-shot/}).click();
  assert.deepEqual(await detail.getByRole('button').allTextContents(),['View full size'],'S13: no request buttons');
  await host(()=>{H.lookup='unknown';H.changed({status:true});});
  await until(async()=>await frame.locator('#card').getAttribute('data-state')==='s1u','S1u');
  const looked=await count('conversation.status');
  await frame.getByRole('button',{name:'Retry'}).click(); await until(async()=>await count('conversation.status')===looked+1,'retry lookup');
  await host(()=>{H.lookup='found';H.changed({status:true});});
  await until(async()=>await frame.locator('#card').getAttribute('data-state')==='found','found');
  assert.match(await text(frame.locator('#card p')),/^Images conversation · 4 image\(s\) · used .+$/);
  await host(()=>{H.lookup='absent';H.changed({status:true});});
  await until(async()=>await frame.locator('#card').getAttribute('data-state')==='s1','S1 again');
  await frame.getByRole('button',{name:'Open the Images conversation'}).click();
  await until(async()=>(await host(()=>H.context.sessionId))==='ses_images','opened'); await ready(frame,5);
  assert.equal(await count('conversation.open'),1);
  await frame.getByRole('button',{name:'New Images conversation'}).click();
  await until(async()=>(await host(()=>H.context.sessionId))==='ses_fresh','new conversation');
  await until(async()=>(await frame.locator('#status').textContent())==='Nothing has been generated yet.','fresh Images conversation');
  await host(()=>H.navigate('ses_many')); await ready(frame,21);
  assert.equal(await frame.getByRole('button',{name:'New Images conversation'}).getAttribute('class'),'primary');
  assert.match(await text(frame.locator('#card')),/many images/);
  await host(()=>H.navigate('ses_empty'));
  await until(async()=>(await frame.locator('#status').textContent())==='No read-back images in this conversation.','empty work conversation');
  await host(()=>H.update({sessionId:null}));
  await until(async()=>(await frame.locator('#status').textContent())==='No conversation displayed.','no conversation');
  assert.equal(await frame.locator('#where').textContent(),'No conversation');
  const prefillsBefore=await count('composer.prefill');
  assert.equal(await count('conversation.startNew'),1); assert.equal(prefillsBefore,11);
  console.log('PASS: S13, S1 with readiness, S1u retry, found card, opening, New Images conversation emphasis and empty states');

  // Object URLs are released with the conversation.
  await host(()=>H.navigate('ses_empty')); await until(async()=>(await frame.locator('#status').textContent())!=='Loading…','empty');
  await frame.locator('body').evaluate(()=>{window.created=0;window.revoked=0;const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
    URL.createObjectURL=(...args)=>{window.created++;return create(...args);};URL.revokeObjectURL=(...args)=>{window.revoked++;return revoke(...args);};});
  await host(()=>H.update({sessionId:'ses_work'})); await ready(frame,1); await loaded(frame);
  await tile(frame,{name:/^work-shot/}).click(); await detail.getByRole('button',{name:'View full size'}).click();
  await frame.locator('dialog[open] #full img').evaluate(image=>image.decode()); await view.keyboard.press('Escape');
  await host(()=>H.update({sessionId:'ses_empty'})); await until(async()=>(await frame.locator('#status').textContent())==='No read-back images in this conversation.','cleared');
  assert.deepEqual(await frame.locator('body').evaluate(()=>[window.created>=2,window.created===window.revoked]),[true,true]);
  console.log('PASS: thumbnail and full-size bytes released on conversation change');

  // AC-39: 10 locales, RTL, square corners, palette changes.
  await host(()=>H.update({sessionId:'ses_images'})); await ready(frame,5);
  for (const locale of ['en','fr-FR','de','es','he','ja','ne','ru','tr','zh-Hans']) {
    await host(locale=>H.update({locale}),locale);
    const words=T[locale.split('-')[0]];
    await until(async()=>(await frame.locator('#compare').textContent())===words.compare,locale);
    assert.equal(await frame.locator('#galleryTitle').textContent(),words.gallery);
    assert.equal(await frame.locator('html').getAttribute('dir'),locale==='he'?'rtl':'ltr');
    assert.equal(await frame.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true,locale+' overflow');
  }
  await host(()=>H.update({locale:'en',appearance:'light',colors:{background:'#e1e5eb',surface:'#ffffff',text:'#1d2430',muted:'#5d6878',border:'#c3cad5',focus:'#2f6db5'}}));
  await until(async()=>(await frame.locator('body').evaluate(node=>getComputedStyle(node).backgroundColor))==='rgb(225, 229, 235)','light palette');
  assert.deepEqual(await frame.locator('body').evaluate(()=>[...document.querySelectorAll('*')].filter(node=>{const style=getComputedStyle(node);
    return [style.borderTopLeftRadius,style.borderTopRightRadius,style.borderBottomLeftRadius,style.borderBottomRightRadius].some(value=>value!=='0px');}).map(node=>node.tagName)),[]);
  await capture(view,'light');
  console.log('PASS: 10 locales with RTL Hebrew, square corners and palette changes');

  // Mount/unmount stability: rapid remounts, bounded concurrency, no errors.
  for (let index=0;index<6;index++) await host(()=>H.mount());
  await ready(frame,5); await loaded(frame);
  assert((await host(()=>H.maxInFlight))<=4,'at most four pending requests per mount');
  await view.close();
  console.log('PASS: rapid remounts settle on one complete gallery with at most four pending requests');

  // S11: narrow panel keeps one action inline and asks to widen for comparison.
  const narrow=await open(320,1800);
  await ready(narrow.frame,5);
  await tile(narrow.frame,{name:/^icon-a2/}).click();
  const narrowDetail=narrow.frame.locator('#selection');
  assert.equal(await narrowDetail.getByRole('button',{name:'Refine',exact:true}).isVisible(),true);
  assert.equal(await narrowDetail.getByRole('button',{name:'Variants'}).isVisible(),false);
  await narrowDetail.locator('summary[aria-label="More actions"]').click();
  assert.equal(await narrowDetail.getByRole('button',{name:'Variants'}).isVisible(),true);
  await narrow.frame.getByRole('button',{name:'Compare'}).click(); await tile(narrow.frame,{name:/^icon-a$/}).click();
  assert.equal(await narrowDetail.locator('.pair').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),1);
  assert.equal(await columns(narrow.frame),1,'one gallery column in a narrow panel');
  assert.equal(await narrowDetail.getByText('Widen the panel to compare side by side.').isVisible(),true);
  await capture(narrow.view,'narrow');
  await narrow.view.close();
  console.log('PASS: S11 narrow layout');

  // S12: phone width, two-column gallery, side-by-side comparison and a full-screen viewer.
  const phone=await open(390,844);
  await ready(phone.frame,5);
  assert.equal(await columns(phone.frame),2,'two columns at phone width');
  await tile(phone.frame,{name:/^icon-a2/}).click();
  await phone.frame.locator('#selection').getByRole('button',{name:'View full size'}).click();
  assert.equal(Math.round((await phone.frame.locator('dialog[open]').boundingBox()).width),390);
  await phone.view.keyboard.press('Escape');
  await phone.view.close();
  console.log('PASS: S12 phone layout');

  assert.deepEqual(errors,[],'no page, console or CSP errors');
  console.log('PASS: no page, console or CSP errors');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
