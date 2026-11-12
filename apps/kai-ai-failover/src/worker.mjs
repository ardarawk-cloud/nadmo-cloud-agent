// KAI AI Failover v0.1 — staging, no tool execution or implicit billing.
// OpenAI -> Anthropic -> Google, via authenticated Cloudflare AI Gateway REST API.
// The router fails closed until BOTH KAI_ROUTER_TOKEN and CF_AIG_TOKEN are secrets.
const STEPS = Object.freeze([
  { provider: "openai", model: "openai/gpt-5.5", route: "/ai/v1/chat/completions" },
  { provider: "anthropic", model: "anthropic/claude-sonnet-5.5", route: "/ai/v1/messages" },
  { provider: "google", model: "google/gemini-3.8-flash", route: "/ai/v1/chat/completions" }
]);
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const ENCODER = new TextEncoder();

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}
function configured(env) {
  return !!(env.KAI_ROUTER_TOKEN && env.CF_AIG_TOKEN && env.CF_ACCOUNT_ID && env.CF_GATEWAY_ID);
}
async function equalSecret(a, b) {
  const [ah, bh] = await Promise.all([
    crypto.subtle.digest("SHA-256", ENCODER.encode(a)),
    crypto.subtle.digest("SHA-256", ENCODER.encode(b))
  ]);
  const left = new Uint8Array(ah);
  const right = new Uint8Array(bh);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0 && !!a && !!b;
}
export function validateInput(data) {
  if (!data || typeof data !== "object" || data.stream === true || !Array.isArray(data.messages)) {
    throw new Error("Provide non-streaming messages array.");
  }
  if (data.messages.length < 1 || data.messages.length > 8) {
    throw new Error("Messages must contain 1-8 entries.");
  }
  let length = 0;
  const messages = data.messages.map(item => {
    if (!item || !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string") {
      throw new Error("Only text system, user and assistant messages are supported.");
    }
    if (!item.content.trim() || item.content.length > 2500) {
      throw new Error("Message content must be between 1 and 2500 characters.");
    }
    length += item.content.length;
    return { role: item.role, content: item.content };
  });
  if (length > 9000 || messages[messages.length - 1].role !== "user") {
    throw new Error("Input too long or last message is not from user.");
  }
  const maxTokens = data.max_tokens === undefined ? 256 : Number(data.max_tokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) {
    throw new Error("max_tokens must be 1-1024.");
  }
  return { messages, maxTokens };
}
function payload(step, messages, maxTokens) {
  if (step.provider === "anthropic") {
    const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
    const result = {
      model: step.model,
      max_tokens: maxTokens,
      messages: messages.filter(m => m.role !== "system")
    };
    if (system) result.system = system;
    return result;
  }
  return { model: step.model, messages, max_completion_tokens: maxTokens, stream: false };
}
export function extractText(step, raw) {
  const d = raw && typeof raw === "object" && raw.result ? raw.result : raw;
  if (!d || typeof d !== "object") return "";
  if (step.provider === "anthropic") {
    return (Array.isArray(d.content) ? d.content : []).filter(c => c && c.type === "text")
      .map(c => c.text || "").join("\n").trim();
  }
  const content = d.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map(c => c.text || "").join("\n").trim();
  return "";
}
export async function runChain(env, messages, maxTokens, fetchImpl = fetch) {
  const failed = [];
  for (const step of STEPS) {
    try {
      const url = "https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID + step.route;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + env.CF_AIG_TOKEN,
          "cf-aig-gateway-id": env.CF_GATEWAY_ID,
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        },
        body: JSON.stringify(payload(step, messages, maxTokens)),
        signal: AbortSignal.timeout(14000)
      });
      if (!response.ok) {
        failed.push({ provider: step.provider, status: response.status });
        // Invalid Cloudflare authentication cannot be recovered by changing the vendor.
        if (response.status === 401 || response.status === 403) break;
        continue;
      }
      const raw = await response.json();
      if (raw?.success === false) {
        failed.push({ provider: step.provider, status: "upstream_error" });
        continue;
      }
      const answer = extractText(step, raw);
      if (!answer) {
        failed.push({ provider: step.provider, status: "empty_reply" });
        continue;
      }
      return { step, answer, usedFallback: failed.length > 0, attempts: failed.length + 1 };
    } catch (_e) {
      failed.push({ provider: step.provider, status: "network_or_timeout" });
    }
  }
  return { error: "NO_PROVIDER_AVAILABLE", failed };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return reply({
        service: "kai-ai-failover-staging", mode: "staging", operational: false,
        router_credentials_ready: configured(env),
        providers: STEPS.map(x => x.provider),
        gateway: env.CF_GATEWAY_ID || "not_configured",
        note: "Only routing foundation is deployed; vendor access and billing are not yet verified."
      });
    }
    if (url.pathname !== "/v1/chat/completions") return reply({ error: "Not found" }, 404);
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    if (!configured(env)) return reply({ error: "Router inactive: secret configuration incomplete." }, 503);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!(await equalSecret(token, env.KAI_ROUTER_TOKEN))) return reply({ error: "Unauthorized" }, 401);
    if (Number(request.headers.get("Content-Length") || 0) > 12000) {
      return reply({ error: "Request too large" }, 413);
    }
    let data;
    try {
      const body = await request.text();
      if (body.length > 12000) return reply({ error: "Request too large" }, 413);
      data = validateInput(JSON.parse(body));
    } catch (error) {
      return reply({ error: "Invalid input", detail: String(error.message).slice(0,120) }, 400);
    }
    const result = await runChain(env, data.messages, data.maxTokens);
    if (result.error) return reply({ error: result.error, attempts: result.failed.length }, 503);
    return reply({
      id: "kai-" + crypto.randomUUID(),
      object: "chat.completion",
      model: result.step.model,
      choices: [{ index: 0, message: { role: "assistant", content: result.answer }, finish_reason: "stop" }],
      kai: { provider: result.step.provider, failover: result.usedFallback, attempts: result.attempts }
    });
  }
};
