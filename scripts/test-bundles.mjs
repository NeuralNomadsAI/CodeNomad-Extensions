// node scripts/test-bundles.mjs [pinned CodeNomad checkout]
// Scope: the packaged author's HTML + real archive validator/frame-document bridge.
// The MessagePort host is simulated. This does NOT exercise ExtensionPanel, native
// confirmation UI, backend management, RPCs, desktop/profile or actual attachment.
// Optional: AXE_CORE_PATH=<axe.min.js>; CODENOMAD_PANEL_CAPTURE_DIR=<directory>.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,mkdir,writeFile,symlink} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fixture,palettes,installationFixture,installationStates} from './fixtures/bundles/data.mjs';

const PIN='abb5789658dfb66a1c24af7fff498ab21b9425f3';
assert(process.argv[2],'Usage: node scripts/test-bundles.mjs <pinned CodeNomad checkout>');
const checkout=path.resolve(process.argv[2]);
const root=fileURLToPath(new URL('..',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:checkout,encoding:'utf8',windowsHide:true}).trim();
assert.equal(git('rev-parse',`${PIN}^{commit}`),PIN,'immutable CodeNomad test pin exists');
const consumed=[
  'packages/ui/src/components/panel-extensions/frame-document.ts',
  'packages/server/src/panel-extensions/archive.ts',
  'packages/server/src/panel-extensions/contract.ts',
  'packages/server/src/panel-extensions/bundles-contract.ts',
  'packages/server/src/opencode/integrations/contract.ts',
  'packages/server/src/opencode/integrations/status.ts',
  'packages/server/src/panel-extensions/bundles-docs.ts',
];
const sourceHashes={};
const require=createRequire(path.join(checkout,'package.json'));
const {chromium}=require('playwright'),{tsImport}=require('tsx/esm/api');
const LOCALES=['en','fr','de','es','he','ja','ne','ru','tr','zh'];
const axePin=JSON.parse(await readFile(new URL('./fixtures/bundles/axe.json',import.meta.url),'utf8'));
const failures=[],results=[],audits=[],captures=[],errors=[];
async function test(name,run){try{await run();results.push(name);console.log('PASS:',name);}catch(error){failures.push({name,error:String(error.stack||error)});console.error('FAIL:',name,'\n'+error.stack);}}
const tempRoot=path.join(os.tmpdir(),'opencode');await mkdir(tempRoot,{recursive:true});
const tmp=await mkdtemp(path.join(tempRoot,'bundles-test-'));
let browser,server;
try {
  // Export exact Git blobs, never mutable HEAD/index/worktree sources. Only the
  // already-installed test dependencies are borrowed from the supplied checkout.
  const exported=path.join(tmp,'contract');
  for(const file of consumed){
    const bytes=execFileSync('git',['show',`${PIN}:${file}`],{cwd:checkout,windowsHide:true});
    const expected=git('rev-parse',`${PIN}:${file}`);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),expected);
    sourceHashes[file]=expected;
    const target=path.join(exported,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);
  }
  await writeFile(path.join(exported,'package.json'),'{"type":"module"}\n');
  await symlink(path.join(checkout,'node_modules'),path.join(exported,'node_modules'),process.platform==='win32'?'junction':'dir');
  const load=file=>tsImport(pathToFileURL(path.join(exported,file)).href,import.meta.url);
  const {panelExtensionDocument,PANEL_EXTENSION_SANDBOX}=await load(consumed[0]);
  const {readPanelExtensionArchive}=await load(consumed[1]);
  const schemas=await load(consumed[3]);
  const {isIntegrationDocsUrl}=await load(consumed[6]);
  const oldPin='bea9af583b88481f35b3470930d48458fecfdded',oldPath='packages/ui/src/components/panel-extensions/frame-document.ts';
  const oldBytes=execFileSync('git',['show',`${oldPin}:${oldPath}`],{cwd:checkout,windowsHide:true});
  sourceHashes[`${oldPin}:${oldPath}`]=createHash('sha1').update(`blob ${oldBytes.length}\0`).update(oldBytes).digest('hex');
  assert.equal(sourceHashes[`${oldPin}:${oldPath}`],git('rev-parse',`${oldPin}:${oldPath}`));
  await writeFile(path.join(exported,'legacy-frame.ts'),oldBytes);
  const {panelExtensionDocument:oldDocument}=await load('legacy-frame.ts');
  const catalogueBytes=Buffer.from((await readFile(new URL('./fixtures/bundles/catalog.json',import.meta.url),'utf8')).replace(/\r\n/g,'\n'));
  const catalogBlob=createHash('sha1').update(`blob ${catalogueBytes.length}\0`).update(catalogueBytes).digest('hex');
  assert.equal(catalogBlob,'752451bff8d9e3779b8dbf3087cca2ab16492804','verbatim OI 54d6e5d catalogue blob');
  const actualCatalog=JSON.parse(catalogueBytes);
  const actualEntry=actualCatalog.integrations[0];
  const realFixture=()=>{const f=fixture();f.catalog.integrations=actualCatalog.integrations.map(({id,displayName,family,summary,app,docs,status})=>({id,displayName,family,summary,app,docs,catalogStatus:status}));
    f.state.integrations=[{...f.state.integrations[0],id:actualEntry.id}];return f;};
  // MOCK backend policy, using the pinned strict schemas and canonical URL policy.
  // This is not the actual HTTP route, external opener or desktop host.
  const resolveDocs=(input,catalog)=>{
    if(!schemas.bundlesHostsInputSchema.safeParse(input).success)return {outcome:'invalid'};
    const entry=catalog.integrations.find(entry=>entry.id===input.integration);
    const result={outcome:!entry?'invalid':catalog.state==='unavailable'||!isIntegrationDocsUrl(entry.docs,input.integration)?'unavailable':'requested'};
    return schemas.bundlesDocsResultSchema.parse(result);
  };
  const source=path.join(root,'extensions/bundles');
  const html=(await readFile(path.join(source,'panel.html'),'utf8')).replace(/\r\n/g,'\n');
  const manifest=JSON.parse(await readFile(path.join(source,'manifest.json'),'utf8'));
  const T=JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
  let pkg;
  await test('pinned source blobs; deterministic ZIP accepted by real archive validator',async()=>{
    for(const directory of ['a','b'])execFileSync(process.env.PYTHON||'python',[path.join(root,'scripts/package.py'),source,path.join(tmp,directory)],{windowsHide:true});
    const name=`${manifest.id}-${manifest.version}.zip`;
    const [a,b]=await Promise.all(['a','b'].map(dir=>readFile(path.join(tmp,dir,name))));
    assert.deepEqual(a,b,'byte-identical deterministic package');
    pkg=await readPanelExtensionArchive(a);
    assert.deepEqual(pkg.manifest,manifest);assert.equal(pkg.html,html);
    assert.equal(pkg.digest,createHash('sha256').update(a).digest('hex'));
    assert.equal((await readFile(path.join(tmp,'a',name+'.sha256'),'utf8')).replace(/\r\n/g,'\n'),`${pkg.digest}  ${name}\n`);
    assert.equal(manifest.apiVersion,4);
    assert.deepEqual([...manifest.permissions].sort(),['bundles.manage','bundles.read','session.context']);
    assert.match(pkg.html,/MIT License — Copyright \(c\) 2026 NeuralNomadsAI/);
  });
  assert(pkg,'cannot run author bytes without successful archive validation');
  await test('10 actual locale dictionaries, exactly 98 keys, nonempty strings and placeholder parity; removed helper prose absent',async()=>{
    assert.deepEqual(Object.keys(T).sort(),[...LOCALES].sort());assert.equal(Object.keys(T.en).length,98);
    for(const locale of LOCALES)for(const key of ['detachGap','nonAffiliation','docsGap'])assert.equal(key in T[locale],false,`${locale}.${key} removed`);
    assert.doesNotMatch(pkg.html,/affiliat/i,'no non-affiliation notice in the panel');
    // Terse copy: every visible state/error is one short phrase; only i-button content may be a sentence.
    for(const locale of LOCALES)for(const key of ['noApi','readFailed','noOffers','offersUnknown','docsRequested','docsUnavailable','docsBusy','docsInvalid','docsFailed','confirmed','expired','requestFailed','busy','invalid'])
      assert(!/[.。।;；]\s*\S/.test(T[locale][key]) && T[locale][key].length<=64,`${locale}.${key} terse: ${T[locale][key]}`);
    const marks=value=>[...value.matchAll(/\{\w+\}/g)].map(match=>match[0]).sort();
    for(const locale of LOCALES){assert.deepEqual(Object.keys(T[locale]).sort(),Object.keys(T.en).sort(),locale);
      for(const [key,value] of Object.entries(T.en)){assert.equal(typeof T[locale][key],'string');assert(T[locale][key].trim(),`${locale}.${key}`);assert.deepEqual(marks(T[locale][key]),marks(value),`${locale}.${key}`);}}
  });
  const validateFixture=value=>{
    schemas.bundlesCatalogResultSchema.parse(value.catalog);schemas.bundlesStateResultSchema.parse(value.state);schemas.bundlesHostsResultSchema.parse(value.hosts);
    return value;
  };
  validateFixture(fixture());
  const methods=['request','setActive','installHost','attach'];
  const validateWire=({capability,method,input})=>{
    assert.equal(capability,'bundles');
    if(method==='catalog'||method==='state')schemas.bundlesEmptyInputSchema.parse(input);
    else if(method==='hosts'||method==='openDocs')schemas.bundlesHostsInputSchema.parse(input);
    else {
      assert(methods.includes(method),`unexpected mutation ${method}; author detach is absent`);
      // Test-only envelope, never sent to the iframe. Native owner/mount authority
      // is outside this harness; the pinned schema still checks each author input.
      schemas.bundlesManageInputSchema.parse({owner:'a'.repeat(32),mountID:'b'.repeat(32),method,input});
    }
    return true;
  };
  await test('strict pinned schemas reject foreign binding authority and malformed mutation inputs',async()=>{
    const f=fixture();f.state.integrations[0].attachment={state:'none',authority:{revision:1}};
    assert.equal(schemas.bundlesStateResultSchema.safeParse(f.state).success,false);
    assert.throws(()=>validateWire({capability:'bundles',method:'attach',input:{integration:'studio',offerID:'short'}}));
    assert.throws(()=>validateWire({capability:'bundles',method:'setActive',input:{integration:'studio',scope:'global',enabled:'yes'}}));
    assert.throws(()=>validateWire({capability:'bundles',method:'request',input:{integration:'studio',scope:'global',action:'install',sessionID:'ses_other'}}));
    for(const kind of installationStates)validateFixture(installationFixture(kind));
    for(const plugin of [{declared:'yes',runtime:'active'},{declared:true,runtime:'pending'},{declared:true,runtime:'unloaded',progress:'expired'},
      {declared:true,runtime:'failed',runtimeID:'private'}, {declared:true,runtime:'active',target:'private'}]){
      const invalid=fixture();invalid.state.integrations[0].plugin=plugin;
      assert.equal(schemas.bundlesStateResultSchema.safeParse(invalid.state).success,false);
    }
    const privateState=fixture();privateState.state.tracking={directory:'private'};
    assert.equal(schemas.bundlesStateResultSchema.safeParse(privateState.state).success,false,'host-private correlation stays outside author projection');
  });
  const doc=panelExtensionDocument(pkg.html,'bundles-fixture',pkg.manifest.apiVersion,pkg.manifest.permissions);
  const oldDoc=oldDocument(pkg.html,'bundles-fixture',pkg.manifest.apiVersion,pkg.manifest.permissions);
  assert.equal(PANEL_EXTENSION_SANDBOX,'allow-scripts');
  const hostScript=await readFile(new URL('./fixtures/bundles/host.js',import.meta.url),'utf8');
  server=createServer((request,response)=>{
    const routes={'/doc':[doc,'text/html; charset=utf-8'],'/old-doc':[oldDoc,'text/html; charset=utf-8'],'/fixture':[JSON.stringify({...fixture(),palettes}),'application/json'],'/host.js':[hostScript,'text/javascript']};
    const [body,type]=routes[request.url]||['<!doctype html><html lang="en"><title>Simulated bundles host</title><style>html,body{margin:0;height:100%;overflow:hidden}</style><body><script type="module" src="/host.js"></script>','text/html; charset=utf-8'];
    response.setHeader('Content-Type',type);response.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.CODENOMAD_BROWSER_PATH||undefined});
  const url=`http://127.0.0.1:${server.address().port}/`;
  async function open(width=420,height=1000,legacy=false){
    const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
    page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.exposeFunction('validateWire',input=>{try{return validateWire(input);}catch(error){errors.push('wire schema: '+String(error));throw error;}});
    await page.exposeFunction('resolveDocs',resolveDocs);
    await page.clock.install({time:new Date('2026-11-01T09:00:00.000Z')});
    await page.goto(url+(legacy?'?legacy':''));
    const frame=page.frameLocator('iframe'),host=(fn,arg)=>page.evaluate(fn,arg);
    await frame.locator('#notice').filter({hasText:T.en.updated}).waitFor();
    return {page,frame,host};
  }
  const body=id=>`#body-${id}`,row=id=>`.integration:has(#title-${id})`;
  const action=(frame,id,key)=>frame.locator(`${body(id)} [data-action=${key}]`).filter({visible:true});
  const docs=(v,id='studio')=>v.frame.locator(`${row(id)} [data-action=docs]`);
  const docsFeedback=(v,id='studio')=>v.frame.locator(`${row(id)} .docs-status`);
  const docsCalls=v=>v.host(()=>H.calls.filter(call=>call.method==='openDocs'));
  const clickDocs=async(v,id='studio')=>{await v.page.clock.fastForward(1001);await docs(v,id).click();await settle(v);};
  const settle=async view=>{
    await view.page.waitForFunction(()=>H.inFlight===0);
    await view.frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const refresh=async(view,value)=>{
    if(value){validateFixture(value);await view.host(value=>{Object.assign(H,value);},value);}
    const before=await view.host(()=>H.count('state'));
    await view.host(()=>H.changed({kind:'state'}));
    await view.page.waitForFunction(before=>H.count('state')>before,before);await settle(view);
  };
  const notice=async(view,key)=>{await view.frame.locator('#notice').filter({hasText:T.en[key]}).waitFor();};
  // Holds the triggered reread so the uncertain notice is observed, then requires
  // that reread (and nothing else) to replace it, without any mutation replay.
  const confirmed=async view=>{
    const before=(await mutations(view)).length;
    await view.host(()=>{H.hold=['catalog','state'];H.finish('confirmed');});await notice(view,'confirmed');
    await view.page.waitForFunction(()=>H.held.length>=2);
    assert.equal(await view.frame.locator('#notice').textContent(),T.en.confirmed,'uncertain until the reread completes');
    await view.host(()=>H.release());await settle(view);await notice(view,'updated');
    assert.equal((await mutations(view)).length,before);
  };
  const expand=async(view,id)=>{const button=view.frame.locator('#title-'+id);if(await button.getAttribute('aria-expanded')!=='true')await button.click();await settle(view);};
  const isFocused=locator=>locator.evaluate(node=>node===document.activeElement);
  const field=(view,key)=>view.frame.locator('#body-studio dt').filter({hasText:new RegExp('^'+T.en[key]+'$')}).evaluate(node=>node.nextElementSibling.textContent);
  const mutations=view=>view.host(()=>H.calls.filter(call=>!['catalog','state','hosts','openDocs'].includes(call.method)));
  async function capture(view,name){
    if(!process.env.CODENOMAD_PANEL_CAPTURE_DIR)return;
    await mkdir(process.env.CODENOMAD_PANEL_CAPTURE_DIR,{recursive:true});
    const file=path.join(process.env.CODENOMAD_PANEL_CAPTURE_DIR,`bundles-${name}.png`);
    const viewport=view.page.viewportSize();
    const height=await view.frame.locator('body').evaluate(node=>Math.max(node.scrollHeight,document.documentElement.scrollHeight));
    // Grow only the test viewport so all expanded real iframe content is captured.
    await view.page.setViewportSize({...viewport,height:Math.max(viewport.height,height)});
    try{await view.page.screenshot({path:file,fullPage:true});captures.push(file);}
    finally{await view.page.setViewportSize(viewport);}
  }
  async function isolated(name,run,width){await test(name,async()=>{const view=await open(width);try{await run(view);}finally{await view.page.close();}});}

  await isolated('real packaged iframe sandbox, bridge surface, 3 families, default not confirmed; missing version not absence',async v=>{
    assert.equal(await v.page.locator('iframe').getAttribute('sandbox'),'allow-scripts');
    assert.equal(await v.frame.locator('.integration').count(),3);
    assert.equal(await v.frame.locator('#summary').textContent(),'3 integrations');
    assert.deepEqual(await v.frame.locator('body').evaluate(()=>Object.keys(codenomad.bundles).sort()),['attach','catalog','detach','hosts','installHost','onChanged','openDocs','request','setActive','state']);
    assert.deepEqual(await v.frame.locator('body').evaluate(()=>Object.keys(codenomad).sort()),['apiVersion','bundles','getContext','onContext']);
    const native=v.frame.locator(row('studio'));assert.match(await native.textContent(),/Version unknown/);
    assert.equal(await native.locator('.disclosure .badge-shape').last().textContent(),T.en.outdated);
    assert.equal(await action(v.frame,'studio','install').count(),0);
    assert.equal(await native.locator('.scope').filter({visible:true}).count(),1);
    assert.equal(await native.locator('.info-text').isHidden(),true,'help collapsed by default');
    assert.equal(await native.locator('.info-text').textContent(),[T.en.globalOnly,T.en.machine].join(''),'Global-only and machine help behind i');
    assert.doesNotMatch(await v.frame.locator(body('studio')).textContent(),/Global only|machine running/,'no inline helper prose');
    assert.equal(await native.locator('input').first().evaluate(node=>node.indeterminate&&!node.checked),true);
    assert.equal(await v.frame.locator('a,[onclick*=open],form').count(),0,'docs are non-navigating text');
    assert.match(await native.textContent(),/https:\/\/github.com\/NeuralNomadsAI\/opencode-integrations\//);
    assert.equal(await v.host(()=>H.topMessages),0,'requests use MessagePort, not window messages');
    await capture(v,'three-families-dark');
  });

  await test('MOCK backend policy: actual catalogue README, same-ID tree, strict input/result and raw canonical URL rejection',async()=>{
    validateFixture(realFixture());assert.equal(resolveDocs({integration:'blender'},realFixture().catalog).outcome,'requested');
    const f=realFixture();f.catalog.state='stale';assert.equal(resolveDocs({integration:'blender'},f.catalog).outcome,'requested');
    const valid=actualEntry.docs,base='https://github.com/NeuralNomadsAI/opencode-integrations/';
    for(const url of [base+'tree/main/integrations/blender',valid])assert.equal(isIntegrationDocsUrl(url,'blender'),true);
    for(const url of [valid+'?redirect=https://evil.invalid',valid+'#fragment',valid.replace('/blender/','/studio/'),
      valid.replace('github.com','github.com.evil.invalid'),valid.replace('https://','https://user@'),valid.replace('github.com/','github.com:443/'),
      valid.replace('/plugin/','/%70lugin/'),base+'tree/main/integrations/blender/../studio',base+'tree/main/integrations/blender/',
      base+'blob/main/integrations/blender',base+'tree/main/integrations/blender/plugin/README.md','javascript:alert(1)']){
      assert.equal(isIntegrationDocsUrl(url,'blender'),false,url);
      const f=realFixture();f.catalog.integrations[0].docs=url;
      assert.equal(resolveDocs({integration:'blender'},f.catalog).outcome,'unavailable');
    }
    for(const key of ['url','sessionID','rpc','path','scope','owner','mountID']){
      const input={integration:'blender',[key]:'forbidden'};
      assert.equal(resolveDocs(input,realFixture().catalog).outcome,'invalid');
      assert.equal(schemas.bundlesDocsInputSchema.safeParse({owner:'a'.repeat(32),mountID:'b'.repeat(32),integration:'blender',extra:'no'}).success,false);
    }
    assert.equal(resolveDocs({integration:'missing'},realFixture().catalog).outcome,'invalid');
    assert.equal(schemas.bundlesDocsResultSchema.safeParse({outcome:'requested',url:valid}).success,false);
  });

  await isolated('Documentation: actual catalogue README, collapsed keyboard action, ID-only request, no navigation or extra link',async v=>{
    await refresh(v,realFixture());const button=docs(v,'blender'),disclosure=v.frame.locator('#title-blender');
    await disclosure.click();assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
    await button.focus();await button.evaluate(node=>window.docsTrigger=node);
    const beforeURL=v.page.url(),frameURL=v.page.frames()[1].url(),requests=[],popups=[];
    v.page.on('request',request=>requests.push(request.url()));v.page.on('popup',page=>popups.push(page));
    await v.page.keyboard.press('Enter');await settle(v);
    assert.equal(await docsFeedback(v,'blender').textContent(),T.en.docsRequested);assert.equal(await docsFeedback(v,'blender').isVisible(),true);
    assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
    assert.equal(await button.evaluate(node=>node===window.docsTrigger&&node===document.activeElement),true);
    assert.deepEqual((await docsCalls(v)).map(({capability,method,input})=>({capability,method,input})),[{capability:'bundles',method:'openDocs',input:{integration:'blender'}}]);
    assert.equal(await v.host(()=>H.openIntents.length),1,'MOCK handoff intent only, not actual browser proof');
    assert.equal(v.page.url(),beforeURL);assert.equal(v.page.frames()[1].url(),frameURL);assert.deepEqual(requests,[]);assert.deepEqual(popups,[]);
    assert.equal(await v.frame.locator('a,form,dialog').count(),0);
    await disclosure.click();await settle(v);assert.equal(await v.frame.locator('.docs-address').textContent(),actualEntry.docs);
    assert.equal(await v.frame.locator('.docs-address').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);return getSelection().toString();}),actualEntry.docs);
    await v.host(()=>H.update({locale:'fr'}));await capture(v,'documentation-demandee-fr-test-preview');
    for(let i=0;i<5;i++)await v.host(()=>H.changed({kind:'state'}));await settle(v);
    await v.frame.locator('#refresh').click();await settle(v);await v.page.clock.fastForward(120_000);await settle(v);
    assert.equal((await docsCalls(v)).length,1,'events, Refresh, locale and idle time never reopen');assert.equal((await mutations(v)).length,0);
  });

  await isolated('Documentation: malicious catalogue text never navigates; stale works, unavailable is honest, all families ID-only',async v=>{
    const requests=[],popups=[],initial=v.page.url(),frameURL=v.page.frames()[1].url();v.page.on('request',request=>requests.push(request.url()));v.page.on('popup',page=>popups.push(page));
    for(const id of ['studio','vendor','service']){await clickDocs(v,id);assert.deepEqual((await docsCalls(v)).at(-1).input,{integration:id});}
    const urls=[actualEntry.docs+'?redirect=https://evil.invalid',actualEntry.docs+'#secret',actualEntry.docs.replace('/blender/','/studio/'),actualEntry.docs.replace('/plugin/','/%70lugin/')];
    for(const address of urls){const f=realFixture();f.catalog.integrations[0].docs=address;await refresh(v,f);await clickDocs(v,'blender');
      assert.equal(await docsFeedback(v,'blender').textContent(),T.en.docsUnavailable);assert.equal(await v.frame.locator('.docs-address').textContent(),address);}
    const stale=realFixture();stale.catalog.state=stale.state.catalog.state='stale';await refresh(v,stale);await clickDocs(v,'blender');assert.equal(await docsFeedback(v,'blender').textContent(),T.en.docsRequested);
    const unavailable=realFixture();unavailable.catalog.state=unavailable.state.catalog.state='unavailable';await refresh(v,unavailable);await clickDocs(v,'blender');assert.equal(await docsFeedback(v,'blender').textContent(),T.en.docsUnavailable);
    assert.equal(v.page.url(),initial);assert.equal(v.page.frames()[1].url(),frameURL);assert.deepEqual(requests,[]);assert.deepEqual(popups,[]);
    assert.equal(await v.frame.locator('a,form,dialog').count(),0);assert.equal((await mutations(v)).length,0);
  });

  await isolated('Documentation: fixed outcomes, transport failure, malformed responses, local duplicate fence and no management notice overwrite',async v=>{
    for(const [mode,key] of [[{outcome:'requested'},'docsRequested'],[{outcome:'unavailable'},'docsUnavailable'],[{outcome:'busy'},'docsBusy'],[{outcome:'invalid'},'docsInvalid'],['error','docsUnavailable'],['busy-error','docsBusy'],
      [null,'docsUnavailable'],[{},'docsUnavailable'],[{outcome:'constructor'},'docsUnavailable'],[{outcome:'confirming',requestID:'a'.repeat(32)},'docsUnavailable'],[{outcome:'requested',url:'private'},'docsUnavailable']]){
      await v.host(mode=>{H.docsMode=mode;},mode);const count=(await docsCalls(v)).length;
      await clickDocs(v);assert.equal(await docsFeedback(v).textContent(),T.en[key]);
      await v.page.clock.fastForward(60_000);await settle(v);assert.equal((await docsCalls(v)).length,count+1);assert.equal(await docs(v).getAttribute('aria-disabled'),'false');
      assert.doesNotMatch(await docsFeedback(v).textContent(),/private|constructor|confirming/);
    }
    await v.host(()=>{H.docsMode='auto';H.hold=['openDocs'];});await v.page.clock.fastForward(1001);await docs(v).click();await v.page.waitForFunction(()=>H.held.length===1);
    await docs(v).focus();await v.page.keyboard.press('Enter');await docs(v,'vendor').focus();await v.page.keyboard.press('Space');assert.equal(await v.host(()=>H.held.length),1,'one pending open across rows');
    await v.host(()=>H.release());await settle(v);const count=(await docsCalls(v)).length;
    await docs(v).click();await settle(v);assert.equal((await docsCalls(v)).length,count,'one-second local explicit-action throttle');
    await action(v.frame,'studio','installHost').click();await notice(v,'confirming');
    await clickDocs(v);assert.equal(await v.frame.locator('#notice').textContent(),T.en.confirming);assert.equal(await action(v.frame,'studio','installHost').getAttribute('aria-disabled'),'true');
    await v.host(()=>H.finish('cancelled'));await notice(v,'cancelled');
    assert.equal((await mutations(v)).length,1);
  });

  await isolated('Documentation: late conversation reply fenced; four-call admission and real bridge timeout safely settle without retry',async v=>{
    await v.host(()=>{H.hold=['openDocs'];});await docs(v).click();await v.page.waitForFunction(()=>H.held.length===1);
    await v.host(()=>H.update({sessionId:'ses_new_docs'}));await v.frame.locator('#title-studio').waitFor();
    await v.page.clock.fastForward(1001);await docs(v).click();await v.page.waitForFunction(()=>H.held.length===2);
    await v.host(()=>H.held.shift()());await v.host(()=>H.barrier());
    assert.equal(await docs(v).getAttribute('aria-disabled'),'true','old completion cannot unlock the newer pending action');
    assert.equal(await docsFeedback(v).isVisible(),false,'old outcome cannot mark new row');
    await v.host(()=>H.release());await settle(v);assert.equal(await docsFeedback(v).textContent(),T.en.docsRequested);
    await v.host(()=>{H.hold=['catalog'];});await v.frame.locator('body').evaluate(()=>{window.docsBatch=Promise.allSettled(Array.from({length:4},()=>codenomad.bundles.catalog()));});
    await v.page.waitForFunction(()=>H.held.length===4);const before=(await docsCalls(v)).length;
    await v.page.clock.fastForward(1001);await docs(v).click();await docsFeedback(v).filter({hasText:T.en.docsBusy}).waitFor();
    assert.equal((await docsCalls(v)).length,before,'real bridge refuses fifth without a host request');await v.host(()=>H.release());await settle(v);
    await v.host(()=>{H.hold=['openDocs'];});await v.page.clock.fastForward(1001);await docs(v).click();await v.page.waitForFunction(()=>H.held.length===1);
    await v.page.clock.fastForward(20_001);await docsFeedback(v).filter({hasText:T.en.docsUnavailable}).waitFor();
    const count=(await docsCalls(v)).length;await v.host(()=>H.release());await settle(v);assert.equal(await docsFeedback(v).textContent(),T.en.docsUnavailable,'late timed-out reply ignored');
    await v.page.clock.fastForward(60_000);await settle(v);assert.equal((await docsCalls(v)).length,count);
  });

  await isolated('Documentation: completion preserves moved focus; row removal and remount discard pending feedback without replay',async v=>{
    await v.host(()=>{H.hold=['openDocs'];});await docs(v).click();await v.page.waitForFunction(()=>H.held.length===1);
    await v.page.locator('body').evaluate(node=>{node.tabIndex=-1;node.focus();});
    await v.host(()=>H.release());await settle(v);
    assert.equal(await v.page.locator('body').evaluate(node=>node===document.activeElement),true,'completion never retakes host focus');
    await v.host(()=>{H.hold=['openDocs'];});await v.page.clock.fastForward(1001);await docs(v).click();await v.page.waitForFunction(()=>H.held.length===1);
    const f=fixture();f.catalog.integrations=f.catalog.integrations.filter(entry=>entry.id!=='studio');f.state.integrations=f.state.integrations.filter(entry=>entry.id!=='studio');validateFixture(f);
    await v.host(f=>{Object.assign(H,f);H.changed({kind:'state'});},f);await v.frame.locator('#title-studio').waitFor({state:'detached'});
    await v.host(()=>H.release());await settle(v);assert.equal(await v.frame.locator('.docs-status').filter({hasText:T.en.docsRequested}).count(),0);
    await refresh(v,fixture());await v.host(()=>{H.hold=['openDocs'];});await v.page.clock.fastForward(1001);await docs(v).click();await v.page.waitForFunction(()=>H.held.length===1);
    const count=(await docsCalls(v)).length;await v.host(()=>H.mount());await v.frame.locator('#notice').filter({hasText:T.en.updated}).waitFor();
    await v.host(()=>H.release());await settle(v);assert.equal(await docsFeedback(v).isVisible(),false);assert.equal((await docsCalls(v)).length,count,'remount never replays pending intent');
  });

  await test('Documentation: real immutable older bridge without openDocs retains text and management, no fabricated success',async()=>{
    const v=await open(420,1000,true);try{
      assert.equal(await v.frame.locator('body').evaluate(()=>typeof codenomad.bundles.openDocs),'undefined');
      await docs(v).click();assert.equal(await docsFeedback(v).textContent(),T.en.docsUnavailable);assert.equal((await docsCalls(v)).length,0);
      assert.match(await v.frame.locator(`${row('studio')} .docs-address`).textContent(),/tree\/main\/integrations\/studio$/);
      assert.equal(await v.frame.locator('a').count(),0);await action(v.frame,'studio','installHost').click();await notice(v,'confirming');
      await v.host(()=>H.finish('cancelled'));await notice(v,'cancelled');
    }finally{await v.page.close();}
  });

  await isolated('runtime unknown/absent/inactive/failed/unsupported/non-conforming, stale/unavailable catalog and host states',async v=>{
    for(const state of ['unknown','absent','inactive','failed','unsupported','non-conforming']){
      const f=fixture(),native=f.state.integrations[0];native.state=state;delete native.version;delete native.status;
      if(state==='absent'){native.configured=false;native.scopes=[];native.plugin={declared:false,runtime:'unloaded'};}
      if(state==='inactive')native.plugin={declared:true,runtime:'unloaded'};
      if(state==='failed')native.plugin={declared:true,runtime:'failed'};
      await refresh(v,f);
      assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T.en[state]);
      assert.equal(await v.frame.locator('#title-studio .muted').textContent(),state==='absent'?T.en.notInstalled:T.en.versionUnknown);
    }
    for(const host of ['unknown','absent','outdated','incompatible','unsupported','ok']){
      const f=fixture();f.state.integrations[0].status.host={state:host,expectedRange:'^1.0.0'};
      if(host==='absent')f.state.integrations[0].status.host.action='install';
      if(host==='outdated')Object.assign(f.state.integrations[0].status.host,{partVersion:'0.9.0',action:'update'});
      await refresh(v,f);
      assert.equal(await action(v.frame,'studio','installHost').count(),['absent','outdated'].includes(host)?1:0,host+' install guard');
      const info=await v.frame.locator(`${row('studio')} .info-text`).textContent();
      assert.equal(info.includes(T.en.openApp.replace('{app}','studio')),host==='unknown',host+' open-app help only behind i');
      assert.doesNotMatch(await v.frame.locator(body('studio')).textContent(),/Open studio and enable/);
    }
    const stale=fixture();stale.catalog.state=stale.state.catalog.state='stale';await refresh(v,stale);
    assert.match(await v.frame.locator('#catalog').textContent(),/Catalogue unavailable · last valid catalogue/);
    await capture(v,'stale');
    const unavailable=fixture();unavailable.catalog.state=unavailable.state.catalog.state='unavailable';await refresh(v,unavailable);
    assert.equal(await v.frame.locator('#catalog').textContent(),T.en.unavailable);
    for(const control of await v.frame.locator('[data-manage]').all())assert.equal(await control.isDisabled(),true);
    await capture(v,'unavailable');
  });

  await isolated('separate declaration, native loading, activation and RPC facts; ID-less failure, missing version and older hosts',async v=>{
    const badges={pending:'pending',unconfirmed:'unconfirmed',unloaded:'inactive',absent:'absent','active-no-version':'outdated','undeclared-active':'outdated','failed-no-id':'failed',disabled:'disabled',ambiguous:'unknown','older-host':'unknown'};
    for(const kind of installationStates){
      const f=installationFixture(kind),native=f.state.integrations[0];await refresh(v,f);
      assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T.en[badges[kind]],kind);
      assert.equal(await field(v,'declaration'),T.en[native.plugin?(native.plugin.declared?'declared':'notDeclared'):'unknown']);
      assert.equal(await field(v,'runtime'),T.en[native.plugin?.runtime==='active'?'loaded':native.plugin?.runtime??'unknown']);
      assert.equal(await field(v,'rpcStatus'),T.en[native.state]);
      assert.equal(await v.frame.locator('#title-studio .muted').textContent(),kind==='absent'?T.en.notInstalled:T.en.versionUnknown);
      assert.equal(await action(v.frame,'studio','install').count(),kind==='absent'?1:0,'no duplicate or inferred install');
      assert.equal(await action(v.frame,'studio','installHost').count(),['active-no-version','undeclared-active'].includes(kind)?1:0);
      assert.equal(await v.frame.locator(body('studio')).getByText(T.en.unconfirmedHelp).count(),0,'no inline troubleshooting prose');
      assert.equal((await v.frame.locator(`${row('studio')} .info-text`).textContent()).includes(T.en.unconfirmedHelp),kind==='unconfirmed');
      assert.match(await v.frame.locator(body('studio')).textContent(),/This conversation: Unknown/,'unknown attachment never becomes none');
    }
    // The strict schema bounds shape; defensive display also ignores progress
    // when its parent facts do not authorize that interpretation.
    for(const kind of ['disabled','ambiguous','absent','active-no-version']){
      const f=installationFixture(kind);f.state.integrations[0].plugin.progress='pending';await refresh(v,f);
      assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T.en[badges[kind]]);
    }
    const old=fixture();delete old.state.integrations[0].plugin;await refresh(v,old);
    assert.equal(await field(v,'runtime'),T.en.unknown);assert.equal(await action(v.frame,'studio','installHost').count(),0);
    const disabled=fixture();disabled.state.integrations[0].activation.effective='disabled';
    disabled.state.integrations[0].status.host={state:'absent',action:'install'};await refresh(v,disabled);
    assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T.en.disabled,'effective disable overrides default rules and stale host status');
    assert.equal(await action(v.frame,'studio','installHost').count(),0);
    assert.equal((await mutations(v)).length,0);
  });

  await isolated('parent-only pending boundaries, late confirmed receipt, response order, runtime loss and reload never invent loading',async v=>{
    await refresh(v,installationFixture('absent'));
    await action(v.frame,'studio','install').click();await notice(v,'confirming');
    const pending=installationFixture('pending');await refresh(v,pending);
    const calls=await v.host(()=>H.calls.length);
    for(const ms of [119_999,1,1]){
      await v.page.clock.fastForward(ms);await settle(v);
      assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T.en.pending);
      assert.equal(await v.host(()=>H.calls.length),calls,'no iframe expiry/read clock');
    }
    await refresh(v,installationFixture('unconfirmed'));
    await confirmed(v);
    assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T.en.unconfirmed,'late receipt is submitted, not loaded/pending');
    const trigger=v.frame.locator('#body-studio input').first();await trigger.focus();await trigger.evaluate(node=>window.savedTrigger=node);
    await v.host(()=>{H.hold=['catalog'];H.changed({kind:'state'});});await v.page.waitForFunction(()=>H.held.length===1);
    const active=installationFixture('active-no-version');validateFixture(active);
    await v.host(value=>{Object.assign(H,value);H.changed({kind:'state'});},active);
    await v.host(()=>H.release());await settle(v);
    assert.equal(await field(v,'runtime'),T.en.loaded,'trailing authoritative read wins after reverse response order');
    assert.equal(await trigger.evaluate(node=>node===window.savedTrigger&&node===document.activeElement),true);
    const gone=installationFixture('unconfirmed');await refresh(v,gone);
    assert.equal(await field(v,'runtime'),T.en.unloaded);assert.equal(await action(v.frame,'studio','installHost').count(),0);
    assert.equal(await v.frame.locator('#title-studio').getAttribute('aria-expanded'),'true');
    await v.host(()=>H.mount());await v.frame.locator('#notice').filter({hasText:T.en.updated}).waitFor();await settle(v);
    assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T.en.unconfirmed,'supplied reload state, no local hint revival');
    assert.equal((await mutations(v)).length,1);
    await v.host(()=>H.update({locale:'fr'}));await capture(v,'installation-non-confirmee-fr-test-preview');
    await refresh(v,installationFixture('pending'));await capture(v,'installation-en-cours-fr-test-preview');
  });

  await isolated('foreign-only binding projection is none with offers; unknown attachment disables attach; attached shows inert badge only',async v=>{
    await expand(v,'studio');
    assert.match(await v.frame.locator(body('studio')).textContent(),/This conversation: Not attached/);
    const attach=action(v.frame,'studio','attach');assert.equal(await attach.count(),2);
    assert.equal(await attach.nth(0).isDisabled(),false);assert.equal(await attach.nth(1).isDisabled(),true);
    const badge=v.frame.locator(`${body('studio')} [data-state=attached]`);
    for(const state of ['unknown','attached','none']){
      const f=fixture();f.state.integrations[0].attachment=state==='attached'?{state,label:'This fixture scene'}:{state};await refresh(v,f);
      assert.equal(await action(v.frame,'studio','attach').count(),state==='attached'?0:2,'Attach replaced while attached');
      if(state!=='attached')assert.equal(await action(v.frame,'studio','attach').first().isDisabled(),state!=='none');
      assert.equal(await v.frame.locator('[data-action=detach]').count(),0);
      assert.equal(await badge.isVisible(),state==='attached');
    }
    const f=fixture();f.state.integrations[0].attachment={state:'attached',label:'This fixture scene'};await refresh(v,f);
    assert.equal(await v.frame.locator(`${body('studio')} .group`).last().locator('p').first().textContent(),'This conversation: Attached · This fixture scene');
    assert.deepEqual(await badge.evaluate(node=>({tag:node.tagName,role:node.getAttribute('role'),tab:node.tabIndex,click:typeof node.onclick==='function',focusable:node.matches('button,a,input,select,[tabindex]'),interactive:node.querySelector('button,a,input,[tabindex]')!==null})),
      {tag:'SPAN',role:null,tab:-1,click:false,focusable:false,interactive:false},'inert label, not a control');
    const calls=await v.host(()=>H.calls.length);
    for(let i=0;i<2;i++){await badge.click();await badge.dblclick();await badge.evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));}
    await settle(v);assert.equal(await v.host(()=>H.calls.length),calls,'badge clicks and keys send nothing');
    assert.equal(await v.host(()=>H.calls.filter(call=>call.method==='detach').length),0);assert.equal((await mutations(v)).length,0);
    await v.frame.locator('#title-studio').focus();for(let i=0;i<40;i++){await v.page.keyboard.press('Tab');assert.equal(await badge.evaluate(node=>node===document.activeElement),false,'badge never in tab order');}
    await v.host(()=>{H.hostsError=true;});await refresh(v,fixture());
    assert.equal(await action(v.frame,'studio','attach').first().isDisabled(),true);
    assert.match(await v.frame.locator(body('studio')).textContent(),new RegExp(T.en.offersUnknown.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  });

  await isolated('section i button: named, click/Enter/Space toggle, Escape closes with focus return, 10 locales, no inline help',async v=>{
    const info=v.frame.locator(`${row('studio')} [data-action=info]`),text=v.frame.locator(`${row('studio')} .info-text`);
    assert.equal(await info.getAttribute('aria-label'),T.en.info+' · OpenCode for Studio');
    assert.equal(await info.getAttribute('aria-controls'),'info-studio');assert.equal(await info.getAttribute('aria-expanded'),'false');assert.equal(await text.isHidden(),true);
    await info.click();assert.equal(await info.getAttribute('aria-expanded'),'true');assert.equal(await text.isVisible(),true);
    await info.click();assert.equal(await text.isHidden(),true);
    await info.focus();await v.page.keyboard.press('Enter');assert.equal(await text.isVisible(),true);
    await v.page.keyboard.press('Escape');assert.equal(await text.isHidden(),true);assert.equal(await isFocused(info),true,'Escape returns focus');
    await v.page.keyboard.press('Space');assert.equal(await text.isVisible(),true);await v.page.keyboard.press('Space');assert.equal(await text.isHidden(),true);
    await v.page.keyboard.press('Enter');await refresh(v);assert.equal(await text.isVisible(),true,'open state survives a read refresh');assert.equal(await isFocused(info),true);
    for(const locale of LOCALES){
      await v.host(locale=>H.update({locale}),locale);await v.frame.locator('#heading').filter({hasText:T[locale].heading}).waitFor();
      assert.equal(await info.getAttribute('aria-label'),T[locale].info+' · OpenCode for Studio');
      assert.equal(await text.textContent(),T[locale].globalOnly+T[locale].machine,locale);
      assert.equal(await v.frame.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true,locale+' no overflow');
    }
    await v.host(()=>H.update({locale:'en'}));
    const unconfirmed=installationFixture('unconfirmed');await refresh(v,unconfirmed);
    assert.equal((await text.textContent()).startsWith(T.en.unconfirmedHelp),true);
    for(const id of ['vendor','service'])assert.equal(await v.frame.locator(`${row(id)} [data-action=info]`).isHidden(),true,id+' has no help, no i button');
    const empty=fixture();empty.hosts={offers:[]};await expand(v,'studio');await refresh(v,empty);
    assert.equal(await v.frame.locator(`${body('studio')} .offers`).locator('..').getByText(T.en.noOffers,{exact:true}).isVisible(),true,'no-offer state stays a visible label');
    assert.equal((await text.textContent()).endsWith(T.en.openApp.replace('{app}','studio')),true,'open-app help behind i without offers');
    const vendor=fixture(),entry=vendor.state.integrations[1];Object.assign(entry,{state:'inactive',activation:{global:'enabled',project:'default',effective:'enabled'},plugin:{declared:true,runtime:'unloaded',progress:'unconfirmed'}});
    await refresh(v,vendor);const vendorInfo=v.frame.locator(`${row('vendor')} [data-action=info]`);
    await vendorInfo.focus();await v.page.keyboard.press('Enter');assert.equal(await v.frame.locator('#info-vendor').textContent(),T.en.unconfirmedHelp);
    await refresh(v,fixture());assert.equal(await vendorInfo.isHidden(),true);assert.equal(await v.frame.locator('#info-vendor').isHidden(),true);
    assert.equal(await isFocused(v.frame.locator('#title-vendor')),true,'focus leaves a vanished i button for its disclosure');
    assert.equal((await mutations(v)).length,0,'help is read-only');
  });

  await isolated('keyboard disclosure, labelled regions/live status and stable disclosure/focus on read refresh',async v=>{
    const disclosure=v.frame.locator('#title-studio');
    await disclosure.focus();await v.page.keyboard.press('Enter');
    assert.equal(await disclosure.getAttribute('aria-expanded'),'false');assert.equal(await v.frame.locator(body('studio')).isHidden(),true);
    await v.page.keyboard.press('Space');await settle(v);
    assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
    assert.equal(await disclosure.getAttribute('aria-controls'),'body-studio');
    assert.equal(await v.frame.locator(body('studio')).getAttribute('role'),'region');
    assert.equal(await v.frame.locator(body('studio')).getAttribute('aria-labelledby'),'title-studio');
    assert.equal(await v.frame.locator('#notice').getAttribute('aria-live'),'polite');
    await v.page.keyboard.press('Tab');
    assert.equal(await v.frame.locator('body').evaluate(()=>document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle),'solid');
    const trigger=action(v.frame,'studio','installHost');await trigger.focus();
    await trigger.evaluate(node=>window.savedTrigger=node);
    await refresh(v);
    assert.equal(await trigger.evaluate(node=>node===window.savedTrigger&&node===document.activeElement),true);
    assert.equal(await disclosure.getAttribute('aria-expanded'),'true');
    await disclosure.click();await refresh(v);assert.equal(await disclosure.getAttribute('aria-expanded'),'false');
  });

  await isolated('all fixed author management methods validate inputs; no early success, native Global only; no replay on completion/events',async v=>{
    await expand(v,'service');await expand(v,'vendor');
    const cases=[['service','install','request',{action:'install',integration:'service',scope:'global'}],
      ['vendor','update','request',{action:'update',integration:'vendor',scope:'global'}],
      ['vendor','remove','request',{action:'remove',integration:'vendor',scope:'global'}],
      ['studio','installHost','installHost',{integration:'studio'}],
      ['studio','attach','attach',{integration:'studio',offerID:'offer_good_001'}]];
    for(const [id,key,method,input] of cases){
      const before=(await mutations(v)).length;await action(v.frame,id,key).first().click();await notice(v,'confirming');
      assert.equal((await mutations(v)).length,before+1);assert.deepEqual((await mutations(v)).at(-1).input,input);assert.equal((await mutations(v)).at(-1).method,method);
      assert.equal(await v.frame.locator('#summary').textContent(),'3 integrations');
      assert.doesNotMatch(await v.frame.locator('#notice').textContent(),/installed|attached|activated/i);
      await confirmed(v);
      assert.equal((await mutations(v)).length,before+1);assert.equal(await v.frame.locator('#summary').textContent(),'3 integrations');
    }
    const check=v.frame.locator('#body-studio input').first();await check.click();await notice(v,'confirming');
    const call=(await mutations(v)).at(-1);assert.equal(call.method,'setActive');assert.deepEqual(call.input,{integration:'studio',scope:'global',enabled:true});
    assert.equal(await check.evaluate(node=>node.indeterminate&&!node.checked),true,'no optimistic activation');
    await v.host(()=>H.finish('cancelled'));await notice(v,'cancelled');await settle(v);
    const before=(await mutations(v)).length;
    for(let i=0;i<5;i++)await v.host(()=>H.changed({kind:'state'}));await settle(v);
    assert.equal((await mutations(v)).length,before);
    assert((await mutations(v)).filter(call=>call.input.integration==='studio'&&call.input.scope).every(call=>call.input.scope==='global'));
    assert.equal(await v.host(()=>H.errors.length),0);
    const enabled=fixture();enabled.state.integrations[0].activation={global:'enabled',project:'default',effective:'enabled'};
    await refresh(v,enabled);assert.match(await v.frame.locator(body('studio')).textContent(),/Effective activationEnabled/,'only authoritative read changes activation');
  });

  for(const outcome of ['cancelled','confirmed','expired','failed'])await isolated(`exact same iframe button focus after simulated ${outcome}`,async v=>{
    const trigger=action(v.frame,'studio','installHost');await trigger.evaluate(node=>window.savedTrigger=node);
    await trigger.click();await notice(v,'confirming');
    // Move focus to the simulated host (the actual native confirmation UI is out of scope).
    await v.page.locator('body').evaluate(node=>{node.tabIndex=-1;node.focus();});
    if(outcome==='confirmed')await confirmed(v);else {await v.host(outcome=>H.finish(outcome),outcome);await notice(v,outcome==='failed'?'requestFailed':outcome);await settle(v);}
    assert.equal(await trigger.evaluate(node=>node===window.savedTrigger&&node===document.activeElement),true,'same DOM element, not a substitute button');
    assert.equal((await mutations(v)).length,1);
  });

  await isolated('install defaults to Global; explicit Project selection and scoped management remain fixed',async v=>{
    await expand(v,'service');
    const scope=v.frame.locator('#scope-service');assert.equal(await scope.inputValue(),'global');
    await scope.selectOption('project');await action(v.frame,'service','install').click();await notice(v,'confirming');
    assert.deepEqual((await mutations(v)).at(-1).input,{action:'install',integration:'service',scope:'project'});
    await v.host(()=>H.finish('cancelled'));await notice(v,'cancelled');
    const f=fixture();f.state.integrations[1].scopes=['project'];await refresh(v,f);await expand(v,'vendor');
    await action(v.frame,'vendor','remove').click();await notice(v,'confirming');
    assert.deepEqual((await mutations(v)).at(-1).input,{action:'remove',integration:'vendor',scope:'project'});
  });

  await isolated('hidden trigger falls back to disclosure; disappeared integration falls back to Refresh',async v=>{
    await action(v.frame,'studio','installHost').click();await notice(v,'confirming');
    await v.frame.locator('#title-studio').click();
    await v.host(()=>H.finish('cancelled'));await notice(v,'cancelled');
    await v.page.waitForTimeout(70);assert.equal(await isFocused(v.frame.locator('#title-studio')),true);
    await expand(v,'studio');await action(v.frame,'studio','installHost').click();await notice(v,'confirming');
    const f=fixture();f.catalog.integrations=f.catalog.integrations.filter(entry=>entry.id!=='studio');f.state.integrations=f.state.integrations.filter(entry=>entry.id!=='studio');
    await refresh(v,f);await v.host(()=>H.finish('expired'));await notice(v,'expired');
    await v.page.waitForTimeout(70);assert.equal(await isFocused(v.frame.locator('#refresh')),true);
  });

  await isolated('delayed state reconciliation preserves visible focus when the restored action becomes hidden',async v=>{
    const trigger=action(v.frame,'studio','installHost');await trigger.click();await notice(v,'confirming');
    const f=fixture();f.state.integrations[0].status.host={state:'ok',partVersion:'1.0.0',expectedRange:'^1.0.0'};
    validateFixture(f);
    await v.host(f=>{Object.assign(H,f);H.hold=['catalog','state'];H.finish('confirmed');},f);await notice(v,'confirmed');
    await v.page.waitForFunction(()=>H.held.length===2);await v.page.waitForTimeout(100);
    assert.equal(await isFocused(trigger),true,'native-frame focus restored before delayed state');
    await v.host(()=>H.release());await settle(v);await notice(v,'updated');
    assert.equal(await trigger.count(),0);assert.equal(await isFocused(v.frame.locator('#title-studio')),true);
    assert.equal((await mutations(v)).length,1);
  });

  await isolated('retained unavailable offers translate; successful offer refresh keeps its exact focused button',async v=>{
    const attach=action(v.frame,'studio','attach').first();await attach.focus();
    await attach.evaluate(node=>window.savedTrigger=node);await refresh(v);
    assert.equal(await attach.evaluate(node=>node===window.savedTrigger&&node===document.activeElement),true);
    await v.host(()=>{H.hostsError=true;});await refresh(v);
    assert.equal(await isFocused(v.frame.locator('#title-studio')),true,'disabled focused offer falls back');
    await v.host(()=>H.update({locale:'fr'}));
    assert.equal(await attach.textContent(),T.fr.attach);assert.equal(await attach.isDisabled(),true);
    assert.match(await v.frame.locator('.offer .muted').first().textContent(),new RegExp(T.fr.protocol));
    assert.equal(await v.frame.locator('#notice').textContent(),T.fr.updated);
  });

  await isolated('state changes do not steal focus from the simulated host while confirmation is open',async v=>{
    await action(v.frame,'studio','installHost').click();await notice(v,'confirming');
    await v.page.locator('body').evaluate(node=>{node.tabIndex=-1;node.focus();});
    const f=fixture();f.state.integrations[0].status.host={state:'ok'};await refresh(v,f);
    assert.equal(await v.page.locator('body').evaluate(node=>node===document.activeElement),true);
    await confirmed(v);await v.page.waitForTimeout(70);
    assert.equal(await isFocused(v.frame.locator('#title-studio')),true);
  });

  await isolated('busy/invalid/transport error give explicit outcome and no automatic mutation retry',async v=>{
    for(const [mode,key] of [['busy','busy'],['invalid','invalid'],['error','requestFailed'],['busy-error','requestFailed']]){
      await v.host(mode=>{H.mode=mode;},mode);const before=(await mutations(v)).length;
      await action(v.frame,'studio','installHost').click();await notice(v,key);await settle(v);await v.page.clock.fastForward(60_000);await settle(v);
      assert.equal((await mutations(v)).length,before+1);assert.equal(await action(v.frame,'studio','installHost').getAttribute('aria-disabled'),'false');
      assert.equal(await v.frame.locator('#notice').textContent(),T.en[key],'outcome stays until an explicit reread');
      if(['requestFailed','invalid'].includes(key)){await v.frame.locator('#refresh').click();await settle(v);await notice(v,'updated');assert.equal((await mutations(v)).length,before+1,'Refresh rereads only');}
    }
  });

  await isolated('events only reread; duplicate/invalid outcomes do not unlock/replay; no idle polling',async v=>{
    await action(v.frame,'studio','installHost').click();await notice(v,'confirming');const before=(await mutations(v)).length;
    await v.host(()=>{H.changed({kind:'request',requestID:'not_our_request',outcome:'confirmed'});H.changed({kind:'state',extra:true});});await settle(v);
    assert.equal(await action(v.frame,'studio','installHost').getAttribute('aria-disabled'),'true');
    await v.host(()=>H.finish('expired'));await notice(v,'expired');await settle(v);
    await v.host(()=>{H.changed({kind:'request',requestID:'1'.padStart(32,'0'),outcome:'expired'});H.changed({kind:'state'});});await settle(v);
    assert.equal((await mutations(v)).length,before);
    const calls=await v.host(()=>H.calls.length);await v.page.clock.fastForward(120_000);await settle(v);assert.equal(await v.host(()=>H.calls.length),calls,'two virtual minutes without polling');
    assert.doesNotMatch(pkg.html,/setInterval\s*\(/,'no author polling loop');
    assert((await v.host(()=>H.maxInFlight))<=4);
  });

  await isolated('real bridge refuses a fifth simultaneous request as busy',async v=>{
    const before=await v.host(()=>H.count('catalog'));
    await v.host(()=>{H.hold=['catalog'];});
    await v.frame.locator('body').evaluate(()=>{window.batch=Promise.allSettled(Array.from({length:5},()=>codenomad.bundles.catalog()));});
    await v.page.waitForFunction(()=>H.held.length===4);
    assert.equal(await v.host(()=>H.count('catalog')),before+4);
    await v.host(()=>H.release());
    const batch=await v.frame.locator('body').evaluate(async()=>{const values=await window.batch;return values.map(value=>value.status==='fulfilled'?'fulfilled':value.reason.message);});
    assert.deepEqual(batch,['fulfilled','fulfilled','fulfilled','fulfilled','busy']);assert.equal(await v.host(()=>H.maxInFlight),4);
  });

  await isolated('context stale response fence, request cleanup and rapid remount cleanup bounded to four requests',async v=>{
    await v.host(()=>{H.hold=['catalog','state'];H.changed({kind:'state'});});
    await v.page.waitForFunction(()=>H.held.length===2);
    await v.host(()=>H.update({sessionId:null}));await notice(v,'noSession');
    await v.host(()=>H.release());await settle(v);assert.equal(await v.frame.locator('.integration').count(),0,'late old read discarded');
    await v.host(()=>H.update({sessionId:'ses_new'}));await settle(v);await v.frame.locator('#title-studio').waitFor();
    await action(v.frame,'studio','installHost').click();await notice(v,'confirming');
    await v.host(()=>H.update({sessionId:'ses_next'}));await settle(v);
    await v.host(()=>H.finish('failed'));await settle(v);assert.notEqual(await v.frame.locator('#notice').textContent(),T.en.requestFailed,'old management outcome cleared');
    for(let i=0;i<4;i++)await v.host(()=>H.mount());
    await v.frame.locator('#notice').filter({hasText:T.en.updated}).waitFor();await settle(v);
    assert.equal(await v.frame.locator('.integration').count(),3);assert((await v.host(()=>H.maxInFlight))<=4);assert.equal(await v.host(()=>H.closed),4);
    assert.equal((await mutations(v)).length,1,'no old request replay after context or mount');
  });

  await isolated('read failure clears unsafe actions, manual Refresh recovers without mutation replay',async v=>{
    await v.host(()=>{H.readError=true;});await refresh(v);await notice(v,'readFailed');
    assert.equal(await action(v.frame,'studio','installHost').count(),0);
    await v.host(()=>{H.readError=false;});await v.frame.locator('#refresh').click();await notice(v,'updated');await settle(v);
    assert.equal(await action(v.frame,'studio','installHost').count(),1);assert.equal((await mutations(v)).length,0);
  });

  await isolated('late hosts and management responses cannot resurrect a previous conversation or its pending request',async v=>{
    await v.host(()=>{H.hold=['hosts'];H.changed({kind:'state'});});
    await v.page.waitForFunction(()=>H.held.length===1);
    await v.host(()=>H.update({sessionId:null}));await notice(v,'noSession');
    await v.host(()=>H.release());await settle(v);assert.equal(await v.frame.locator('.integration').count(),0);
    await v.host(()=>H.update({sessionId:'ses_hosts_new'}));await settle(v);await v.frame.locator('#title-studio').waitFor();
    await v.host(()=>{H.hold=['installHost'];});await action(v.frame,'studio','installHost').click();
    await v.page.waitForFunction(()=>H.held.length===1);
    await v.host(()=>H.update({sessionId:null}));await notice(v,'noSession');
    await v.host(()=>H.release());await settle(v);
    assert.equal(await v.frame.locator('#notice').textContent(),T.en.noSession,'late confirming response ignored');
    await v.host(()=>H.update({sessionId:'ses_management_new'}));await settle(v);
    await v.host(()=>H.finish('failed'));await settle(v);
    assert.notEqual(await v.frame.locator('#notice').textContent(),T.en.requestFailed);
    assert.equal(await action(v.frame,'studio','installHost').getAttribute('aria-disabled'),'false');
    assert.equal((await mutations(v)).length,1);
  });

  await isolated('10 rendered locales, Hebrew RTL, narrow 320px, palette tokens and square chrome/chip-only radii',async v=>{
    for(const id of ['studio','vendor','service'])await expand(v,id);
    for(const locale of ['en','fr-FR','de','es','he','ja','ne','ru','tr','zh-Hans']){
      await v.host(locale=>H.update({locale}),locale);
      const base=locale.split('-')[0];await v.frame.locator('#heading').filter({hasText:T[base].heading}).waitFor();
      assert.equal(await v.frame.locator('html').getAttribute('dir'),base==='he'?'rtl':'ltr');
      assert.equal(await v.frame.locator('#refresh').getAttribute('aria-label'),T[base].refresh);
      assert.equal(await docs(v).getAttribute('aria-label'),T[base].docs+' · OpenCode for Studio');
      for(const [outcome,key] of [['requested','docsRequested'],['unavailable','docsUnavailable'],['busy','docsBusy'],['invalid','docsInvalid'],['error','docsUnavailable']]){
        await v.host(outcome=>{H.docsMode=outcome==='error'?'error':{outcome};},outcome);await clickDocs(v);
        assert.equal(await docsFeedback(v).textContent(),T[base][key]);
        assert.equal(await v.frame.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true,locale+'/'+outcome+' no overflow');
      }
      assert.equal(await v.frame.locator(`${row('studio')} .docs-address`).getAttribute('dir'),'ltr');
      assert.equal(await v.frame.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true,locale+' no overflow');
      for(const kind of installationStates){
        await refresh(v,installationFixture(kind));
        const key={pending:'pending',unconfirmed:'unconfirmed',unloaded:'inactive',absent:'absent','active-no-version':'outdated','undeclared-active':'outdated','failed-no-id':'failed',disabled:'disabled',ambiguous:'unknown','older-host':'unknown'}[kind];
        assert.equal(await v.frame.locator('#title-studio .badge-shape').last().textContent(),T[base][key],locale+'/'+kind);
        assert.equal(await v.frame.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true,locale+'/'+kind+' no overflow');
      }
      await refresh(v,installationFixture('unconfirmed'));
      if(base==='he')await capture(v,'narrow-hebrew-rtl');
    }
    await refresh(v,fixture());
    for(const appearance of ['dark','light']){
      await v.host(({appearance,colors})=>H.update({appearance,colors,locale:'en'}),{appearance,colors:palettes[appearance]});
      const styles=await v.frame.locator('body').evaluate(node=>({bg:getComputedStyle(node).backgroundColor,radii:[...document.querySelectorAll('*')].filter(node=>{const s=getComputedStyle(node);return ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].some(key=>s[key]!=='0px');}).map(node=>({class:node.className,tag:node.tagName}))}));
      assert.equal(styles.bg,appearance==='dark'?'rgb(29, 36, 48)':'rgb(247, 248, 250)');assert(styles.radii.length>0);assert(styles.radii.every(node=>node.class==='badge-shape'));
      // Axe flags the icon-only glyph as incomplete. Its actual foreground and
      // background still have a measurable text/non-text contrast ratio.
      for(const glyph of ['#refresh',`${row('studio')} [data-action=info]`]){
        const contrast=await v.frame.locator(glyph).evaluate(node=>{
          const luminance=color=>{const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
          const style=getComputedStyle(node),a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        });
        assert(contrast>=4.5,`${appearance} ${glyph} glyph AA contrast: ${contrast}`);
      }
      await capture(v,'narrow-'+appearance);
    }
  },320);

  // Read the real axe file into the opaque-origin sandbox: addScriptTag({path})
  // would use a different injection route; evaluate audits this actual iframe DOM.
  if(process.env.AXE_CORE_PATH){
    const axeSource=await readFile(process.env.AXE_CORE_PATH,'utf8');
    assert.equal(createHash('sha256').update(axeSource).digest('hex'),axePin.sha256,'pinned test-only axe.min.js integrity');
    for(const appearance of ['dark','light'])await isolated(`axe actual iframe ${appearance}: expanded normal, attached, host states, unknown/failed/non-conforming, stale and unavailable`,async v=>{
      for(const id of ['studio','vendor','service'])await expand(v,id);
      await v.host(({appearance,colors})=>H.update({appearance,colors}),{appearance,colors:palettes[appearance]});
      await v.frame.locator('body').evaluate((_,source)=>(0,eval)(source),axeSource);
      for(const scenario of ['normal','attached','host-unknown','host-absent','host-incompatible','unknown-failed','non-conforming','stale','unavailable',...installationStates,'docs-requested','docs-unavailable','docs-busy','docs-invalid','docs-error','info-open']){
        const f=installationStates.includes(scenario)?installationFixture(scenario):fixture();
        if(scenario==='attached')f.state.integrations[0].attachment={state:'attached',label:'This fixture scene'};
        if(scenario.startsWith('host-'))f.state.integrations[0].status.host={state:scenario.slice(5),...(scenario==='host-absent'?{action:'install'}:{})};
        if(scenario==='unknown-failed'){f.state.integrations[0].attachment={state:'unknown'};f.state.integrations[1].state='failed';}
        if(scenario==='non-conforming')f.state.integrations[0].state='non-conforming';
        if(['stale','unavailable'].includes(scenario))f.catalog.state=f.state.catalog.state=scenario;
        await refresh(v,f);
        if(scenario.startsWith('docs-')){await v.host(outcome=>{H.docsMode=outcome==='error'?'error':{outcome};},scenario.slice(5));await clickDocs(v);}
        if(scenario==='info-open'){const info=v.frame.locator(`${row('studio')} [data-action=info]`);if(await info.getAttribute('aria-expanded')!=='true')await info.click();assert.equal(await v.frame.locator('#info-studio').isVisible(),true);}
        const audit=await v.frame.locator('body').evaluate(async()=>{const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}});const nodes=values=>values.map(({target,failureSummary,html})=>({target,failureSummary,html}));return {version:axe.version,violations:result.violations.map(({id,impact,nodes:items})=>({id,impact,nodes:nodes(items)})),incomplete:result.incomplete.map(({id,nodes:items})=>({id,nodes:nodes(items)})),passes:result.passes.length};});
        assert.equal(audit.version,axePin.version);
        audits.push({appearance,scenario,...audit});await capture(v,`axe-${appearance}-${scenario}`);
      }
      const violations=audits.filter(audit=>audit.appearance===appearance).flatMap(audit=>audit.violations.map(violation=>`${audit.scenario}/${violation.id}`));
      assert.equal(violations.length,0,`${appearance} axe violations: ${violations.join(', ')} (see audit JSON)`);
    });
  }else console.log('GAP: AXE_CORE_PATH absent; no automated accessibility audit claimed. Keyboard/ARIA checks are not an axe audit.');

  await test('no browser/CSP/schema-wire errors',async()=>assert.deepEqual(errors,[]));
  const evidence={scope:'MOCK MessagePort host, real ZIP-extracted HTML/validator/frame-document. Not actual ExtensionPanel, trusted host confirmation, external opener or native backend.',pin:PIN,sourceHashes,catalogue:{commit:'54d6e5d0f4c22e74d228822fcaaa0912818a8b46',blob:catalogBlob},packageDigest:pkg.digest,
    passed:results.length,failed:failures.length,failures,audits,captures,gaps:[...(!process.env.AXE_CORE_PATH?['axe audit absent']:[]),...(!captures.length?['screenshots not requested (CODENOMAD_PANEL_CAPTURE_DIR absent)']:[]),
      'Native confirmation/backend/ExtensionPanel integration outside simulated-host scope',...(audits.some(audit=>audit.incomplete.length)?['axe incomplete rules require manual review (see audit JSON)']:[])],axeSource:process.env.AXE_CORE_PATH?{path:path.resolve(process.env.AXE_CORE_PATH),...axePin}:null};
  const evidenceDir=process.env.CODENOMAD_PANEL_CAPTURE_DIR;
  if(evidenceDir){await mkdir(evidenceDir,{recursive:true});await writeFile(path.join(evidenceDir,'bundles-evidence.json'),JSON.stringify(evidence,null,2)+'\n');}
  console.log(`RESULT: ${results.length} passed; ${failures.length} failed; ${audits.length} real-iframe axe audits; ${captures.length} screenshots. SIMULATED HOST ONLY.`);
  for(const audit of audits)console.log(`AXE ${audit.version} ${audit.appearance}/${audit.scenario}: ${audit.violations.length} violations, ${audit.incomplete.length} incomplete rules, ${audit.passes} passed rules`);
  if(failures.length)process.exitCode=1;
} finally {
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));
  await rm(tmp,{recursive:true,force:true});
}
