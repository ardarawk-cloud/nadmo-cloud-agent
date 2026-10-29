import { Script } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../worker.mjs';
import { renderUI } from '../web-ui.mjs';
const env={ OWNER_EMAIL:'owner@example.com', OWNER_TOKEN:'a-secure-owner-token-over-thirty-two-characters' };
function ctx(email){return { access: { async getIdentity(){return {email}} } }}
const get=(path,headers={})=>new Request('https://kai.test'+path,{headers});

test('browser UI requires verified Access owner identity, not an arbitrary bearer token', async()=>{
 const noctx=await handler.fetch(get('/'),env);
 assert.equal(noctx.status,401);
 const nonowner=await handler.fetch(get('/'),env,ctx('someone@example.com'));
 assert.equal(nonowner.status,401);
 const h=await handler.fetch(get('/',{Authorization:'Bearer '+env.OWNER_TOKEN}),env);
 assert.equal(h.status,401);
 const good=await handler.fetch(get('/'),env,ctx('OWNER@example.com'));
 assert.equal(good.status,200);
 assert.match(await good.text(),/KAI INDEPENDENT/);
 assert.match(good.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('access session reveals only verified owner email',async()=>{
 const unauthorized=await handler.fetch(get('/session'),env);
 assert.equal(unauthorized.status,401);
 const valid=await handler.fetch(get('/session'),env,ctx('owner@example.com'));
 assert.equal(valid.status,200);
 assert.deepEqual(await valid.json(),{authenticated:true,role:'OWNER',email:'owner@example.com'});
});

test('UI contains no hardcoded secrets and renders dynamic content with textContent',()=>{
 const html=renderUI('nonce-for-testing');
 assert.match(html,/nonce="nonce-for-testing"/);
 assert.match(html,/textContent/);
 assert.doesNotMatch(html,/OWNER_TOKEN/);
 assert.doesNotMatch(html,/localStorage/);
 assert.match(html,/Memori divisi/);
});

test('cross-origin requests with Access identity are rejected even if allowed by browser cookies',async()=>{
 const req=new Request('https://kai.test/memory',{method:'PUT',headers:{'Origin':'https://attacker.example','content-type':'application/json'},body:JSON.stringify({division:'acc-core',key:'danger',value:'ignore'})});
 const r=await handler.fetch(req,{...env,DB:{}},ctx('owner@example.com'));
 assert.equal(r.status,403);
 assert.equal((await r.json()).error,'cross_origin_denied');
});

test('rendered owner console JavaScript parses cleanly with Master tab',()=>{
 const html=renderUI('test-nonce-123');
 const openTag='<script nonce="test-nonce-123">';
 const start=html.indexOf(openTag);
 const end=html.indexOf('</script>',start);
 assert.ok(start>=0 && end>start,'UI inline script must be present');
 assert.doesNotThrow(()=>new Script(html.slice(start+openTag.length,end)));
 assert.match(html,/data-view="master"/);
 assert.match(html,/Master Knowledge ACC/);
});
test('verified owner can inspect locked master canon through API',async()=>{
 const r=await handler.fetch(get('/master?division=acc-core'),{...env,DB:{}},ctx('owner@example.com'));
 assert.equal(r.status,200);
 const body=await r.json();
 assert.equal(body.version,'1.0.0');
 assert.equal(body.locked,true);
 assert.match(body.core,/ARDA CORE CORPORATION/);
 assert.match(body.core,/PT Nadmo Studio Indonesia/);
 assert.equal((await handler.fetch(get('/master?division=acc-core'),{...env,DB:{}})).status,401);
});
