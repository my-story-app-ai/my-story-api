
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DEFAULT_PLANNER_MODEL = "gpt-4.1-mini";
const MAX_IMAGES = 6;
const MAX_DATA_URL_BYTES = 12 * 1024 * 1024;
const MAX_MEMORY_CHARS = 5000;
const ALLOWED_FORMATS = ["Snapshot","My Story"];
const ALLOWED_MODES = ["Easy","Guided"];
const ALLOWED_SOURCES = ["event","reconstruct"];

const snapshotSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title","synopsis","source_strategy","action","framing","emotion","visual_anchor"],
  properties: {
    title: { type: "string" },
    synopsis: { type: "string" },
    source_strategy: { type: "string" },
    action: { type: "string" },
    framing: { type: "string" },
    emotion: { type: "string" },
    visual_anchor: { type: "string" }
  }
};

const sceneSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title","location","time","action","framing","emotion","visual_anchor"],
  properties: {
    title: { type: "string" },
    location: { type: "string" },
    time: { type: "string" },
    action: { type: "string" },
    framing: { type: "string" },
    emotion: { type: "string" },
    visual_anchor: { type: "string" }
  }
};

const storySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title","synopsis","scenes"],
  properties: {
    title: { type: "string" },
    synopsis: { type: "string" },
    scenes: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: sceneSchema
    }
  }
};

function safeImages(images=[]){
  return images
    .filter(x => x && typeof x.dataUrl === "string" && x.dataUrl.startsWith("data:image/"))
    .slice(0,MAX_IMAGES);
}

function jsonError(res,status,error,code,retryable=false){
  return res.status(status).json({error,code,retryable});
}

function hasText(value){
  return typeof value === "string" && value.trim().length > 0;
}

function totalImageBytes(images){
  return images.reduce((sum,image)=>sum + Buffer.byteLength(image.dataUrl,"utf8"),0);
}

function validateRequest(body){
  if(!ALLOWED_FORMATS.includes(body.format)) return {status:400,error:"Invalid format",code:"invalid_format"};
  if(!ALLOWED_MODES.includes(body.mode)) return {status:400,error:"Invalid mode",code:"invalid_mode"};
  if(!ALLOWED_SOURCES.includes(body.source)) return {status:400,error:"Invalid source path",code:"invalid_source"};
  if(!hasText(body.details?.memory)) return {status:400,error:"Memory description is required",code:"missing_memory"};
  if(String(body.details.memory).length > MAX_MEMORY_CHARS) return {status:400,error:"Memory description is too long. Please shorten it before creating a preview.",code:"memory_too_long"};

  const rawImages=Array.isArray(body.images) ? body.images : [];
  if(rawImages.length > MAX_IMAGES) return {status:413,error:`Please upload no more than ${MAX_IMAGES} images.`,code:"too_many_images"};
  const images=safeImages(rawImages);
  if(images.length < 1) return {status:400,error:"At least one source image is required.",code:"missing_images"};
  if(totalImageBytes(images) > MAX_DATA_URL_BYTES) return {status:413,error:"Uploaded images are too large. Please use fewer or smaller photos.",code:"images_too_large"};
  return null;
}

function plannerModel(){
  const configured=process.env.OPENAI_PLANNER_MODEL?.trim();
  if(!configured) return DEFAULT_PLANNER_MODEL;
  if(configured.includes("codex") || configured.includes("5.6")) return DEFAULT_PLANNER_MODEL;
  return configured;
}

