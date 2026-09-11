import { resolveOutputPreset } from "./output-presets.js";

function setCors(res){
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}

function jsonError(res,status,error,code,retryable=false,extra={}){
  return res.status(status).json({error,code,retryable,...extra});
}

function hasText(value){
  return typeof value==="string" && value.trim().length>0;
}

function validateStoryPackage(body){
  if(process.env.REQUIRE_PAYMENT==="true" && body.payment?.status!=="paid"){
    return {status:402,error:"Payment is required before generation.",code:"payment_required"};
  }
  if(body.format!=="My Story") return {status:400,error:"Story rendering only supports the My Story format.",code:"invalid_format"};
  const outputPreset=resolveOutputPreset("My Story",body.outputPresetId || body.outputPreset?.id);
  if(!outputPreset) return {status:400,error:"Invalid output preset",code:"invalid_output_preset"};
  const plan=body.plan;
  if(!plan || typeof plan!=="object" || !hasText(plan.title) || !hasText(plan.synopsis)){
    return {status:400,error:"Approved Story plan is required.",code:"missing_plan"};
  }
  if(!Array.isArray(plan.scenes) || plan.scenes.length!==4){
    return {status:400,error:"Approved Story plan must include exactly four scenes.",code:"invalid_scene_count"};
  }
  return null;
}

export default async function handler(req,res){
  setCors(res);

  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="POST") return jsonError(res,405,"POST only","method_not_allowed");

  const body=req.body || {};
  const validationError=validateStoryPackage(body);
  if(validationError) return jsonError(res,validationError.status,validationError.error,validationError.code);

  const outputPreset=resolveOutputPreset("My Story",body.outputPresetId || body.outputPreset?.id);
  return jsonError(res,501,"Story rendering is not connected yet.","story_renderer_pending",false,{
    architecture:{
      stage:"renderer_pending",
      sceneMasters:4,
      renderer:"story_layout_renderer",
      outputType:outputPreset.outputType,
      presetId:outputPreset.id,
      label:outputPreset.resultLabel,
      ratio:outputPreset.ratio,
      targetPixels:outputPreset.targetPixels
    }
  });
}
