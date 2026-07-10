require('dotenv').config();
const express = require('express');
const path = require('path');
const { startWhatsApp, getStatus, sendMessage, disconnectWhatsApp } = require('./whatsapp');
const {
  initDB,
  getAllConfig, setConfig, getConfig,
  getLeads, getLeadCount, updateLeadStatus,
  getRecentChats, getChatHistory,
  getConversation, resumeBot, pauseBot, upsertConversation
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'changeme';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple session auth via cookie
function authMiddleware(req, res, next) {
  const authCookie = req.headers.cookie?.split(';').find(c => c.trim().startsWith('sp_auth='));
  const token = authCookie?.split('=')[1]?.trim();
  if (token === Buffer.from(ADMIN_PASS).toString('base64')) return next();
  if (req.path === '/login' || req.path === '/api/login') return next();
  res.redirect('/login');
}

app.use(authMiddleware);

// ─── Login ─────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => { res.send(loginPage()); });
app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASS) {
    const token = Buffer.from(ADMIN_PASS).toString('base64');
    res.setHeader('Set-Cookie', `sp_auth=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`);
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// ─── Dashboard ─────────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  const status = getStatus();
  const leadCount = await getLeadCount();
  const config = await getAllConfig();
  res.send(dashboardPage(status, leadCount, config));
});

// ─── WhatsApp ──────────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => { res.json(getStatus()); });
app.post('/api/connect', async (req, res) => {
  try { await startWhatsApp(); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/disconnect', async (req, res) => {
  try { await disconnectWhatsApp(); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Config ────────────────────────────────────────────────────────────────
app.get('/api/config', async (req, res) => { res.json(await getAllConfig()); });
app.post('/api/config', async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });
  await setConfig(key, value);
  res.json({ ok: true });
});
app.post('/api/config/bulk', async (req, res) => {
  for (const [key, value] of Object.entries(req.body)) await setConfig(key, value);
  res.json({ ok: true });
});

// ─── Leads ─────────────────────────────────────────────────────────────────
app.get('/api/leads', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const offset = (page - 1) * limit;
  const leads = await getLeads(limit, offset);
  const total = await getLeadCount();
  res.json({ leads, total, page, pages: Math.ceil(total / limit) });
});
app.post('/api/leads/:id/status', async (req, res) => {
  await updateLeadStatus(parseInt(req.params.id), req.body.status);
  res.json({ ok: true });
});

// ─── Chats ─────────────────────────────────────────────────────────────────
app.get('/api/chats', async (req, res) => { res.json(await getRecentChats()); });
app.get('/api/chats/:phone', async (req, res) => {
  const history = await getChatHistory(req.params.phone);
  const conv = await getConversation(req.params.phone);
  res.json({ history, conversation: conv });
});
app.post('/api/chats/:phone/send', async (req, res) => {
  try {
    await sendMessage(req.params.phone, req.body.message);
    await pauseBot(req.params.phone);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/chats/:phone/resume', async (req, res) => {
  await resumeBot(req.params.phone);
  res.json({ ok: true });
});
app.post('/api/chats/:phone/pause', async (req, res) => {
  await pauseBot(req.params.phone);
  res.json({ ok: true });
});

// ─── Pages ─────────────────────────────────────────────────────────────────
app.get('/leads', (req, res) => { res.send(leadsPage()); });
app.get('/chats', (req, res) => { res.send(chatsPage()); });
app.get('/settings', async (req, res) => { res.send(settingsPage(await getAllConfig())); });

// ─── Start ─────────────────────────────────────────────────────────────────
async function boot() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`[Server] Admin panel at http://localhost:${PORT}`);
    console.log('[Server] Starting WhatsApp...');
    startWhatsApp().catch(err => console.error('[Server] WhatsApp start error:', err));
  });
}
boot();


// ═══════════════════════════════════════════════════════════════════════════
// HTML Pages
// ═══════════════════════════════════════════════════════════════════════════

