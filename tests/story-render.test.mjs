import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks, createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// NODE_PATH can point to the bundled runtime when local npm is unavailable.
const require=createRequire(import.meta.url);
const sharpUrl=pathToFileURL(require.resolve('sharp')).href;
registerHooks({resolve(specifier,context,next){
  if(specifier==='sharp') return {url:sharpUrl,shortCircuit:true};
  return next(specifier,context);
}});
const sharp=require('sharp');
const {default:handler,validateStory,storyPrompt}=await import('../api/story-render.js');
const image='data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:3,background:'#aa4444'}}).png().toBuffer()).toString('base64');
const body={format:'My Story',source:'event',outputPresetId:'story-digital',sceneIndex:0,details:{memory:'Original user memory'},images:[{dataUrl:image}],plan:{title:'Our holiday',synopsis:'A holiday together',scenes:Array.from({length:4},(_,i)=>({title:'Scene '+i,location:'Park',time:'Day',action:'Walk',framing:'Wide',emotion:'Joy',visual_anchor:'Trees'}))}};
const continuity={character_continuity:'Same reference person, face, relative height and clothing.',visual_style:'Warm ink, muted natural colors.',world_continuity:'Same holiday world, with planned location changes.'};
Object.assign(body.plan,continuity);
function res(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;},end(){return this;}};}

test('Story validation and read-only prompt',()=>{
  const original=JSON.stringify(body);
  assert.equal(validateStory(body),null);
  assert.match(storyPrompt(body),/Original user memory/);
  assert.equal(JSON.stringify(body),original);
  for(const patch of [{sceneIndex:4},{images:[]},{images:[{dataUrl:'bad'}]},{outputPresetId:'snapshot-digital'},{sceneIndex:1},{plan:{...body.plan,scenes:[{}]}}]) assert.ok(validateStory({...body,...patch}));
});
test('Server gate rejects forged paid flag and supports preflight',async()=>{
  delete process.env.DEV_BYPASS_PAYMENT;
  let response=res();await handler({method:'POST',body:{...body,payment:{status:'paid'}}},response);assert.equal(response.statusCode,402);
  response=res();await handler({method:'OPTIONS'},response);assert.equal(response.statusCode,204);
  process.env.DEV_BYPASS_PAYMENT='true';process.env.VERCEL_ENV='production';
  response=res();await handler({method:'POST',body},response);assert.equal(response.statusCode,402);
  delete process.env.DEV_BYPASS_PAYMENT;delete process.env.VERCEL_ENV;
});
test('All scenes share continuity and original refs while preserving their own brief',()=>{
  for(let sceneIndex=0;sceneIndex<4;sceneIndex++){
    const request={...body,sceneIndex,continuityImage:sceneIndex?image:undefined};
    assert.equal(validateStory(request),null);
    const prompt=storyPrompt(request);
    for(const value of Object.values(continuity)) assert.ok(prompt.includes(value));
    assert.ok(prompt.includes(JSON.stringify(body.plan.scenes[sceneIndex])));
    assert.match(prompt,/at least three/);
    if(sceneIndex) assert.match(prompt,/SAME PEOPLE/);
    else assert.match(prompt,/Scene 1 MUST remain closest/);
  }
  assert.ok(validateStory({...body,plan:{...body.plan,visual_style:''}}));
});
test('Continuity preparation reads original refs and does not rewrite approved scenes',async()=>{
  const originalFetch=globalThis.fetch;
  process.env.DEV_BYPASS_PAYMENT='true';process.env.OPENAI_API_KEY='test-only';
  const request={...body,stage:'continuity',plan:{...body.plan}};
  for(const key of Object.keys(continuity)) delete request.plan[key];
  const before=JSON.stringify(request);
  try{
    globalThis.fetch=async(url,options)=>{
      assert.match(url,/\/responses$/);
      const input=JSON.parse(options.body);
      assert.deepEqual(input.text.format.schema.required,Object.keys(continuity));
      assert.equal(input.input[0].content[2].image_url,image);
      return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify(continuity)}]}]});
    };
    const response=res();await handler({method:'POST',body:request},response);
    assert.equal(response.statusCode,200);assert.deepEqual(response.data.continuity,continuity);
    assert.equal(JSON.stringify(request),before);
  }finally{globalThis.fetch=originalFetch;delete process.env.DEV_BYPASS_PAYMENT;delete process.env.OPENAI_API_KEY;}
});
test('Mock image service success, failure and malformed response',async()=>{
  const originalFetch=globalThis.fetch;
  process.env.DEV_BYPASS_PAYMENT='true';process.env.OPENAI_API_KEY='test-only';
  try{
    for(const scenario of ['success','quota','bad-json','missing-image']){
      globalThis.fetch=async(url,options)=>{
        assert.match(url,/images\/edits$/);
        assert.match(options.body.get('prompt'),/scene 1/);
        if(scenario==='quota') return new Response('{}',{status:429});
        if(scenario==='bad-json') return new Response('invalid');
        return Response.json(scenario==='success'?{data:[{b64_json:image.split(',')[1]}]}:{});
      };
      const response=res();await handler({method:'POST',body},response);
      assert.equal(response.statusCode,scenario==='success'?200:scenario==='quota'?503:502);
      if(scenario==='success'){
        const metadata=await sharp(Buffer.from(response.data.image.dataUrl.split(',')[1],'base64')).metadata();
        assert.equal(metadata.width,1024);assert.equal(metadata.height,1024);assert.equal(metadata.format,'jpeg');
      }
    }
  }finally{globalThis.fetch=originalFetch;delete process.env.DEV_BYPASS_PAYMENT;delete process.env.OPENAI_API_KEY;}
});
test('Shared image transport retains original refs and appends the continuity master',async()=>{
  const {callOpenAIWithImages}=await import('../lib/image-client.js');
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{
      const files=options.body.getAll('image[]');
      assert.equal(files.length,2);
      for(const file of files) assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(image.split(',')[1],'base64'));
      return Response.json({});
    };
    await callOpenAIWithImages('Shared prompt',[{dataUrl:image},{dataUrl:image}]);
    globalThis.fetch=async(url,options)=>{
      assert.equal(options.body.getAll('image').length,1);
      assert.equal(options.body.get('prompt'),'Snapshot original prompt');
      return Response.json({});
    };
    await callOpenAIWithImages('Snapshot original prompt',[{dataUrl:image}]);
  }finally{globalThis.fetch=originalFetch;}
});
