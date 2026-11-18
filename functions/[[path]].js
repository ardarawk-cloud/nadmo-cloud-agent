// ACC HQ Pages Functions control plane. All operations fail closed without bindings.
// No agent execution is implemented; task status is never auto-completed.
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...extra}});
const enc=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
async function mac(secret,message){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",key,enc.encode(message)));}
function cookie(request){return (request.headers.get("cookie")||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("acc_owner="))?.slice(10)||"";}
async function authenticated(request,secret){const value=cookie(request),parts=value.split(".");if(parts.length!==2||!/^\d+$/.test(parts[0])||Number(parts[0])<=Date.now()/1000)return false;return (await mac(secret,parts[0]))===parts[1];}
async function body(request){try{return await request.json()}catch{return null}}
const uid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
export async function onRequest(context){
 const {request,env}=context,url=new URL(request.url),path=url.pathname;
 if(!/^\/(health|state|auth\/(login|logout)|goals|tasks|approvals|events)(\/|$)/.test(path))return context.next();
 if(path==="/health"&&request.method==="GET")return json({ok:!!(env.ACC_HQ_DB&&env.ACC_HQ_OWNER_TOKEN),service:"acc-kai-core",mode:"CONTROL_PLANE_ONLY",storage:env.ACC_HQ_DB?"D1":"UNBOUND"});
 if(!env.ACC_HQ_DB||!env.ACC_HQ_OWNER_TOKEN)return json({error:"backend_not_configured"},503);
 const origin=request.headers.get("origin"),expected=url.origin;
 if(request.method!=="GET"&&request.method!=="HEAD"&&origin!==expected)return json({error:"origin_not_allowed"},403);
 if(path==="/auth/login"&&request.method==="POST"){
  const b=await body(request);if(!b||typeof b.token!=="string"||b.token!==env.ACC_HQ_OWNER_TOKEN)return json({error:"unauthorized"},401);
  const expiry=String(Math.floor(Date.now()/1000)+8*3600),sig=await mac(env.ACC_HQ_OWNER_TOKEN,expiry);
  return json({authenticated:true},200,{"set-cookie":`acc_owner=${expiry}.${sig}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`});
 }
 if(!await authenticated(request,env.ACC_HQ_OWNER_TOKEN))return json({error:"unauthorized"},401);
 if(path==="/auth/logout"&&request.method==="POST")return json({authenticated:false},200,{"set-cookie":"acc_owner=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"});
 const db=env.ACC_HQ_DB;
 try{
  if(path==="/state"&&request.method==="GET"){
   const [goals,tasks,approvals,events]=await Promise.all([
    db.prepare("SELECT payload_json FROM acc_hq_goals ORDER BY created_at DESC LIMIT 100").all(),
    db.prepare("SELECT payload_json FROM acc_hq_tasks ORDER BY created_at DESC LIMIT 100").all(),
    db.prepare("SELECT id,task_id,status,created_at,resolved_at,decision,note FROM acc_hq_approvals ORDER BY created_at DESC LIMIT 100").all(),
    db.prepare("SELECT id,event_type AS type,created_at AS timestamp,payload_json FROM acc_hq_events ORDER BY created_at DESC LIMIT 50").all()
   ]);
   return json({mode:"CONTROL_PLANE_ONLY",kai:{status:"IDLE"},goals:goals.results.map(x=>JSON.parse(x.payload_json)),tasks:tasks.results.map(x=>JSON.parse(x.payload_json)),approvals:approvals.results,events:events.results.map(x=>({...x,payload:JSON.parse(x.payload_json)}))});
  }
  if(path==="/goals"&&request.method==="POST"){
   const b=await body(request);if(!b||typeof b.title!=="string"||!b.title.trim()||b.title.length>200||typeof b.division!=="string"||!b.division.trim()||b.division.length>80)return json({error:"invalid_goal"},400);
   const g={id:uid(),title:b.title.trim(),division:b.division.trim(),priority:"NORMAL",status:"ROUTING",created_at:now()};
   await db.prepare("INSERT INTO acc_hq_goals (id,title,division,priority,status,created_at,payload_json) VALUES (?,?,?,?,?,?,?)").bind(g.id,g.title,g.division,g.priority,g.status,g.created_at,JSON.stringify(g)).run();
   return json(g,201);
  }
  if(path==="/tasks"&&request.method==="POST"){
   const b=await body(request);if(!b||typeof b.title!=="string"||!b.title.trim()||b.title.length>200||typeof b.agent_id!=="string"||!b.agent_id.trim()||typeof b.division!=="string"||!b.division.trim())return json({error:"invalid_task"},400);
   const t={id:uid(),title:b.title.trim(),agent_id:b.agent_id.trim(),division:b.division.trim(),goal_id:b.goal_id||null,status:"WAITING_DEPENDENCY",progress:0,created_at:now()};
   await db.prepare("INSERT INTO acc_hq_tasks (id,goal_id,title,agent_id,division,status,progress,created_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?)").bind(t.id,t.goal_id,t.title,t.agent_id,t.division,t.status,0,t.created_at,JSON.stringify(t)).run();
   return json(t,201);
  }
  if(/^\/tasks\/[^/]+\/complete$/.test(path)&&request.method==="POST")return json({error:"executor_evidence_required"},409);
  const approvalMatch=path.match(/^\/approvals\/([^/]+)$/);
  if(approvalMatch&&request.method==="POST"){
   const b=await body(request);
   if(!b||!["APPROVE","REJECT"].includes(b.decision))return json({error:"invalid_decision"},400);
   const id=decodeURIComponent(approvalMatch[1]),existing=await db.prepare("SELECT id,status FROM acc_hq_approvals WHERE id=?").bind(id).first();
   if(!existing)return json({error:"approval_not_found"},404);
   if(existing.status!=="WAITING_OWNER")return json({error:"approval_already_resolved"},409);
   const status=b.decision==="APPROVE"?"APPROVED":"REJECTED";
   await db.prepare("UPDATE acc_hq_approvals SET status=?,decision=?,resolved_at=? WHERE id=? AND status='WAITING_OWNER'").bind(status,b.decision,now(),id).run();
   return json({id,status,decision:b.decision});
  }
  if(/^\/tasks\/[^/]+\/start$/.test(path)&&request.method==="POST")return json({error:"executor_not_configured"},409);
  if(path==="/events"&&request.method==="GET"){const rows=await db.prepare("SELECT id,event_type AS type,created_at AS timestamp,payload_json FROM acc_hq_events ORDER BY created_at DESC LIMIT 50").all();return json(rows.results.map(x=>({...x,payload:JSON.parse(x.payload_json)})));}
  return json({error:"not_found"},404);
 }catch(error){return json({error:"storage_operation_failed"},500)}
}
