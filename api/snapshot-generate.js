const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/edits";
const OPENAI_GENERATIONS_URL = "https://api.openai.com/v1/images/generations";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const MAX_IMAGES = 6;
const MAX_DATA_URL_BYTES = 12 * 1024 * 1024;
const MAX_MEMORY_CHARS = 5000;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 110000);
const ALLOWED_SOURCES = ["event","reconstruct"];

function setCors(res){
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
}

function hasText(value){
  return typeof value==="string" && value.trim().length>0;
}

function jsonError(res,status,error,code,retryable=false){
  return res.status(status).json({error,code,retryable});
}

function safeImages(images=[]){
  return images
    .filter(image => image && typeof image.dataUrl==="string" && image.dataUrl.startsWith("data:image/"))
    .slice(0,MAX_IMAGES);
}

function validateSnapshotPackage(body){
  if(process.env.REQUIRE_PAYMENT==="true" && body.payment?.status!=="paid"){
    return {status:402,error:"Payment is required before generation.",code:"payment_required"};
  }
  if(body.format!=="Snapshot") return "Snapshot generation only supports the Snapshot format in v0.8.";
  if(!ALLOWED_SOURCES.includes(body.source)) return {status:400,error:"Invalid source path",code:"invalid_source"};
  if(!body.details || !hasText(body.details.memory)) return "Memory description is required.";
  if(String(body.details.memory).length>MAX_MEMORY_CHARS) return {status:400,error:"Memory description is too long. Please shorten it before generation.",code:"memory_too_long"};
  const plan=body.plan;
  if(!plan || typeof plan!=="object") return "Approved Snapshot plan is required.";
  for(const key of ["title","synopsis","source_strategy","action","framing","emotion","visual_anchor"]){
    if(!hasText(plan[key])) return `Approved Snapshot plan is missing ${key}.`;
  }
  const rawImages=Array.isArray(body.images) ? body.images : [];
  if(rawImages.length>MAX_IMAGES) return {status:413,error:`Please upload no more than ${MAX_IMAGES} images.`,code:"too_many_images"};
  const images=safeImages(rawImages);
  if(images.length<1) return "At least one source image is required for live Snapshot generation.";
  const totalBytes=images.reduce((sum,image)=>sum + Buffer.byteLength(image.dataUrl,"utf8"),0);
  if(totalBytes>MAX_DATA_URL_BYTES) return {status:413,error:"Uploaded images are too large for generation. Please use fewer or smaller photos.",code:"images_too_large"};
  return "";
}

function dataUrlToBlob(dataUrl){
  const match=dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);
  if(!match) throw new Error("Unsupported image data URL.");
  const mimeType=match[1]==="image/jpg" ? "image/jpeg" : match[1];
  const buffer=Buffer.from(match[2],"base64");
  return {
    blob:new Blob([buffer],{type:mimeType}),
    mimeType,
    extension:mimeType.split("/")[1].replace("jpeg","jpg")
  };
}

function buildSnapshotPrompt(body){
  const {details={},plan={},source}=body;
  const people=(details.people || [])
    .map(person => `${person.name}${person.role ? ` (${person.role})` : ""}`)
    .join(", ") || "people visible in the source image";

  return `
Create one premium personalized illustrated Snapshot for the My Story product.

The output should feel like a warm illustrated book / graphic novel keepsake:
- warm printed paper feeling
- elegant ink linework
- muted red and mustard accents where natural
- premium storybook composition
- not neon, not generic SaaS, not exaggerated comic parody

Use the supplied image(s) as visual truth.
Source path: ${source === "event" ? "real event photo(s)" : "reconstructed from person/place references"}.
People: ${people}.
Occasion: ${details.occasion || "not specified"}.
Place: ${details.place || "not specified"}.
Memory: ${details.memory}.
Creative direction: ${details.theme || "not specified"}.
Tone: ${details.tone || "not specified"}.

Approved AI Snapshot brief:
Title: ${plan.title}
Synopsis: ${plan.synopsis}
Source strategy: ${plan.source_strategy}
Action: ${plan.action}
Framing: ${plan.framing}
Emotion: ${plan.emotion}
Visual anchor: ${plan.visual_anchor}

Keep recognizable clothing, relationships, setting cues, atmosphere, and important objects from the source image(s). Do not identify real people or infer sensitive traits. Reimagine the moment as a finished illustration, not a literal photo filter.
`.trim();
}

