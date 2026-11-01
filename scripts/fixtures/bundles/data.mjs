// Display-only API 4 projections. There is deliberately no foreign binding,
// native RPC authority, filesystem path, credential or real application here.
export const stamp = {state:'fresh',fetchedAt:'2026-11-01T09:00:00.000Z'};
const entry = (id,family) => ({id,displayName:`OpenCode for ${id[0].toUpperCase()+id.slice(1)}`,family,
  summary:{en:`Deterministic ${family} integration fixture.`},app:{name:id,versions:'>=1.0.0'},
  docs:`https://github.com/NeuralNomadsAI/opencode-integrations/docs/${id}`,catalogStatus:'preview'});
export const catalog = {...stamp,integrations:[entry('studio','native'),entry('vendor','vendor-mcp'),entry('service','api')]};
const activation = {global:'default',project:'default',effective:'default'};
export const state = {catalog:stamp,integrations:[
  {id:'studio',family:'native',configured:true,scopes:['global'],activation,state:'ok',
    attachment:{state:'none'},status:{version:'1.0.0',host:{state:'outdated',partVersion:'0.9.0',expectedRange:'^1.0.0',appVersion:'4.0.0',action:'update'},connection:{offers:2}}},
  {id:'vendor',family:'vendor-mcp',configured:true,scopes:['global'],activation,version:'1.0.0',outdated:true,state:'ok',status:{version:'1.0.0',connection:{state:'signed_out'}}},
  {id:'service',family:'api',configured:false,scopes:[],activation,state:'absent'},
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
