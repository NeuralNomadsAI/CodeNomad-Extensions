// Display-only API 4 projections. There is deliberately no foreign binding,
// native RPC authority, filesystem path, credential or real application here.
export const stamp = {state:'fresh',fetchedAt:'2026-11-01T09:00:00.000Z'};
const entry = (id,family) => ({id,displayName:`OpenCode for ${id[0].toUpperCase()+id.slice(1)}`,family,
  summary:{en:`Deterministic ${family} integration fixture.`},app:{name:id,versions:'>=1.0.0'},
  docs:`https://github.com/NeuralNomadsAI/opencode-integrations/docs/${id}`,catalogStatus:'preview'});
export const catalog = {...stamp,integrations:[entry('studio','native'),entry('vendor','vendor-mcp'),entry('service','api')]};
const activation = {global:'default',project:'default',effective:'default'};
export const state = {catalog:stamp,integrations:[
  {id:'studio',family:'native',configured:true,scopes:['global'],activation,plugin:{declared:true,runtime:'active'},state:'ok',
    attachment:{state:'none'},status:{version:'1.0.0',host:{state:'outdated',partVersion:'0.9.0',expectedRange:'^1.0.0',appVersion:'4.0.0',action:'update'},connection:{offers:2}}},
  {id:'vendor',family:'vendor-mcp',configured:true,scopes:['global'],activation,plugin:{declared:true,runtime:'active'},version:'1.0.0',outdated:true,state:'ok',status:{version:'1.0.0',connection:{state:'signed_out'}}},
  {id:'service',family:'api',configured:false,scopes:[],activation,plugin:{declared:false,runtime:'unloaded'},state:'absent'},
]};
export const hosts = {offers:[
  {offerID:'offer_good_001',label:'Studio ready',document:'Untitled scene',appVersion:'4.0.0',protocol:'ok'},
  {offerID:'offer_bad_002',label:'Studio incompatible',appVersion:'3.0.0',protocol:'incompatible'},
]};
export const palettes = {
  dark:{background:'#1d2430',surface:'#252f3d',text:'#e0e7f1',muted:'#b2bed0',border:'#67768b',focus:'#83b6ef'},
  light:{background:'#f7f8fa',surface:'#edf0f4',text:'#232a36',muted:'#526074',border:'#a9b3c2',focus:'#265b9f'},
};
export function fixture() {return structuredClone({catalog,state,hosts});}

// Supplied parent projections, not an installation tracker or elapsed-time model.
export const installationStates=['pending','unconfirmed','unloaded','absent','active-no-version','undeclared-active','failed-no-id','disabled','ambiguous','older-host'];
export function installationFixture(kind) {
  const value=fixture(),native=value.state.integrations[0];
  delete native.version;delete native.status;
  Object.assign(native,{state:'inactive',activation:{global:'enabled',project:'default',effective:'enabled'},
    plugin:{declared:true,runtime:'unloaded'},attachment:{state:'unknown'}});
  if(['pending','unconfirmed'].includes(kind))native.plugin.progress=kind;
  if(kind==='absent')Object.assign(native,{configured:false,scopes:[],state:'absent',activation:{...activation},plugin:{declared:false,runtime:'unloaded'}});
  if(['active-no-version','undeclared-active'].includes(kind))Object.assign(native,{state:'ok',plugin:{declared:kind!=='undeclared-active',runtime:'active'},status:structuredClone(state.integrations[0].status)});
  if(kind==='undeclared-active')native.scopes=[];
  if(kind==='failed-no-id'){native.state='failed';native.plugin.runtime='failed';}
  if(kind==='disabled')native.activation={global:'disabled',project:'default',effective:'disabled'};
  if(kind==='ambiguous'){native.state='non-conforming';native.plugin.runtime='unknown';}
  if(kind==='older-host')delete native.plugin;
  return value;
}
