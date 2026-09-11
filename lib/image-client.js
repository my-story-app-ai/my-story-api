const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/edits";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 110000);

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

export async function fetchWithTimeout(url, options, timeoutMs=OPENAI_TIMEOUT_MS){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(), timeoutMs);
  try{
    return await fetch(url,{...options,signal:controller.signal});
  }finally{
    clearTimeout(timer);
  }
}

export async function callOpenAIWithImages(prompt, images){
  const form=new FormData();
  form.append("model", process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL);
  form.append("prompt", prompt);
  form.append("size", process.env.OPENAI_IMAGE_SIZE || "1024x1024");
  form.append("quality", process.env.OPENAI_IMAGE_QUALITY || "medium");
  form.append("output_format", "png");

  images.forEach((image,index)=>{
    const parsed=dataUrlToBlob(image.dataUrl);
    form.append(images.length > 1 ? "image[]" : "image", parsed.blob, `source-${index+1}.${parsed.extension}`);
  });

  return fetchWithTimeout(OPENAI_IMAGES_URL,{
    method:"POST",
    headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},
    body:form
  });
}

