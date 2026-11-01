// SIMULATED HOST ONLY: real frame-document bridge + MessagePort, not ExtensionPanel,
// backend mutations, trusted confirmation controls or application integration RPC.
const doc=await (await fetch(location.search.includes('legacy')?'/old-doc':'/doc')).text(), fixture=await (await fetch('/fixture')).json();
const H=window.H={...fixture,context:{apiVersion:4,sessionId:'ses_fixture',locale:'en',appearance:'dark',colors:fixture.palettes.dark},
  calls:[],errors:[],pending:[],inFlight:0,maxInFlight:0,mounts:0,topMessages:0,sequence:0,
  mode:'confirming',docsMode:'auto',openIntents:[],hold:[],held:[],readError:false,hostsError:false,answered:[],closed:0};
let port,frame;
const banner=document.createElement('p');banner.style.cssText='margin:0;padding:5px;background:#fff;color:#111;font:12px system-ui';
document.body.style.cssText='display:grid;grid-template-rows:auto minmax(0,1fr)';document.body.append(banner);
const label=()=>{banner.textContent=H.context.locale.startsWith('fr')?'APERÇU DE TEST · données synthétiques · hôte MessagePort simulé':'TEST PREVIEW · synthetic data · simulated MessagePort host';};label();
window.addEventListener('message',event=>{if(event.source===frame?.contentWindow)H.topMessages++;});
H.count=method=>H.calls.filter(call=>call.method===method).length;
H.mount=()=>{
  const mine=++H.mounts;
  document.querySelector('iframe')?.remove();
  if(port){port.close();H.closed++;}
  frame=document.createElement('iframe');frame.title='Integrations test fixture';frame.setAttribute('sandbox','allow-scripts');
  frame.style.cssText='width:100%;height:100%;border:0;display:block';
  frame.onload=()=>{if(mine!==H.mounts)return;const channel=new MessageChannel();port=channel.port1;
    const own=port;own.onmessage=event=>handle(own,event.data);
    frame.contentWindow.postMessage({type:'codenomad:init'},'*',[channel.port2]);};
  frame.srcdoc=doc;document.body.append(frame);
};
H.update=value=>{H.context={...H.context,...value};label();port.postMessage({type:'context',context:H.context});};
H.changed=detail=>port.postMessage({type:'bundles:changed',...detail});
H.focus=requestID=>port.postMessage({type:'bundles:focus',requestID});
H.finish=(outcome,{focus=true,requestID=H.pending.at(-1)}={})=>{
  H.pending=H.pending.filter(id=>id!==requestID);
  H.changed({kind:'request',requestID,outcome});
  if(focus)H.focus(requestID);
};
H.release=()=>{const held=H.held.splice(0);H.hold=[];for(const answer of held)answer();};
H.barrier=async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));};
async function handle(own,data){
  if(data?.type==='ready'){own.postMessage({type:'context',context:H.context});return;}
  if(data?.type!=='api4:request')return;
  const {id,capability,method,input}=data;
  H.calls.push({capability,method,input:structuredClone(input),session:H.context.sessionId,mount:H.mounts});
  H.inFlight++;H.maxInFlight=Math.max(H.maxInFlight,H.inFlight);
  let response;
  try {
    await window.validateWire({capability,method,input});
    if(['catalog','state','hosts'].includes(method)){
      if(H.readError||(method==='hosts'&&H.hostsError))throw Error('fixture read failure');
      response={result:structuredClone(H[method])};
    } else if(method==='openDocs'){
      if(H.docsMode==='error')throw Error('fixture documentation transport failure');
      if(H.docsMode==='busy-error')response={error:'busy'};
      else {
        const result=H.docsMode==='auto'?await window.resolveDocs(input,H.catalog):H.docsMode;
        if(result?.outcome==='requested')H.openIntents.push(input.integration);
        response={result};
      }
    } else if(H.mode==='error')throw Error('fixture mutation failure');
    else if(H.mode==='busy-error')response={error:'busy'};
    else if(H.mode==='confirming'){
      const requestID=(++H.sequence).toString(16).padStart(32,'0');H.pending.push(requestID);
      response={result:{outcome:'confirming',requestID}};
    }else response={result:{outcome:H.mode}};
  }catch(error){
    if(!String(error).includes('fixture'))H.errors.push(String(error));
    response={error:true};
  }
  const answer=()=>{H.inFlight--;own.postMessage({type:'api4:result',id,...response});H.answered.push(method);};
  if(H.hold.includes(method))H.held.push(answer);else answer();
}
H.mount();