function plannerPrompt(body){
  const {format,mode,source,details,regeneration=0}=body;
  const people=(details?.people || []).map(p=>`${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ") || "not explicitly named";
  return `
You are the Story Planner for "My Story", an automated personalized illustrated-memory product.

PRODUCT:
- Snapshot: one final personalized illustrated scene.
- My Story: a cover plus exactly four illustrated story scenes.
- There is no manual designer intervention.
- The planner must infer a coherent creative direction from user text and supplied reference images.

USER INPUT:
Format: ${format}
Mode: ${mode}
Source path: ${source === "event" ? "real event photo(s)" : "reconstructed from person/place references"}
People: ${people}
Occasion: ${details?.occasion || "not specified"}
Place: ${details?.place || "not specified"}
Memory: ${details?.memory || ""}
Creative direction: ${details?.theme || "not specified"}
Tone: ${details?.tone || "not specified"}
Regeneration variant: ${regeneration}

SOURCE RULES:
1. If real event photos are supplied, treat them as the primary truth for visible people, clothing, setting, relationships, objects and atmosphere. Do not invent contradictory physical details.
2. If the moment is reconstructed, use person images only as appearance references and a place image only as environmental reference.
3. Never identify real people. Refer to them only by user-supplied names/roles or neutral terms.
4. Do not infer sensitive personal traits from images.

SNAPSHOT RULES:
- Pick one decisive emotional moment.
- The result must feel based on this specific memory, not a generic portrait.
- Return a precise source strategy, action, framing, emotion and one visual anchor.

MY STORY RULES:
- Return exactly four scenes.
- Scene 1 should normally stay closest to the real memory/source.
- Scenes 2–4 may creatively expand the memory while staying coherent.
- Maintain the same people and overall visual world.
- Avoid four near-identical images.
- Every adjacent pair of scenes must differ in at least THREE of:
  location, time of day, action, framing/camera, visual anchor.
- Give each scene a clear narrative function and a visually distinct composition.
- Do not repeat the same dominant location or camera framing in all scenes.
- The synopsis should explain the complete story arc in concise, emotionally clear prose.
- Guided vs Easy changes only user control later; produce the same high-quality plan.

Write concise production-ready fields. No markdown.
`.trim();
}

export default async function handler(req,res){
  // CORS for GitHub Pages frontend. Lock this to your production domain later.
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");

  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="POST") return jsonError(res,405,"POST only","method_not_allowed");
  if(!process.env.OPENAI_API_KEY) return jsonError(res,500,"AI service is not configured","missing_openai_key",true);

  try{
    const body=req.body || {};
    const validationError=validateRequest(body);
    if(validationError) return jsonError(res,validationError.status,validationError.error,validationError.code);

    const content=[{type:"input_text",text:plannerPrompt(body)}];
    for(const image of safeImages(body.images)){
      content.push({type:"input_text",text:`Reference image: ${image.label || image.kind || "user reference"}`});
      content.push({type:"input_image",image_url:image.dataUrl});
    }

    const schema=body.format==="My Story" ? storySchema : snapshotSchema;

    const model=plannerModel();
    const response=await client.responses.create({
      model,
      input:[{
        role:"user",
        content
      }],
      text:{
        format:{
          type:"json_schema",
          name: body.format==="My Story" ? "my_story_plan" : "snapshot_plan",
          strict:true,
          schema
        }
      }
    });

    const text=response.output_text;
    if(!text) throw new Error("Planner returned no structured output");

    const plan=JSON.parse(text);

    // Lightweight server-side diversity validation.
    if(body.format==="My Story"){
      if(!Array.isArray(plan.scenes) || plan.scenes.length!==4){
        throw new Error("Planner did not return exactly four scenes");
      }
    }

    return res.status(200).json({
      plan,
      model
    });

  }catch(error){
    console.error("story-plan error",error);
    const message=String(error?.message || error);
    const lowerMessage=message.toLowerCase();
    const quotaProblem=error?.status===429 || lowerMessage.includes("no credits") || lowerMessage.includes("quota");
    const temporaryProblem=quotaProblem || error?.status>=500 || lowerMessage.includes("timeout");
    return res.status(quotaProblem ? 503 : 500).json({
      error: quotaProblem
        ? "AI planning is temporarily unavailable. Please try again later."
        : "AI Story Planner failed",
      code: quotaProblem ? "planner_quota_unavailable" : "planner_failed",
      retryable: temporaryProblem,
      detail: process.env.NODE_ENV==="development" ? message : undefined
    });
  }
}
