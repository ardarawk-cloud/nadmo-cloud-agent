// KAI AI Failover v0.2: ONLY Cloudflare Workers AI (free-first).
// Independent of commercial OpenAI, Claude, and Gemini API keys.
export const FREE_MODELS = Object.freeze([
  { id: "@cf/zai-org/glm-4.7-flash", label: "GLM-4.7-Flash" },
  { id: "@cf/google/gemma-4-26b-a4b-it", label: "Gemma-4-26B" }
]);
const MAX_BODY = 6000;
const ENCODER = new TextEncoder();
function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }});
}
export function ready(env) {
  return !!(env?.AI && typeof env.AI.run === "function" && env.KAI_ROUTER_TOKEN);
}
async function secretEqual(input, expected) {
  const [a,b] = await Promise.all([
    crypto.subtle.digest("SHA-256", ENCODER.encode(input)),
    crypto.subtle.digest("SHA-256", ENCODER.encode(expected))
  ]);
  const aa=new Uint8Array(a), bb=new Uint8Array(b);
  let diff=0;
  for(let i=0;i<aa.length;i++) diff|=aa[i]^bb[i];
  return diff===0 && !!input && !!expected;
}
export function validateInput(data) {
  if (!data || !Array.isArray(data.messages) || data.stream === true) throw Error("Only non-streaming text messages.");
  if (data.messages.length<1 || data.messages.length>6) throw Error("Expected 1-6 messages.");
  let length=0;
  const messages=data.messages.map(m=>{
    if(!m || !["system","user","assistant"].includes(m.role) || typeof m.content!=="string" ||
       !m.content.trim() || m.content.length>1500) throw Error("Invalid role or message length.");
    length+=m.content.length;
    return {role:m.role,content:m.content};
  });
  if(length>4000 || messages[messages.length-1].role!=="user") throw Error("Too much text or last message not user.");
  const maxTokens = data.max_tokens === undefined ? 128 : Number(data.max_tokens);
  if(!Number.isInteger(maxTokens) || maxTokens<1 || maxTokens>256) throw Error("max_tokens must be 1-256.");
  return {messages,maxTokens};
}
export function extractText(data) {
  const d=data && typeof data==="object" && data.result ? data.result : data;
  if(typeof d==="string") return d.trim();
  if(!d || typeof d!=="object") return "";
  const v=d.response ?? d.choices?.[0]?.message?.content ?? d.output?.[0]?.content?.[0]?.text;
  if(typeof v==="string") return v.trim();
  if(Array.isArray(v)) return v.map(x=>typeof x==="string"?x:(x?.text||"")).join("\n").trim();
  return "";
}
export async function runChain(env,messages,maxTokens,invoke) {
  if (!env?.AI || typeof env.AI.run!=="function") return {error:"AI_BINDING_MISSING",failures:[]};
  const run=invoke||((id,payload)=>env.AI.run(id,payload));
  const failures=[];
  for(const model of FREE_MODELS) {
    try {
      const data=await run(model.id,{messages,max_completion_tokens:maxTokens,stream:false,chat_template_kwargs:{enable_thinking:false}});
      const answer=extractText(data);
      if(answer) return {answer,model,fallback:failures.length>0,attempts:failures.length+1};
      failures.push({model:model.label,status:"empty_reply"});
    } catch(e) {
      const code=String(e?.code || e?.message || "inference_error").slice(0,80);
      failures.push({model:model.label,status:"unavailable"});
      if(/quota|neurons|daily.limit|10051|10052/i.test(code)) break;
    }
  }
  return {error:"FREE_MODELS_UNAVAILABLE",failures};
}
export default {
  async fetch(request,env) {
    const pathname=new URL(request.url).pathname;
    if(pathname==="/health" && request.method==="GET") return json({
      service:"kai-ai-failover-staging",version:"0.2.0",mode:"cloudflare-workers-ai-free-first",
      configured:ready(env),models:FREE_MODELS.map(x=>x.id),
      warning:"Free daily quota shared across account; Workers Paid overage may be billed."
    });
    if(pathname!=="/v1/chat/completions") return json({error:"Not found"},404);
    if(request.method!=="POST") return json({error:"Method not allowed"},405);
    if(!ready(env)) return json({error:"Private router not enabled."},503);
    const h=request.headers.get("Authorization")||"";
    const token=h.startsWith("Bearer ")?h.slice(7):"";
    if(!(await secretEqual(token,env.KAI_ROUTER_TOKEN))) return json({error:"Unauthorized"},401);
    if(Number(request.headers.get("Content-Length")||0)>MAX_BODY) return json({error:"Body too large"},413);
    let input;
    try {
      const body=await request.text();
      if(body.length>MAX_BODY) return json({error:"Body too large"},413);
      input=validateInput(JSON.parse(body));
    } catch(e) {
      return json({error:"Invalid input",detail:String(e?.message||"invalid").slice(0,110)},400);
    }
    const output=await runChain(env,input.messages,input.maxTokens);
    if(output.error) return json({error:output.error,attempts:output.failures.length},503);
    return json({
      id:"kai-"+crypto.randomUUID(),object:"chat.completion",model:output.model.id,
      choices:[{index:0,message:{role:"assistant",content:output.answer},finish_reason:"stop"}],
      kai:{provider:"cloudflare-workers-ai",fallback:output.fallback,
        selected:output.model.label,attempts:output.attempts}
    });
  }
};
