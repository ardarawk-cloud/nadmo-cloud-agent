import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import handler from '../worker.mjs';
const TOKEN = 'a-secure-testing-token-that-is-over-32-characters-long';
const schema = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8');

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  return {
    prepare(sql) {
      const prepared = db.prepare(sql);
      return {
        bind(...values) {
          return {
            async first() { return prepared.get(...values) || null; },
            async all() { return { results: prepared.all(...values) }; },
            async run() { const o = prepared.run(...values); return { success: true, meta: { changes: Number(o.changes) } }; },
          };
        },
      };
    },
    async batch(statements) { return Promise.all(statements.map(s => s.run())); },
  };
}
function makeEnv() {
  const calls = [];
  return { OWNER_TOKEN:TOKEN, DB:fakeD1(), AI: { async run(model, payload) {
    calls.push({model,payload});
    return { response: 'Berdasarkan bukti yang tersedia, klaim ini belum terverifikasi.' };
  } }, calls };
}
function req(path, method='GET', body, token=TOKEN) {
  const headers = { ...(token ? {'Authorization':`Bearer ${token}`} : {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://kai-independent-lab.example${path}`, {method,headers,body:body === undefined ? undefined : JSON.stringify(body)});
}
async function call(env, path, method='GET', body, token=TOKEN) {
  const r = await handler.fetch(req(path,method,body,token),env);
  return {httpStatus:r.status,...await r.json()};
}

test('health only publicly accessible; owner token protects all other endpoints', async () => {
  const env = makeEnv();
  assert.equal((await call(env,'/health','GET',undefined,null)).httpStatus,200);
  assert.equal((await call(env,'/memory?division=acc-core','GET',undefined,null)).httpStatus,401);
  assert.equal((await call(env,'/chat','POST',{division:'acc-core',message:'x'},'wrong')).httpStatus,401);
  assert.equal((await call({...env, OWNER_TOKEN:undefined},'/chat','POST',{division:'acc-core',message:'x'})).httpStatus,503);
});

test('memory is durable through DB connection and isolated by division', async () => {
  const env = makeEnv();
  assert.equal((await call(env,'/memory','PUT',{division:'acc-core',key:'rule',value:'Do not fabricate'})).ok,true);
  const a = await call(env,'/memory?division=acc-core');
  const b = await call(env,'/memory?division=distorsi-rakyat');
  assert.equal(a.memories[0].value,'Do not fabricate');
  assert.equal(b.memories.length,0);
  await call(env,'/memory?division=acc-core&key=rule','DELETE');
  assert.equal((await call(env,'/memory?division=acc-core')).memories.length,0);
});

test('chat calls model and stores thread history; never claims live web search', async () => {
  const env = makeEnv();
  const r = await call(env,'/chat','POST',{division:'distorsi-rakyat',message:'Apa status bukti aksi demo?',thread_id:'investigasi'});
  assert.equal(r.httpStatus,200);
  assert.equal(r.web_search_performed,false);
  assert.match(r.reply,/belum terverifikasi/);
  assert.equal(env.calls.length,1);
  assert.equal(env.calls[0].model,'@cf/qwen/qwen3-30b-a3b-fp8');
  await call(env,'/chat','POST',{division:'distorsi-rakyat',message:'Lanjutkan',thread_id:'investigasi'});
  assert.equal(env.calls[1].payload.messages.some(m=>m.role==='assistant'),true);
  await call(env,'/chat','POST',{division:'acc-core',message:'Pekerjaan lain',thread_id:'investigasi'});
  assert.equal(env.calls[2].payload.messages.some(m=>m.content==='Lanjutkan'),false);
});

test('evidence cannot leak between divisions or be claimed as verified',async () => {
  const env=makeEnv();
  const e=await call(env,'/evidence','POST',{division:'distorsi-rakyat',title:'Catatan warga',url:'https://example.org/report',excerpt:'Laporan perlu diverifikasi.'});
  assert.equal(e.httpStatus,201); assert.equal(e.verification,'user_supplied_unverified');
  const denial=await call(env,'/chat','POST',{division:'acc-core',message:'Apa isinya?',evidence_ids:[e.id]});
  assert.equal(denial.error,'evidence_not_found_for_division');
  const r=await call(env,'/chat','POST',{division:'distorsi-rakyat',message:'Ringkas',evidence_ids:[e.id]});
  assert.equal(r.source_refs[0].url,'https://example.org/report');
  assert.equal(r.source_refs[0].verification,'user_supplied_unverified');
  assert.equal(r.web_search_performed,false);
  assert.equal((await call(env,'/evidence','POST',{division:'acc-core',title:'Bad',url:'http://localhost/',excerpt:'x'})).httpStatus,400);
});

test('draft approval is not a publication and is not repeatable', async () => {
  const env=makeEnv();
  const d=await call(env,'/drafts','POST',{division:'distorsi-rakyat',title:'Draft',content:'Isi laporan yang memerlukan verifikasi.'});
  assert.equal(d.httpStatus,201); assert.equal(d.published,false);
  const a=await call(env,`/drafts/${d.id}/approve`,'POST');
  assert.equal(a.status,'APPROVED'); assert.equal(a.published,false);
  assert.equal((await call(env,`/drafts/${d.id}/approve`,'POST')).error,'draft_not_found_or_already_approved');
});

test('reject invalid divisions, oversized bodies and empty model outputs', async () => {
  const env=makeEnv();
  assert.equal((await call(env,'/chat','POST',{division:'unknown',message:'X'})).httpStatus,400);
  assert.equal((await call(env,'/chat','POST',{division:'acc-core',message:'x'.repeat(24000)})).httpStatus,413);
  env.AI.run=async()=>({response:''});
  assert.equal((await call(env,'/chat','POST',{division:'acc-core',message:'Hai'})).httpStatus,502);
});
