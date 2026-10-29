// Self-contained, dependency-free owner UI. All user/model content is rendered as textContent.
const DOCUMENT = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>KAI INDEPENDENT | NADMO</title>
<style nonce="NONCE_PLACEHOLDER">
:root{color-scheme:dark;--bg:#080d15;--card:#101b2a;--muted:#91a7bd;--ink:#ebf5fc;--accent:#55e5df;--warn:#ffbd69;--border:#284050}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 60% -10%,#173244 0,transparent 43%),var(--bg);color:var(--ink);font:15px/1.5 system-ui,Segoe UI,Arial,sans-serif}
button,input,textarea,select{font:inherit}button{cursor:pointer;border-radius:9px;border:1px solid var(--border);background:#163047;color:var(--ink);padding:10px 14px}button:hover{border-color:var(--accent)}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button:disabled{opacity:.55;cursor:wait}input,textarea,select{width:100%;background:#0b1623;color:var(--ink);border:1px solid var(--border);border-radius:9px;padding:11px;resize:vertical}
a{color:var(--accent)}.layout{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:100dvh}.side{border-right:1px solid var(--border);background:#0d1725;padding:23px 17px;display:flex;flex-direction:column;gap:16px}
.brand{font-weight:850;letter-spacing:.12em;font-size:19px}.brand span{color:var(--accent)}.tiny{font-size:12px;color:var(--muted)}.pill{display:inline-block;border:1px solid #347568;border-radius:99px;color:#9cf1df;font-size:11px;padding:4px 8px;letter-spacing:.04em}
.stack{display:grid;gap:9px}.side label{font-size:12px;color:var(--muted)}.menu-btn{width:100%;text-align:left;background:transparent}.menu-btn.active{background:#18374a;border-color:#3d8b8a}
.main{display:flex;min-width:0;flex-direction:column;max-height:100dvh}.top{border-bottom:1px solid var(--border);padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px}
h1{font-size:20px;margin:0}h2{font-size:18px;margin:0 0 13px}.hint{color:var(--muted);font-size:12px}.panel{flex:1;overflow:auto;min-height:0;padding:22px}.chat{max-width:850px;margin:0 auto;min-height:100%;display:flex;flex-direction:column}
#messages{flex:1;display:flex;flex-direction:column;gap:14px;padding:16px 0 30px}.bubble{max-width:90%;border:1px solid var(--border);padding:15px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.bubble.user{background:#16354a;align-self:flex-end}.bubble.assistant{background:#111e2e;align-self:flex-start}.who{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:5px}.composer{border-top:1px solid var(--border);padding:16px 22px;background:#0b1520}
.composer form{max-width:850px;margin:auto;display:grid;gap:9px}.compose-row{display:flex;gap:8px;align-items:end}.send{background:#12665f;border-color:#3ba6a0;color:white;min-width:102px}
.box{border:1px solid var(--border);padding:17px;border-radius:12px;background:rgba(18,32,46,.75);margin-bottom:16px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.data-row{padding:13px 0;border-bottom:1px solid var(--border);overflow-wrap:anywhere}.data-row:last-child{border-bottom:0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.row-between{display:flex;justify-content:space-between;align-items:center;gap:12px}
#notice{min-height:22px;padding:6px 22px;font-size:12px;color:var(--warn)}.hidden{display:none!important}
footer{margin-top:auto;padding-top:12px;border-top:1px solid var(--border)}.danger{color:var(--warn)}
@media(max-width:780px){.layout{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid var(--border);padding:12px;gap:10px}.brand{font-size:16px}.side .stack{display:flex;flex-wrap:wrap;align-items:center}.side select,.side input{width:auto;min-width:130px;flex:1}.side .stack label{display:none}.nav{display:flex;gap:6px}.menu-btn{text-align:center;font-size:12px;padding:8px}.main{max-height:calc(100dvh - 170px)}.top{padding:10px 13px}h1{font-size:17px}.panel{padding:10px}.composer{padding:10px}.grid{grid-template-columns:1fr}.bubble{max-width:96%}}
</style>
</head>
<body>
<div class="layout">
<aside class="side">
 <div class="brand">KAI <span>INDEPENDENT</span></div>
 <div class="tiny">NADMO / ACC PRIVATE LAB</div><div><span class="pill">MODEL TERBUKA · v0.2</span></div>
 <div class="stack"><label for="division">DIVISI / PASSPORT</label>
 <select id="division" aria-label="Divisi"><option value="acc-core">ACC CORE</option><option value="nadmo-studio">NADMO STUDIO</option><option value="distorsi-rakyat">DISTORSI RAKYAT</option></select></div>
 <div class="stack"><label for="thread">ID PERCAKAPAN</label><input id="thread" value="main" maxlength="80" aria-label="ID percakapan"/></div>
 <nav class="nav stack" aria-label="Menu"><button class="menu-btn active" data-view="chat">Percakapan</button><button class="menu-btn" data-view="memory">Memori</button><button class="menu-btn" data-view="evidence">Sumber</button><button class="menu-btn" data-view="drafts">Draf</button></nav>
 <button id="new-thread">+ Percakapan baru</button>
 <footer><div class="tiny" id="session">Memeriksa sesi…</div><div class="tiny">Privat · Tidak ada publish otomatis · Tidak ada riset web otomatis</div></footer>
</aside>
<main class="main">
 <header class="top"><div><h1 id="page-title">Percakapan KAI</h1><div class="hint">Bukti di atas narasi. Kritis, transparan, dapat diuji.</div></div><span class="pill" id="connection">MEMERIKSA</span></header>
 <section class="panel" id="chat-view"><div class="chat"><div id="messages"><div class="bubble assistant"><div class="who">KAI</div>Pilih divisi dan mulai percakapan. Aku tidak akan mengaku melakukan riset web kalau belum benar-benar dilakukan.</div></div></div></section>
 <section class="panel hidden" id="memory-view"><h2>Memori divisi</h2><div class="box"><form id="memory-form" class="stack"><label for="memory-key">Kunci memori</label><input id="memory-key" maxlength="80" required placeholder="contoh: prinsip_editorial"><label for="memory-value">Isi memori</label><textarea id="memory-value" rows="3" maxlength="2000" required placeholder="Simpan keputusan atau konteks tetap"></textarea><button type="submit">Simpan memori</button></form></div><div id="memory-items" class="box">Memuat...</div></section>
 <section class="panel hidden" id="evidence-view"><h2>Daftar sumber</h2><p class="hint">Sumber yang dimasukkan di sini BELUM diverifikasi independen. Pilih ID sumber saat mengobrol untuk melampirkannya.</p><div class="box"><form id="evidence-form" class="stack"><label for="ev-title">Judul</label><input id="ev-title" maxlength="200" required><label for="ev-url">URL sumber HTTPS</label><input id="ev-url" type="url" pattern="https://.*" required><label for="ev-excerpt">Catatan/kutipan</label><textarea id="ev-excerpt" rows="4" maxlength="3500" required></textarea><button type="submit">Catat sumber</button></form></div><div id="evidence-items" class="box">Memuat...</div></section>
 <section class="panel hidden" id="drafts-view"><h2>Approval draf</h2><p class="hint">Persetujuan internal BUKAN bukti telah dipublikasikan.</p><div class="box"><form id="draft-form" class="stack"><label for="draft-title">Judul</label><input id="draft-title" maxlength="200" required><label for="draft-content">Isi draf</label><textarea id="draft-content" rows="7" maxlength="12000" required></textarea><button type="submit">Simpan draf untuk persetujuan</button></form></div><div id="draft-items" class="box">Memuat...</div></section>
 <div id="notice" role="status" aria-live="polite"></div>
 <div class="composer" id="composer"><form id="chat-form"><label class="tiny" for="message">PESAN KE KAI</label><div class="compose-row"><textarea id="message" rows="2" maxlength="4000" required placeholder="Tanya, diskusikan, atau minta analisis…"></textarea><button class="send" id="send" type="submit">Kirim</button></div><label class="tiny" for="source-ids">ID sumber (opsional, pisahkan dengan koma; maksimal 8)</label><input id="source-ids" placeholder="Tempel ID sumber dari tab Sumber"></form></div>
</main>
</div>
<script nonce="NONCE_PLACEHOLDER">
'use strict';
const $ = id => document.getElementById(id);
const views = ['chat','memory','evidence','drafts'];
let current = 'chat';
const titles = { chat:'Percakapan KAI',memory:'Memori KAI',evidence:'Referensi & bukti',drafts:'Draf & persetujuan' };
let busy=false;
function node(tag,txt,cls){const e=document.createElement(tag);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function clear(el){el.replaceChildren()}
function notice(text,isError=false){const n=$('notice');n.textContent=text;n.style.color=isError?'#ffbd69':'#9cf1df'}
function division(){return $('division').value}
function thread(){return $('thread').value.trim()||'main'}
async function api(path,method='GET',payload){
 const response=await fetch(path,{method,credentials:'same-origin',headers:payload?{'Content-Type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});
 const json=await response.json().catch(()=>({error:'invalid_server_response'}));
 if(!response.ok)throw new Error(json.error||('HTTP '+response.status));
 return json;
}
function show(view){
 current=view;
 for(const v of views)$(v+'-view').classList.toggle('hidden',v!==view);
 $('composer').classList.toggle('hidden',view!=='chat');
 for(const b of document.querySelectorAll('.menu-btn'))b.classList.toggle('active',b.dataset.view===view);
 $('page-title').textContent=titles[view];
 notice('');
 if(view==='chat')loadHistory();
 if(view==='memory')loadMemories();
 if(view==='evidence')loadEvidence();
 if(view==='drafts')loadDrafts();
}
function renderMessage(role,text){
 const el=node('div',undefined,'bubble '+(role==='user'?'user':'assistant'));
 el.append(node('div',role==='user'?'ANDA':'KAI','who'),document.createTextNode(text));
 $('messages').append(el);
 el.scrollIntoView({block:'end',behavior:'smooth'});
}
async function loadHistory(){
 try {
 const r=await api('/history?division='+encodeURIComponent(division())+'&thread_id='+encodeURIComponent(thread()));
 clear($('messages'));
 if(!(r.messages||[]).length)renderMessage('assistant','Percakapan baru. Apa yang ingin kita kerjakan?');
 else for(const m of r.messages)renderMessage(m.role,m.content);
 }catch(e){notice('Riwayat: '+e.message,true)}
}
async function loadMemories(){
 try{
 const r=await api('/memory?division='+encodeURIComponent(division()));const target=$('memory-items');clear(target);
 if(!r.memories.length)target.append(node('p','Belum ada memori.'));
 for(const m of r.memories){const div=node('div',undefined,'data-row');div.append(node('strong',m.key),node('pre',m.value));const b=node('button','Hapus');b.addEventListener('click',async()=>{if(!confirm('Hapus memori ini?'))return;try{await api('/memory?division='+encodeURIComponent(division())+'&key='+encodeURIComponent(m.key),'DELETE');await loadMemories()}catch(e){notice(e.message,true)}});div.append(b);target.append(div)}
 }catch(e){notice('Memori: '+e.message,true)}
}
async function loadEvidence(){
 try{
 const r=await api('/evidence?division='+encodeURIComponent(division()));const target=$('evidence-items');clear(target);
 if(!r.evidence.length)target.append(node('p','Belum ada sumber.'));
 for(const m of r.evidence){const div=node('div',undefined,'data-row');div.append(node('strong',m.title));const link=node('a',m.url);link.href=m.url;link.target='_blank';link.rel='noopener noreferrer';div.append(node('div',undefined,'tiny'),link,node('pre',m.excerpt),node('div','ID: '+m.id,'tiny'));const b=node('button','Salin ID');b.addEventListener('click',()=>navigator.clipboard.writeText(m.id).then(()=>notice('ID disalin')).catch(()=>notice('Tidak bisa menyalin',true)));div.append(b);target.append(div)}
 }catch(e){notice('Sumber: '+e.message,true)}
}
async function loadDrafts(){
 try{
 const r=await api('/drafts?division='+encodeURIComponent(division()));const target=$('draft-items');clear(target);
 if(!r.drafts.length)target.append(node('p','Belum ada draf.'));
 for(const d of r.drafts){const div=node('div',undefined,'data-row');div.append(node('strong',d.title),node('div',d.status+' · BELUM DIPUBLIKASIKAN','tiny'),node('pre',d.content));
 if(d.status==='PENDING_APPROVAL'){const b=node('button','Setujui internal');b.addEventListener('click',async()=>{if(!confirm('Setujui draf ini untuk internal? Ini tidak memublikasikan konten.'))return;try{await api('/drafts/'+encodeURIComponent(d.id)+'/approve','POST');await loadDrafts();notice('Draf disetujui secara internal, bukan dipublikasikan.')}catch(e){notice(e.message,true)}});div.append(b)}
 target.append(div)}
 }catch(e){notice('Draf: '+e.message,true)}
}
for(const b of document.querySelectorAll('.menu-btn'))b.addEventListener('click',()=>show(b.dataset.view));
$('division').addEventListener('change',()=>show(current));
$('thread').addEventListener('change',()=>{if(current==='chat')loadHistory()});
$('new-thread').addEventListener('click',()=>{$('thread').value='t-'+Date.now().toString(36);show('chat')});
$('chat-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;const text=$('message').value.trim();if(!text)return;
 const ids=$('source-ids').value.split(',').map(x=>x.trim()).filter(Boolean);busy=true;$('send').disabled=true;notice('KAI sedang memproses…');
 renderMessage('user',text);$('message').value='';
 try{const r=await api('/chat','POST',{division:division(),thread_id:thread(),message:text,evidence_ids:ids});renderMessage('assistant',r.reply);notice('Model: '+r.model+' · Pencarian web otomatis: BELUM AKTIF')}
 catch(e){renderMessage('assistant','Respons belum tersedia. Pesan tidak tersimpan apabila proses gagal.');notice('Gagal: '+e.message,true)}
 finally{busy=false;$('send').disabled=false;}
});
$('message').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){$('chat-form').requestSubmit()}});
$('memory-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/memory','PUT',{division:division(),key:$('memory-key').value,value:$('memory-value').value});$('memory-form').reset();loadMemories();notice('Memori disimpan')}catch(err){notice(err.message,true)}});
$('evidence-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/evidence','POST',{division:division(),title:$('ev-title').value,url:$('ev-url').value,excerpt:$('ev-excerpt').value});$('evidence-form').reset();loadEvidence();notice('Sumber dicatat (belum diverifikasi)')}catch(err){notice(err.message,true)}});
$('draft-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('/drafts','POST',{division:division(),title:$('draft-title').value,content:$('draft-content').value});$('draft-form').reset();loadDrafts();notice('Draf masuk antrean approval')}catch(err){notice(err.message,true)}});
(async()=>{
 try{const r=await api('/session');$('session').textContent='Pemilik terautentikasi · '+(r.email||'');$('connection').textContent='PRIVAT · TERHUBUNG';await loadHistory()}
 catch(e){$('connection').textContent='AKSES DITOLAK';notice('Login Cloudflare Access diperlukan: '+e.message,true)}
})();
</script>
</body></html>`;
export function renderUI(nonce) {
  return DOCUMENT.replaceAll('NONCE_PLACEHOLDER',nonce);
}