async function fetchWithTimeout(url, options, timeoutMs=OPENAI_TIMEOUT_MS){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(), timeoutMs);
  try{
    return await fetch(url,{...options,signal:controller.signal});
  }finally{
    clearTimeout(timer);
  }
}

async function callOpenAIWithImages(body, images){
  const form=new FormData();
  form.append("model", process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL);
  form.append("prompt", buildSnapshotPrompt(body));
  form.append("size", process.env.OPENAI_IMAGE_SIZE || "1024x1024");
  form.append("quality", process.env.OPENAI_IMAGE_QUALITY || "medium");
  form.append("output_format", "png");

  images.forEach((image,index)=>{
    const parsed=dataUrlToBlob(image.dataUrl);
    form.append("image", parsed.blob, `source-${index+1}.${parsed.extension}`);
  });

  return fetchWithTimeout(OPENAI_IMAGES_URL,{
    method:"POST",
    headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    body:form
  });
}

async function callOpenAITextOnly(body){
  return fetchWithTimeout(OPENAI_GENERATIONS_URL,{
    method:"POST",
    headers:{
      Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
      prompt: buildSnapshotPrompt(body),
      size: process.env.OPENAI_IMAGE_SIZE || "1024x1024",
      quality: process.env.OPENAI_IMAGE_QUALITY || "medium",
      output_format: "png"
    })
  });
}

export default async function handler(req,res){
  setCors(res);

  if(req.method==="OPTIONS") return res.status(204).end();
  if(req.method!=="POST") return jsonError(res,405,"POST only","method_not_allowed");
  if(!process.env.OPENAI_API_KEY) return jsonError(res,500,"AI service is not configured","missing_openai_key",true);

  try{
    const body=req.body || {};
    const validationError=validateSnapshotPackage(body);
    if(validationError){
      if(typeof validationError==="string") return jsonError(res,400,validationError,"invalid_snapshot_request");
      return jsonError(res,validationError.status,validationError.error,validationError.code);
    }

    const images=safeImages(body.images);
    const response=images.length ? await callOpenAIWithImages(body,images) : await callOpenAITextOnly(body);
    const raw=await response.text();
    let payload={};
    try{
      payload=raw ? JSON.parse(raw) : {};
    }catch{
      payload={error:{message:raw || "OpenAI image request failed"}};
    }

    if(!response.ok){
      const message=payload?.error?.message || "OpenAI image request failed";
      return res.status(response.status).json({
        error:message,
        code:response.status===429 ? "image_quota_unavailable" : "image_openai_failed",
        retryable:response.status===429 || response.status>=500
      });
    }

    const b64=payload?.data?.[0]?.b64_json;
    if(!b64) throw new Error("OpenAI returned no image data.");

    return res.status(200).json({
      image:{
        dataUrl:`data:image/png;base64,${b64}`,
        mimeType:"image/png"
      },
      model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL
    });
  }catch(error){
    console.error("snapshot-generate error",error);
    const message=String(error?.message || error);
    const lowerMessage=message.toLowerCase();
    const quotaProblem=error?.status===429 || lowerMessage.includes("no credits") || lowerMessage.includes("quota");
    const timeoutProblem=error?.name==="AbortError" || lowerMessage.includes("abort") || lowerMessage.includes("timeout");
    return res.status(quotaProblem ? 503 : 500).json({
      error: quotaProblem
        ? "AI image generation is temporarily unavailable. Please try again later."
        : timeoutProblem
          ? "AI image generation took too long. Please try again."
          : "Snapshot generation failed",
      code: quotaProblem ? "image_quota_unavailable" : timeoutProblem ? "image_timeout" : "image_failed",
      retryable: quotaProblem || timeoutProblem,
      detail: process.env.NODE_ENV==="development" ? message : undefined
    });
  }
}
