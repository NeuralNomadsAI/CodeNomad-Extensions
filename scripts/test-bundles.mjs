// node scripts/test-bundles.mjs [pinned CodeNomad checkout]
// Scope: the packaged author's HTML + real archive validator/frame-document bridge.
// The MessagePort host is simulated. This does NOT exercise ExtensionPanel, native
// confirmation UI, backend management, RPCs, desktop/profile or actual attachment.
// Optional: AXE_CORE_PATH=<axe.min.js>; CODENOMAD_PANEL_CAPTURE_DIR=<directory>.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fixture,palettes} from './fixtures/bundles/data.mjs';

const PIN='61382f7ec7ddcf68e190e8023644362457c227ea';
assert(process.argv[2],'Usage: node scripts/test-bundles.mjs <pinned CodeNomad checkout>');
const checkout=path.resolve(process.argv[2]);
const root=fileURLToPath(new URL('..',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:checkout,encoding:'utf8',windowsHide:true}).trim();
assert.equal(git('rev-parse','HEAD'),PIN,'exact CodeNomad test pin');
const consumed=[
  'packages/ui/src/components/panel-extensions/frame-document.ts',
  'packages/server/src/panel-extensions/archive.ts',
  'packages/server/src/panel-extensions/contract.ts',
  'packages/server/src/panel-extensions/bundles-contract.ts',
  'packages/server/src/opencode/integrations/contract.ts',
  'packages/server/src/opencode/integrations/status.ts',
];
// Compare index AND disk (Git's checkout filters handle CRLF). Unrelated work is
// irrelevant; every consumed local runtime source must be exactly its pinned blob.
const sourceHashes={};
for(const file of consumed){
  const expected=git('rev-parse',`${PIN}:${file}`);
  assert.equal(git('rev-parse',`:${file}`),expected,`clean consumed index: ${file}`);
  assert.equal(git('hash-object','--path',file,file),expected,`clean consumed file: ${file}`);
  sourceHashes[file]=expected;
}
const require=createRequire(path.join(checkout,'package.json'));
const {chromium}=require('playwright'),{tsImport}=require('tsx/esm/api');
const load=file=>tsImport(pathToFileURL(path.join(checkout,file)).href,import.meta.url);
const {panelExtensionDocument,PANEL_EXTENSION_SANDBOX}=await load(consumed[0]);
const {readPanelExtensionArchive}=await load(consumed[1]);
const schemas=await load(consumed[3]);
const LOCALES=['en','fr','de','es','he','ja','ne','ru','tr','zh'];
const axePin=JSON.parse(await readFile(new URL('./fixtures/bundles/axe.json',import.meta.url),'utf8'));
const failures=[],results=[],audits=[],captures=[],errors=[];
async function test(name,run){try{await run();results.push(name);console.log('PASS:',name);}catch(error){failures.push({name,error:String(error.stack||error)});console.error('FAIL:',name,'\n'+error.stack);}}
const tempRoot=path.join(os.tmpdir(),'opencode');await mkdir(tempRoot,{recursive:true});
const tmp=await mkdtemp(path.join(tempRoot,'bundles-test-'));
let browser,server;
try {
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
  await test('10 actual locale dictionaries, exactly 85 keys, nonempty strings and placeholder parity',async()=>{
    assert.deepEqual(Object.keys(T).sort(),[...LOCALES].sort());assert.equal(Object.keys(T.en).length,85);
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
    else if(method==='hosts')schemas.bundlesHostsInputSchema.parse(input);
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
  });
  const doc=panelExtensionDocument(pkg.html,'bundles-fixture',pkg.manifest.apiVersion,pkg.manifest.permissions);
  assert.equal(PANEL_EXTENSION_SANDBOX,'allow-scripts');
  const hostScript=await readFile(new URL('./fixtures/bundles/host.js',import.meta.url),'utf8');
  server=createServer((request,response)=>{
    const routes={'/doc':[doc,'text/html; charset=utf-8'],'/fixture':[JSON.stringify({...fixture(),palettes}),'application/json'],'/host.js':[hostScript,'text/javascript']};
    const [body,type]=routes[request.url]||['<!doctype html><html lang="en"><title>Simulated bundles host</title><style>html,body{margin:0;height:100%;overflow:hidden}</style><body><script type="module" src="/host.js"></script>','text/html; charset=utf-8'];
    response.setHeader('Content-Type',type);response.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.CODENOMAD_BROWSER_PATH||undefined});
  const url=`http://127.0.0.1:${server.address().port}/`;
  async function open(width=420,height=1000){
    const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
    page.on('pageerror',error=>errors.push(String(error)));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.exposeFunction('validateWire',input=>{try{return validateWire(input);}catch(error){errors.push('wire schema: '+String(error));throw error;}});
    await page.clock.install({time:new Date('2026-11-01T09:00:00.000Z')});
    await page.goto(url);
    const frame=page.frameLocator('iframe'),host=(fn,arg)=>page.evaluate(fn,arg);
    await frame.locator('#notice').filter({hasText:T.en.updated}).waitFor();
    return {page,frame,host};
  }
  const body=id=>`#body-${id}`,row=id=>`.integration:has(#title-${id})`;
  const action=(frame,id,key)=>frame.locator(`${body(id)} [data-action=${key}]`).filter({visible:true});
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
  const expand=async(view,id)=>{const button=view.frame.locator('#title-'+id);if(await button.getAttribute('aria-expanded')!=='true')await button.click();await settle(view);};
  const isFocused=locator=>locator.evaluate(node=>node===document.activeElement);
  const mutations=view=>view.host(()=>H.calls.filter(call=>!['catalog','state','hosts'].includes(call.method)));
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
    assert.equal(await v.frame.locator('#summary').textContent(),'3 integrations · 0 confirmed active');
    assert.deepEqual(await v.frame.locator('body').evaluate(()=>Object.keys(codenomad.bundles).sort()),['attach','catalog','detach','hosts','installHost','onChanged','request','setActive','state']);
    assert.deepEqual(await v.frame.locator('body').evaluate(()=>Object.keys(codenomad).sort()),['apiVersion','bundles','getContext','onContext']);
    const native=v.frame.locator(row('studio'));assert.match(await native.textContent(),/Version unknown/);
    assert.equal(await native.locator('.disclosure .badge-shape').last().textContent(),T.en.outdated);
    assert.equal(await action(v.frame,'studio','install').count(),0);
    assert.equal(await native.locator('.scope').filter({visible:true}).count(),1);
    assert.match(await native.textContent(),/Native integrations use Global only/);
    assert.equal(await native.locator('input').first().evaluate(node=>node.indeterminate&&!node.checked),true);
    assert.equal(await v.frame.locator('a,[onclick*=open],form').count(),0,'docs are non-navigating text');
    assert.match(await native.textContent(),/https:\/\/github.com\/NeuralNomadsAI\/opencode-integrations\//);
    assert.equal(await v.host(()=>H.topMessages),0,'requests use MessagePort, not window messages');
    await capture(v,'three-families-dark');
  });

  await isolated('runtime unknown/absent/inactive/failed/unsupported/non-conforming, stale/unavailable catalog and host states',async v=>{
    for(const state of ['unknown','absent','inactive','failed','unsupported','non-conforming']){
      const f=fixture(),native=f.state.integrations[0];native.state=state;delete native.version;delete native.status;
      if(state==='absent'){native.configured=false;native.scopes=[];}
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
      if(host==='unknown')assert.match(await v.frame.locator(body('studio')).textContent(),/Open studio and enable/);
    }
    const stale=fixture();stale.catalog.state=stale.state.catalog.state='stale';await refresh(v,stale);
    assert.match(await v.frame.locator('#catalog').textContent(),/Catalogue unavailable · last valid catalogue/);
    await capture(v,'stale');
    const unavailable=fixture();unavailable.catalog.state=unavailable.state.catalog.state='unavailable';await refresh(v,unavailable);
    assert.equal(await v.frame.locator('#catalog').textContent(),T.en.unavailable);
    for(const control of await v.frame.locator('[data-manage]').all())assert.equal(await control.isDisabled(),true);
    await capture(v,'unavailable');
  });

  await isolated('foreign-only binding projection is none with offers; unknown attachment disables attach; no author detach',async v=>{
    await expand(v,'studio');
    assert.match(await v.frame.locator(body('studio')).textContent(),/This conversation: Not attached/);
    const attach=action(v.frame,'studio','attach');assert.equal(await attach.count(),2);
    assert.equal(await attach.nth(0).isDisabled(),false);assert.equal(await attach.nth(1).isDisabled(),true);
    for(const state of ['unknown','attached','none']){
      const f=fixture();f.state.integrations[0].attachment=state==='attached'?{state,label:'This fixture scene'}:{state};await refresh(v,f);
      assert.equal(await action(v.frame,'studio','attach').first().isDisabled(),state!=='none');
      assert.equal(await v.frame.locator('[data-action=detach]').count(),0);
      if(state==='attached')assert.match(await v.frame.locator(body('studio')).textContent(),/trusted CodeNomad control/);
    }
    await v.host(()=>{H.hostsError=true;});await refresh(v);
    assert.equal(await action(v.frame,'studio','attach').first().isDisabled(),true);
    assert.match(await v.frame.locator(body('studio')).textContent(),/Could not check available applications|Available applications could not be checked/);
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
      assert.equal(await v.frame.locator('#summary').textContent(),'3 integrations · 0 confirmed active');
      assert.doesNotMatch(await v.frame.locator('#notice').textContent(),/installed|attached|activated/i);
      await v.host(()=>H.finish('confirmed'));await notice(v,'confirmed');await settle(v);
      assert.equal((await mutations(v)).length,before+1);assert.equal(await v.frame.locator('#summary').textContent(),'3 integrations · 0 confirmed active');
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
    await refresh(v,enabled);assert.equal(await v.frame.locator('#summary').textContent(),'3 integrations · 1 confirmed active','only authoritative read changes the summary');
  });

  for(const outcome of ['cancelled','confirmed','expired','failed'])await isolated(`exact same iframe button focus after simulated ${outcome}`,async v=>{
    const trigger=action(v.frame,'studio','installHost');await trigger.evaluate(node=>window.savedTrigger=node);
    await trigger.click();await notice(v,'confirming');
    // Move focus to the simulated host (the actual native confirmation UI is out of scope).
    await v.page.locator('body').evaluate(node=>{node.tabIndex=-1;node.focus();});
    await v.host(outcome=>H.finish(outcome),outcome);await notice(v,outcome==='failed'?'requestFailed':outcome);await settle(v);
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
    await v.host(()=>H.release());await settle(v);
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
    await v.host(()=>H.finish('confirmed'));await notice(v,'confirmed');await v.page.waitForTimeout(70);
    assert.equal(await isFocused(v.frame.locator('#title-studio')),true);
  });

  await isolated('busy/invalid/transport error give explicit outcome and no automatic mutation retry',async v=>{
    for(const [mode,key] of [['busy','busy'],['invalid','invalid'],['error','requestFailed'],['busy-error','requestFailed']]){
      await v.host(mode=>{H.mode=mode;},mode);const before=(await mutations(v)).length;
      await action(v.frame,'studio','installHost').click();await notice(v,key);await settle(v);await v.page.clock.fastForward(60_000);await settle(v);
      assert.equal((await mutations(v)).length,before+1);assert.equal(await action(v.frame,'studio','installHost').getAttribute('aria-disabled'),'false');
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
      assert.equal(await v.frame.locator('body').evaluate(node=>node.scrollWidth<=node.clientWidth),true,locale+' no overflow');
      if(base==='he')await capture(v,'narrow-hebrew-rtl');
    }
    for(const appearance of ['dark','light']){
      await v.host(({appearance,colors})=>H.update({appearance,colors,locale:'en'}),{appearance,colors:palettes[appearance]});
      const styles=await v.frame.locator('body').evaluate(node=>({bg:getComputedStyle(node).backgroundColor,radii:[...document.querySelectorAll('*')].filter(node=>{const s=getComputedStyle(node);return ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].some(key=>s[key]!=='0px');}).map(node=>({class:node.className,tag:node.tagName}))}));
      assert.equal(styles.bg,appearance==='dark'?'rgb(29, 36, 48)':'rgb(247, 248, 250)');assert(styles.radii.length>0);assert(styles.radii.every(node=>node.class==='badge-shape'));
      // Axe flags the icon-only glyph as incomplete. Its actual foreground and
      // background still have a measurable text/non-text contrast ratio.
      const contrast=await v.frame.locator('#refresh').evaluate(node=>{
        const luminance=color=>{const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
        const style=getComputedStyle(node),a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert(contrast>=4.5,`${appearance} Refresh glyph AA contrast: ${contrast}`);
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
      for(const scenario of ['normal','attached','host-unknown','host-absent','host-incompatible','unknown-failed','non-conforming','stale','unavailable']){
        const f=fixture();
        if(scenario==='attached')f.state.integrations[0].attachment={state:'attached',label:'This fixture scene'};
        if(scenario.startsWith('host-'))f.state.integrations[0].status.host={state:scenario.slice(5),...(scenario==='host-absent'?{action:'install'}:{})};
        if(scenario==='unknown-failed'){f.state.integrations[0].attachment={state:'unknown'};f.state.integrations[1].state='failed';}
        if(scenario==='non-conforming')f.state.integrations[0].state='non-conforming';
        if(['stale','unavailable'].includes(scenario))f.catalog.state=f.state.catalog.state=scenario;
        await refresh(v,f);
        const audit=await v.frame.locator('body').evaluate(async()=>{const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}});const nodes=values=>values.map(({target,failureSummary,html})=>({target,failureSummary,html}));return {version:axe.version,violations:result.violations.map(({id,impact,nodes:items})=>({id,impact,nodes:nodes(items)})),incomplete:result.incomplete.map(({id,nodes:items})=>({id,nodes:nodes(items)})),passes:result.passes.length};});
        assert.equal(audit.version,axePin.version);
        audits.push({appearance,scenario,...audit});await capture(v,`axe-${appearance}-${scenario}`);
      }
      const violations=audits.filter(audit=>audit.appearance===appearance).flatMap(audit=>audit.violations.map(violation=>`${audit.scenario}/${violation.id}`));
      assert.equal(violations.length,0,`${appearance} axe violations: ${violations.join(', ')} (see audit JSON)`);
    });
  }else console.log('GAP: AXE_CORE_PATH absent; no automated accessibility audit claimed. Keyboard/ARIA checks are not an axe audit.');

  await test('no browser/CSP/schema-wire errors',async()=>assert.deepEqual(errors,[]));
  const evidence={scope:'Simulated MessagePort host, real packaged iframe/validator/frame-document. Not actual ExtensionPanel, trusted host confirmation or native backend.',pin:PIN,sourceHashes,packageDigest:pkg.digest,
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
