export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return new Response(JSON.stringify({ok:true,service:"nadmo-finance"}), {headers:{"Content-Type":"application/json"}});
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    return new Response(JSON.stringify({error:"Not found"}), {status:404,headers:{"Content-Type":"application/json"}});
  }
};
