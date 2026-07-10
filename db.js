const { Pool } = require('pg');

// Use DATABASE_URL from Heroku/Railway or local Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ─── Schema Setup ──────────────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS wa_config (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS wa_leads (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        name TEXT,
        gender TEXT,
        dob_date INTEGER,
        dob_month INTEGER,
        dob_year INTEGER,
        city TEXT,
        education TEXT,
        plan TEXT,
        status TEXT DEFAULT 'registered',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wa_chats (
        id SERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        direction TEXT NOT NULL,
        message TEXT,
        media_type TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wa_conversations (
        phone TEXT PRIMARY KEY,
        state TEXT DEFAULT 'idle',
        step TEXT,
        data JSONB DEFAULT '{}',
        bot_paused BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wa_auth (
        key TEXT PRIMARY KEY,
        value JSONB
      );
    `);

    // Seed defaults
    const defaults = {
      bot_enabled: '1',
      welcome_message: `Assalam o Alaikum! 🙏\nWelcome to Select Proposal — Pakistan's premium matrimonial service for educated professionals.\n\nHow can we help you today?\n\n1 — How it works\n2 — Register\n3 — Pricing\n4 — Talk to Admin`,
      how_it_works: `*Select Proposal* connects educated professionals for marriage.\n\n✅ Create your profile\n✅ Browse verified profiles\n✅ Send & receive proposals\n✅ Chat with matches\n\nAll profiles are manually verified for authenticity.\n\n👉 Ready to register? Type *2*\n👉 Back to menu? Type *0*`,
      register_q1: `Please enter your full name\n_(Example: Ahmed Khan)_`,
      register_q2: `Your gender?\n1 — Male\n2 — Female`,
      register_q3: `Date of birth — enter DATE (1-31)\n_(Example: 15)_`,
      register_q4: `Now enter MONTH (1-12)\n_(Example: 6 for June)_`,
      register_q5: `Now enter YEAR (4 digits)\n_(Example: 1995)_`,
      register_q6: `Your city?\n_(Example: Lahore)_`,
      register_q7: `Your education?\n1 — Diploma\n2 — Bachelors (2 year)\n3 — Bachelors (4 year)\n4 — Masters\n5 — MPhil\n6 — PhD\n7 — Medical Doctor (MD/MBBS)\n8 — Mufti / Aalim\n9 — Others`,
      register_complete: `Thank you, {{name}}! ✅ Your details have been saved.`,
      pricing_male: `Choose your plan:\n\n⭐ *Select Plus* — PKR 1,999 (2 months)\n1 — Select Plus\n\n💎 *Select Gold* — PKR 3,999 (3 months)\n2 — Select Gold\n\n👑 *Select Elite* — PKR 4,999 (6 months)\n3 — Select Elite`,
      pricing_female_pk: `Choose your plan:\n\n🆓 *Free Plan* — Browse on website\n1 — Free Plan\n\n⭐ *Select Plus* — PKR 1,499 (2 months)\n2 — Select Plus\n\n👑 *Select Queen* — PKR 2,999 (4 months)\n3 — Select Queen`,
      pricing_overseas: `Registration is free for overseas users! 🌍\nSign up here: https://selectproposal.com/register`,
      pricing_menu: `Our Plans:\n\n*For Men (Pakistan):*\n⭐ Select Plus — PKR 1,999 (2 months)\n💎 Select Gold — PKR 3,999 (3 months)\n👑 Select Elite — PKR 4,999 (6 months)\n\n*For Women (Pakistan):*\n🆓 Free Plan — Browse on website\n⭐ Select Plus — PKR 1,499 (2 months)\n👑 Select Queen — PKR 2,999 (4 months)\n\n*Overseas:*\n🌍 Free registration!\n\n👉 Type *2* to register now\n👉 Type *0* for main menu`,
      bank_details: `Please transfer to:\n\n🏦 *HBL (Habib Bank Limited)*\nAccount Title: SELECT PROPOSAL\nAccount No: 53397000055555\nIBAN: PK65HABB0053397000055555\n\nAfter payment, send a screenshot here. We will verify within 24 hours. ✅`,
      free_female_redirect: `The Free Plan is available on our website. Sign up here:\n👉 https://selectproposal.com/register\n\nFor premium features, type *0* to go back and choose a paid plan.`,
      payment_received: `Thank you! 🎉 We have received your payment screenshot.\nOur team will verify it within 24 hours.\n\nOnce verified, you can log in at:\n👉 https://selectproposal.com/login\n\nType *0* for main menu.`,
      talk_to_admin: `Our admin will reply to you shortly. Please wait. 🙏\n\n_(The bot is now paused for this conversation. An admin will respond manually.)_`
    };

    for (const [key, value] of Object.entries(defaults)) {
      await client.query(
        `INSERT INTO wa_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    console.log('[DB] Postgres initialized');
  } finally {
    client.release();
  }
}

// ─── Config ────────────────────────────────────────────────────────────────
async function getConfig(key) {
  const res = await pool.query('SELECT value FROM wa_config WHERE key = $1', [key]);
  return res.rows[0]?.value;
}

async function getAllConfig() {
  const res = await pool.query('SELECT key, value FROM wa_config');
  const config = {};
  for (const row of res.rows) config[row.key] = row.value;
  return config;
}

async function setConfig(key, value) {
  await pool.query(
    `INSERT INTO wa_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

// ─── Leads ─────────────────────────────────────────────────────────────────
async function createLead(phone) {
  const res = await pool.query(
    `INSERT INTO wa_leads (phone) VALUES ($1) RETURNING *`,
    [phone]
  );
  return res.rows[0];
}

async function getLeadByPhone(phone) {
  const res = await pool.query('SELECT * FROM wa_leads WHERE phone = $1 ORDER BY id DESC LIMIT 1', [phone]);
  return res.rows[0] || null;
}

async function updateLead(id, fields) {
  const sets = [];
  const values = [];
  let idx = 1;
  for (const [key, val] of Object.entries(fields)) {
    sets.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }
  sets.push(`updated_at = NOW()`);
  values.push(id);
  await pool.query(`UPDATE wa_leads SET ${sets.join(', ')} WHERE id = $${idx}`, values);
}

async function getLeadCount() {
  const res = await pool.query('SELECT COUNT(*) as count FROM wa_leads');
  return parseInt(res.rows[0].count);
}

async function getLeads(limit = 20, offset = 0) {
  const res = await pool.query('SELECT * FROM wa_leads ORDER BY id DESC LIMIT $1 OFFSET $2', [limit, offset]);
  return res.rows;
}

async function updateLeadStatus(id, status) {
  await pool.query(`UPDATE wa_leads SET status = $1, updated_at = NOW() WHERE id = $2`, [status, id]);
}

// ─── Chats ─────────────────────────────────────────────────────────────────
async function saveChat(phone, direction, message, mediaType = null) {
  await pool.query(
    `INSERT INTO wa_chats (phone, direction, message, media_type) VALUES ($1, $2, $3, $4)`,
    [phone, direction, message, mediaType]
  );
}

async function getRecentChats() {
  const res = await pool.query(`
    SELECT phone, COUNT(*) as message_count, MAX(timestamp) as last_message
    FROM wa_chats GROUP BY phone ORDER BY last_message DESC LIMIT 50
  `);
  return res.rows;
}

async function getChatHistory(phone) {
  const res = await pool.query(
    'SELECT * FROM wa_chats WHERE phone = $1 ORDER BY timestamp ASC',
    [phone]
  );
  return res.rows;
}

// ─── Conversations ─────────────────────────────────────────────────────────
async function getConversation(phone) {
  const res = await pool.query('SELECT * FROM wa_conversations WHERE phone = $1', [phone]);
  return res.rows[0] || null;
}

async function upsertConversation(phone, fields) {
  const existing = await getConversation(phone);
  if (!existing) {
    await pool.query(
      `INSERT INTO wa_conversations (phone, state, step, data, bot_paused) VALUES ($1, $2, $3, $4, $5)`,
      [phone, fields.state || 'idle', fields.step || null, JSON.stringify(fields.data || {}), fields.bot_paused || false]
    );
  } else {
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(fields)) {
      if (key === 'data') {
        sets.push(`data = $${idx}`);
        values.push(JSON.stringify(val));
      } else {
        sets.push(`${key} = $${idx}`);
        values.push(val);
      }
      idx++;
    }
    sets.push(`updated_at = NOW()`);
    values.push(phone);
    await pool.query(`UPDATE wa_conversations SET ${sets.join(', ')} WHERE phone = $${idx}`, values);
  }
}

async function pauseBot(phone) {
  await upsertConversation(phone, { bot_paused: true });
}

async function resumeBot(phone) {
  await upsertConversation(phone, { bot_paused: false, state: 'idle', step: null, data: {} });
}

// ─── Auth State (Baileys session persistence) ──────────────────────────────
async function getAuthValue(key) {
  const res = await pool.query('SELECT value FROM wa_auth WHERE key = $1', [key]);
  return res.rows[0]?.value || null;
}

async function setAuthValue(key, value) {
  await pool.query(
    `INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, JSON.stringify(value)]
  );
}

async function deleteAuthValue(key) {
  await pool.query('DELETE FROM wa_auth WHERE key = $1', [key]);
}

async function getAuthKeys(prefix) {
  const res = await pool.query('SELECT key FROM wa_auth WHERE key LIKE $1', [prefix + '%']);
  return res.rows.map(r => r.key);
}

module.exports = {
  pool, initDB,
  getConfig, getAllConfig, setConfig,
  createLead, getLeadByPhone, updateLead, getLeadCount, getLeads, updateLeadStatus,
  saveChat, getRecentChats, getChatHistory,
  getConversation, upsertConversation, pauseBot, resumeBot,
  getAuthValue, setAuthValue, deleteAuthValue, getAuthKeys
};
