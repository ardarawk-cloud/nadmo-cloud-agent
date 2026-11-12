import test from "node:test";
import assert from "node:assert/strict";
import worker, { validateInput, runChain, extractText } from "../src/worker.mjs";

const env = {
  CF_ACCOUNT_ID: "fake-account",
  CF_GATEWAY_ID: "kai-failover-staging",
  CF_AIG_TOKEN: "fake-cf-token",
  KAI_ROUTER_TOKEN: "fake-router-token"
};
const messages = [{ role: "user", content: "hello" }];
const chatReply = (text) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const claudeReply = (text) => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });

test("rejects invalid request and unsupported streaming", () => {
  assert.throws(() => validateInput({ stream: true, messages }), /non-streaming/);
  assert.throws(() => validateInput({ messages: [{ role: "user", content: "x".repeat(2501) }] }), /2500/);
});
test("primary provider succeeds", async () => {
  const calls = [];
  const result = await runChain(env, messages, 256, async (u, options) => {
    calls.push(JSON.parse(options.body).model);
    assert.equal(options.headers["cf-aig-gateway-id"], env.CF_GATEWAY_ID);
    return chatReply("openai works");
  });
  assert.equal(result.answer, "openai works");
  assert.equal(result.step.provider, "openai");
  assert.equal(result.usedFallback, false);
  assert.deepEqual(calls, ["openai/gpt-5.5"]);
});
test("falls back to Claude on primary upstream failure", async () => {
  const calls = [];
  const result = await runChain(env, messages, 256, async (u, options) => {
    const p = JSON.parse(options.body);
    calls.push(p.model);
    return calls.length === 1 ? new Response("unavailable", { status: 503 }) : claudeReply("claude works");
  });
  assert.equal(result.answer, "claude works");
  assert.equal(result.step.provider, "anthropic");
  assert.equal(result.usedFallback, true);
  assert.deepEqual(calls, ["openai/gpt-5.5", "anthropic/claude-sonnet-5.5"]);
});
test("falls back to Gemini when first two fail", async () => {
  const calls = [];
  const result = await runChain(env, messages, 256, async (u, options) => {
    calls.push(JSON.parse(options.body).model);
    return calls.length < 3 ? new Response("unavailable", { status: 502 }) : chatReply("gemini works");
  });
  assert.equal(result.step.provider, "google");
  assert.equal(result.answer, "gemini works");
  assert.equal(result.attempts, 3);
});
test("halts chain on Cloudflare authentication failure", async () => {
  let count = 0;
  const result = await runChain(env, messages, 256, async () => {
    count++;
    return new Response("forbidden", { status: 403 });
  });
  assert.equal(result.error, "NO_PROVIDER_AVAILABLE");
  assert.equal(count, 1);
});
test("missing secrets fail closed with no vendor request", async () => {
  const response = await worker.fetch(new Request("https://example.invalid/v1/chat/completions", {
    method: "POST", body: JSON.stringify({ messages }), headers: { Authorization: "Bearer bogus" }
  }), { CF_GATEWAY_ID: "kai-failover-staging" });
  assert.equal(response.status, 503);
});
test("wrong authorization blocks a fully configured router", async () => {
  const response = await worker.fetch(new Request("https://example.invalid/v1/chat/completions", {
    method: "POST", body: JSON.stringify({ messages }), headers: { Authorization: "Bearer bad" }
  }), env);
  assert.equal(response.status, 401);
});
test("health endpoint has no secrets", async () => {
  const response = await worker.fetch(new Request("https://example.invalid/health"), env);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(body.includes("fake-cf-token"), false);
  assert.equal(body.includes("fake-router-token"), false);
});