function layout(title, content, activeTab = '') {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Select Proposal Bot</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; }
  .nav { background: #161b22; border-bottom: 1px solid #30363d; padding: 0 24px; display: flex; align-items: center; height: 56px; gap: 32px; }
  .nav-brand { font-weight: 700; font-size: 18px; color: #fff; display: flex; align-items: center; gap: 8px; }
  .nav-brand span { color: #8b1e1e; }
  .nav a { color: #8b9ba8; text-decoration: none; font-size: 14px; padding: 16px 0; border-bottom: 2px solid transparent; }
  .nav a:hover, .nav a.active { color: #fff; border-bottom-color: #8b1e1e; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
  .card h2 { font-size: 18px; margin-bottom: 16px; color: #fff; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .badge-green { background: #1a4d2e; color: #3fb950; }
  .badge-yellow { background: #4d3800; color: #d29922; }
  .badge-red { background: #4d1a1a; color: #f85149; }
  .btn { padding: 8px 16px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; }
  .btn-primary { background: #8b1e1e; color: #fff; }
  .btn-primary:hover { background: #a52525; }
  .btn-secondary { background: #30363d; color: #e1e4e8; }
  .btn-secondary:hover { background: #3d444d; }
  .btn-danger { background: #4d1a1a; color: #f85149; }
  .btn-success { background: #1a4d2e; color: #3fb950; }
  input, textarea, select { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 10px 12px; color: #e1e4e8; font-size: 14px; width: 100%; }
  input:focus, textarea:focus { border-color: #8b1e1e; outline: none; }
  textarea { resize: vertical; min-height: 80px; font-family: inherit; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #30363d; font-size: 14px; }
  th { color: #8b9ba8; font-weight: 500; font-size: 12px; text-transform: uppercase; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px; text-align: center; }
  .stat-value { font-size: 32px; font-weight: 700; color: #fff; }
  .stat-label { font-size: 13px; color: #8b9ba8; margin-top: 4px; }
  .qr-container { text-align: center; padding: 20px; }
  .qr-container img { max-width: 280px; border-radius: 12px; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 13px; color: #8b9ba8; margin-bottom: 6px; font-weight: 500; }
  .chat-list { max-height: 500px; overflow-y: auto; }
  .chat-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #30363d; cursor: pointer; }
  .chat-item:hover { background: #1c2128; }
  .chat-msg { padding: 8px 14px; border-radius: 12px; max-width: 70%; margin: 4px 0; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
  .chat-in { background: #30363d; align-self: flex-start; }
  .chat-out { background: #1a4d2e; align-self: flex-end; }
  .chat-window { display: flex; flex-direction: column; max-height: 400px; overflow-y: auto; padding: 16px; }
  .flex { display: flex; gap: 8px; align-items: center; }
  .mt-2 { margin-top: 16px; }
</style>
</head><body>
<nav class="nav">
  <div class="nav-brand"><span>SP</span> WhatsApp Bot</div>
  <a href="/" class="${activeTab === 'dashboard' ? 'active' : ''}">Dashboard</a>
  <a href="/leads" class="${activeTab === 'leads' ? 'active' : ''}">Leads</a>
  <a href="/chats" class="${activeTab === 'chats' ? 'active' : ''}">Chats</a>
  <a href="/settings" class="${activeTab === 'settings' ? 'active' : ''}">Settings</a>
</nav>
<div class="container">${content}</div>
</body></html>`;
}

function loginPage() {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — SP Bot</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, sans-serif; background: #0f1117; color: #e1e4e8; min-height: 100vh; display: flex; justify-content: center; align-items: center; }
  .login-box { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 40px; width: 380px; text-align: center; }
  .login-box h1 { font-size: 24px; margin-bottom: 8px; }
  .login-box p { color: #8b9ba8; font-size: 14px; margin-bottom: 24px; }
  input { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 12px; color: #e1e4e8; font-size: 16px; width: 100%; margin-bottom: 16px; }
  button { background: #8b1e1e; color: #fff; border: none; border-radius: 8px; padding: 12px; width: 100%; font-size: 16px; cursor: pointer; }
  button:hover { background: #a52525; }
  .error { color: #f85149; font-size: 14px; margin-bottom: 12px; display: none; }
</style></head><body>
<div class="login-box">
  <h1>🔐 SP Bot Admin</h1>
  <p>Select Proposal WhatsApp Bot</p>
  <div class="error" id="error">Wrong password</div>
  <input type="password" id="pass" placeholder="Admin password" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Sign In</button>
</div>
<script>
async function login() {
  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: document.getElementById('pass').value}) });
  if (res.ok) { window.location = '/'; } else { document.getElementById('error').style.display = 'block'; }
}
</script></body></html>`;
}

function dashboardPage(status, leadCount, config) {
  const statusBadge = status.status === 'connected' ? '<span class="badge badge-green">● Connected</span>'
    : status.status === 'qr_ready' ? '<span class="badge badge-yellow">● Scan QR</span>'
    : '<span class="badge badge-red">● Disconnected</span>';
  const botBadge = config.bot_enabled === '1' ? '<span class="badge badge-green">ON</span>' : '<span class="badge badge-red">OFF</span>';

  const qrHtml = status.status === 'qr_ready' && status.qrCode
    ? `<div class="qr-container"><p style="margin-bottom:12px">Scan this QR code with WhatsApp on your phone:</p><img src="${status.qrCode}" alt="QR Code"></div>`
    : status.status === 'disconnected'
    ? `<div style="text-align:center;padding:20px"><button class="btn btn-primary" onclick="connect()">Connect WhatsApp</button></div>`
    : `<div style="text-align:center;padding:20px;color:#3fb950">✅ WhatsApp is connected and bot is running</div>`;

  return layout('Dashboard', `
    <h1 style="margin-bottom:24px">Dashboard</h1>
    <div class="stat-grid">
      <div class="stat"><div class="stat-value">${leadCount}</div><div class="stat-label">Total Leads</div></div>
      <div class="stat"><div class="stat-value">${statusBadge}</div><div class="stat-label">WhatsApp</div></div>
      <div class="stat"><div class="stat-value">${botBadge}</div><div class="stat-label">Bot Status</div></div>
    </div>
    <div class="card"><h2>WhatsApp Connection</h2>${qrHtml}</div>
    <div class="card"><h2>Quick Actions</h2>
      <div class="flex">
        <button class="btn btn-primary" onclick="toggleBot()">${config.bot_enabled === '1' ? 'Disable' : 'Enable'} Bot</button>
        ${status.status === 'connected' ? '<button class="btn btn-danger" onclick="disconnect()">Disconnect WhatsApp</button>' : ''}
      </div>
    </div>
    <script>
    async function connect() { await fetch('/api/connect',{method:'POST'}); setTimeout(()=>location.reload(),2000); }
    async function disconnect() { if(confirm('Disconnect?')) { await fetch('/api/disconnect',{method:'POST'}); location.reload(); }}
    async function toggleBot() {
      const c = await (await fetch('/api/config')).json();
      await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'bot_enabled',value:c.bot_enabled==='1'?'0':'1'})});
      location.reload();
    }
    ${status.status === 'qr_ready' || status.status === 'connecting' ? 'setInterval(async()=>{const s=await(await fetch("/api/status")).json();if(s.status==="connected")location.reload();if(s.qrCode&&s.status==="qr_ready"){const img=document.querySelector(".qr-container img");if(img)img.src=s.qrCode;}},3000);' : ''}
    </script>
  `, 'dashboard');
}

function leadsPage() {
  return layout('Leads', `
    <h1 style="margin-bottom:24px">Leads</h1>
    <div class="card">
      <div id="leads-table">Loading...</div>
      <div class="flex mt-2" id="pagination"></div>
    </div>
    <script>
    let page=1;
    async function loadLeads(p){
      page=p||1;
      const res=await(await fetch('/api/leads?page='+page)).json();
      let html='<table><tr><th>#</th><th>Name</th><th>Phone</th><th>Gender</th><th>DOB</th><th>City</th><th>Education</th><th>Plan</th><th>Status</th><th>Date</th><th></th></tr>';
      for(const l of res.leads){
        const dob=l.dob_date&&l.dob_month&&l.dob_year?l.dob_date+'/'+l.dob_month+'/'+l.dob_year:'-';
        const sc=l.status==='approved'?'badge-green':l.status==='payment_pending'?'badge-yellow':'badge-green';
        html+='<tr><td>'+l.id+'</td><td>'+esc(l.name||'-')+'</td><td>'+esc(l.phone)+'</td><td>'+(l.gender||'-')+'</td><td>'+dob+'</td><td>'+esc(l.city||'-')+'</td><td>'+esc(l.education||'-')+'</td><td>'+esc(l.plan||'-')+'</td><td><span class="badge '+sc+'">'+l.status+'</span></td><td>'+(l.created_at||'').slice(0,10)+'</td><td><select onchange="updateStatus('+l.id+',this.value)"><option value="">Change...</option><option value="registered">Registered</option><option value="payment_pending">Payment Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></td></tr>';
      }
      html+='</table>';
      document.getElementById('leads-table').innerHTML=html;
      let pag='';for(let i=1;i<=res.pages;i++)pag+='<button class="btn '+(i===page?'btn-primary':'btn-secondary')+'" onclick="loadLeads('+i+')">'+i+'</button>';
      document.getElementById('pagination').innerHTML=pag;
    }
    async function updateStatus(id,s){if(!s)return;await fetch('/api/leads/'+id+'/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:s})});loadLeads(page);}
    function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
    loadLeads(1);
    </script>
  `, 'leads');
}

function chatsPage() {
  return layout('Chats', `
    <h1 style="margin-bottom:24px">Chats</h1>
    <div style="display:grid;grid-template-columns:300px 1fr;gap:16px">
      <div class="card"><h2>Conversations</h2><div class="chat-list" id="chat-list">Loading...</div></div>
      <div class="card">
        <h2 id="chat-title">Select a conversation</h2>
        <div id="chat-status"></div>
        <div class="chat-window" id="chat-window"></div>
        <div class="flex mt-2" id="chat-actions" style="display:none">
          <input id="reply-input" placeholder="Type a message..." style="flex:1">
          <button class="btn btn-primary" onclick="sendReply()">Send</button>
          <button class="btn btn-success" id="resume-btn" onclick="doResume()">Resume Bot</button>
          <button class="btn btn-danger" id="pause-btn" onclick="doPause()">Pause Bot</button>
        </div>
      </div>
    </div>
    <script>
    let currentPhone=null;
    async function loadChats(){
      const chats=await(await fetch('/api/chats')).json();
      let html='';
      for(const c of chats) html+='<div class="chat-item" onclick="openChat(\\''+c.phone+'\\')"><div><strong>'+c.phone+'</strong><br><small style="color:#8b9ba8">'+c.message_count+' msgs</small></div><small style="color:#8b9ba8">'+(c.last_message||'').slice(0,16)+'</small></div>';
      document.getElementById('chat-list').innerHTML=html||'<p style="padding:12px;color:#8b9ba8">No conversations yet</p>';
    }
    async function openChat(phone){
      currentPhone=phone;
      document.getElementById('chat-title').textContent=phone;
      document.getElementById('chat-actions').style.display='flex';
      const res=await(await fetch('/api/chats/'+phone)).json();
      let html='';
      for(const m of res.history){
        const cls=m.direction==='in'?'chat-in':'chat-out';
        html+='<div class="chat-msg '+cls+'">'+esc(m.message)+'<br><small style="color:#8b9ba8;font-size:11px">'+(m.timestamp||'').slice(0,19)+'</small></div>';
      }
      document.getElementById('chat-window').innerHTML=html;
      document.getElementById('chat-window').scrollTop=99999;
      const paused=res.conversation?.bot_paused;
      document.getElementById('chat-status').innerHTML=paused?'<span class="badge badge-yellow">Bot paused</span>':'<span class="badge badge-green">Bot active</span>';
    }
    async function sendReply(){
      const msg=document.getElementById('reply-input').value.trim();
      if(!msg||!currentPhone)return;
      await fetch('/api/chats/'+currentPhone+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg})});
      document.getElementById('reply-input').value='';openChat(currentPhone);
    }
    async function doResume(){await fetch('/api/chats/'+currentPhone+'/resume',{method:'POST'});openChat(currentPhone);}
    async function doPause(){await fetch('/api/chats/'+currentPhone+'/pause',{method:'POST'});openChat(currentPhone);}
    function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
    document.getElementById('reply-input')?.addEventListener('keydown',e=>{if(e.key==='Enter')sendReply();});
    loadChats();
    </script>
  `, 'chats');
}

function settingsPage(config) {
  const fields = [
    { key:'welcome_message', label:'Welcome Message' },
    { key:'how_it_works', label:'How It Works' },
    { key:'register_q1', label:'Registration Q1 — Name' },
    { key:'register_q2', label:'Registration Q2 — Gender' },
    { key:'register_q3', label:'Registration Q3 — DOB Date' },
    { key:'register_q4', label:'Registration Q4 — DOB Month' },
    { key:'register_q5', label:'Registration Q5 — DOB Year' },
    { key:'register_q6', label:'Registration Q6 — City' },
    { key:'register_q7', label:'Registration Q7 — Education' },
    { key:'register_complete', label:'Registration Complete ({{name}} = user name)' },
    { key:'pricing_male', label:'Pricing — Male (Pakistan)' },
    { key:'pricing_female_pk', label:'Pricing — Female (Pakistan)' },
    { key:'pricing_overseas', label:'Pricing — Overseas (Free)' },
    { key:'pricing_menu', label:'Pricing — Menu View (option 3)' },
    { key:'bank_details', label:'Bank Details Message' },
    { key:'free_female_redirect', label:'Free Plan — Female Redirect' },
    { key:'payment_received', label:'Payment Screenshot Received' },
    { key:'talk_to_admin', label:'Talk to Admin Message' },
  ];

  let fieldsHtml = '';
  for (const f of fields) {
    const val = (config[f.key] || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    fieldsHtml += `<div class="form-group"><label>${f.label}</label><textarea name="${f.key}" rows="4">${val}</textarea></div>`;
  }

  return layout('Settings', `
    <h1 style="margin-bottom:24px">Bot Settings</h1>
    <div class="card">
      <h2>Bot Messages</h2>
      <p style="color:#8b9ba8;font-size:13px;margin-bottom:16px">Edit any message below. Changes take effect immediately.</p>
      <form id="settings-form">
        ${fieldsHtml}
        <button type="submit" class="btn btn-primary" style="margin-top:8px">Save All Changes</button>
      </form>
    </div>
    <script>
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const data={};const form=new FormData(e.target);for(const[k,v]of form.entries())data[k]=v;
      const res=await fetch('/api/config/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      if(res.ok){alert('Saved!');}else{alert('Error saving');}
    });
    </script>
  `, 'settings');
}
