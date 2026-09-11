import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// Mock the SDK boundary; execute the production schema and handler unchanged.
const stub='export default class OpenAI { responses={create:async request=>globalThis.plannerStub(request)}; }';
registerHooks({resolve(specifier,context,next){
  if(specifier==='openai') return {url:'data:text/javascript,'+encodeURIComponent(stub),shortCircuit:true};
  return next(specifier,context);
}});
const {default:handler}=await import('../api/story-plan.js');
const keys=['character_continuity','visual_style','world_continuity'];
const brief=Object.fromEntries(keys.map(key=>[key,'Shared '+key]));
const plan={title:'Holiday',synopsis:'A holiday together',...brief,scenes:Array.from({length:4},()=>({title:'Moment',location:'Park',time:'Day',action:'Walk',framing:'Wide',emotion:'Joy',visual_anchor:'Trees'}))};
const body={format:'My Story',mode:'Easy',source:'event',details:{memory:'Original memory',theme:'Adventure',tone:'Warm',people:[{name:'Person A'}]},images:[{label:'Family event',dataUrl:'data:image/png;base64,YQ=='}]};
function res(){return {statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(value){this.data=value;return this;}};}

test('Story schema requires one shared brief and original inputs remain unchanged',async()=>{
  process.env.OPENAI_API_KEY='test-only';
  const original=JSON.stringify(body);
  globalThis.plannerStub=async request=>{
    const schema=request.text.format.schema;
    for(const key of keys){assert.ok(schema.required.includes(key));assert.equal(schema.properties[key].type,'string');}
    assert.equal(schema.properties.scenes.minItems,4);assert.equal(schema.properties.scenes.maxItems,4);
    const text=request.input[0].content[0].text;
    assert.match(text,/Never identify real people/);
    assert.match(text,/relative height and body proportions/);
    assert.match(text,/at least THREE/);
    assert.match(text,/Original memory/);
    return {output_text:JSON.stringify(plan)};
  };
  const response=res();await handler({method:'POST',body},response);
  assert.equal(response.statusCode,200);assert.deepEqual(response.data.plan,plan);
  assert.equal(JSON.stringify(body),original);
});
test('Snapshot schema and prompt do not acquire Story continuity fields',async()=>{
  const snapshot={title:'Moment',synopsis:'A memory',source_strategy:'Photo',action:'Walk',framing:'Wide',emotion:'Joy',visual_anchor:'Tree'};
  globalThis.plannerStub=async request=>{
    for(const key of keys) assert.equal(request.text.format.schema.properties[key],undefined);
    assert.ok(!request.input[0].content[0].text.includes('character_continuity:'));
    return {output_text:JSON.stringify(snapshot)};
  };
  const response=res();await handler({method:'POST',body:{...body,format:'Snapshot'}},response);
  assert.equal(response.statusCode,200);assert.deepEqual(response.data.plan,snapshot);
});
test('Incomplete shared brief fails instead of silently proceeding',async()=>{
  globalThis.plannerStub=async()=>({output_text:JSON.stringify({...plan,visual_style:''})});
  const response=res();await handler({method:'POST',body},response);
  assert.equal(response.statusCode,500);
  delete process.env.OPENAI_API_KEY;delete globalThis.plannerStub;
});
