import test from "node:test";
import assert from "node:assert/strict";
import worker,{FREE_MODELS,validateInput,extractText,runChain,ready} from "../src/worker.mjs";
const messages=[{role:"user",content:"Halo KAI"}];
const env={AI:{async run(){throw Error("Live inference prohibited in tests");}},KAI_ROUTER_TOKEN:"local-only"};
test("only supported Cloudflare Workers AI models, no paid providers",()=>{
  assert.deepEqual(FREE_MODELS.map(x=>x.id),["@cf/zai-org/glm-4.7-flash","@cf/google/gemma-4-26b-a4b-it"]);
});
test("bounds request size, disables streaming",()=>{
  assert.throws(()=>validateInput({messages,stream:true}),/non-streaming/);
  assert.throws(()=>validateInput({messages,max_tokens:257}),/1-256/);
  assert.throws(()=>validateInput({messages:[{role:"user",content:"A".repeat(1501)}]}),/Invalid/);
});
test("normalizes AI output formats",()=>{
  assert.equal(extractText({response:"Hello"}),"Hello");
  assert.equal(extractText({choices:[{message:{content:"Hi"}}]}),"Hi");
});
test("model one succeeds",async()=>{
  const calls=[];
  const o=await runChain(env,messages,128,async (id,body)=>{
    calls.push(id);
    assert.equal(body.max_completion_tokens,128);
    return {response:"GLM works"};
  });
  assert.equal(o.answer,"GLM works");
  assert.equal(o.fallback,false);
  assert.deepEqual(calls,[FREE_MODELS[0].id]);
});
test("fallback to free Gemma after GLM fails",async()=>{
  const calls=[];
  const o=await runChain(env,messages,128,async id=>{
    calls.push(id);
    if(calls.length===1)throw Error("unavailable");
    return {choices:[{message:{content:"Gemma works"}}]};
  });
  assert.equal(o.answer,"Gemma works");
  assert.equal(o.fallback,true);
  assert.deepEqual(calls,FREE_MODELS.map(x=>x.id));
});
test("quota error stops retry to protect shared free quota",async()=>{
  let attempts=0;
  const o=await runChain(env,messages,128,async ()=>{
    attempts++;
    throw Object.assign(Error("daily limit"),{code:"quota_exceeded"});
  });
  assert.equal(o.error,"FREE_MODELS_UNAVAILABLE");
  assert.equal(attempts,1);
});
test("both unavailable returns explicit error",async()=>{
  const o=await runChain(env,messages,128,async()=>{throw Error("timeout");});
  assert.equal(o.failures.length,2);
});
test("absent secret disables chat even with AI binding",async()=>{
  const o=await worker.fetch(new Request("https://invalid/v1/chat/completions",{method:"POST",body:JSON.stringify({messages})}),{AI:env.AI});
  assert.equal(o.status,503);
  assert.equal(ready({AI:env.AI}),false);
});
test("auth denies unauthorized request",async()=>{
  const o=await worker.fetch(new Request("https://invalid/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer wrong"},body:JSON.stringify({messages})}),env);
  assert.equal(o.status,401);
});
test("health does not reveal secrets",async()=>{
  const o=await worker.fetch(new Request("https://invalid/health"),env);
  assert.equal(o.status,200);
  assert.ok(!(await o.text()).includes("local-only"));
});
