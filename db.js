const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'bot.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    name       TEXT,
    gender     TEXT,
    dob_date   TEXT,
    dob_month  TEXT,
    dob_year   TEXT,
    city       TEXT,
    education  TEXT,
    plan       TEXT,
    status     TEXT DEFAULT 'registered',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT NOT NULL,
    direction  TEXT NOT NULL,   -- 'in' or 'out'
    message    TEXT NOT NULL,
    timestamp  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversations (
    phone      TEXT PRIMARY KEY,
    state      TEXT DEFAULT 'idle',
    step       TEXT,
    data       TEXT DEFAULT '{}',
    bot_paused INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// ─── Default Config ────────────────────────────────────────────────────────

const DEFAULTS = {
  bot_enabled: '1',
  welcome_message: `Assalam o Alaikum! 🙏\nWelcome to Select Proposal — Pakistan's trusted online rishta platform for educated families.\n\nHow can we help you?\n1️⃣ How it works\n2️⃣ Register\n3️⃣ Pricing / Plans\n4️⃣ Talk to Admin`,

  how_it_works: `Select Proposal is an online rishta service where:\n✅ You create your profile\n✅ Browse verified educated proposals (doctors, engineers, graduates)\n✅ Your privacy is in your hands — photos only visible after approval\n✅ Send and receive proposals from home\n\nWebsite: selectproposal.com\n\n1️⃣ Register now\n0️⃣ Main Menu`,

  register_q1: `Please enter your full name\n_(Example: Ahmed Khan)_`,
  register_q2: `Your gender?\n1 — Male\n2 — Female`,
  register_q3: `Date of birth — enter DATE (1-31)\n_(Example: 15)_`,
  register_q4: `Now enter MONTH (1-12)\n_(Example: 6)_`,
  register_q5: `Now enter YEAR (4 digits)\n_(Example: 1995)_`,
  register_q6: `Your city?\n_(Example: Lahore)_`,
  register_q7: `Your education?\n1 — Diploma\n2 — Bachelors (2 year)\n3 — Bachelors (4 year)\n4 — Masters\n5 — MPhil\n6 — PhD\n7 — Medical Doctor (MD/MBBS)\n8 — Mufti/Aalim\n9 — Others`,

  register_complete: `Thank you, {{name}}! ✅ Your details have been received.`,

  pricing_male: `Choose your plan:\n\n⭐ Select Plus — PKR 1,999 (2 months)\n⭐ Select Gold — PKR 3,999 (3 months)\n⭐ Select Elite — PKR 4,999 (6 months)\n\nReply with the plan number (1, 2, or 3).`,

  pricing_female_pk: `Choose your plan:\n\n1️⃣ Free Plan (available on website only)\n2️⃣ Select Plus — PKR 1,499 (2 months)\n3️⃣ Select Queen — PKR 2,999 (4 months)\n\nReply with the plan number (1, 2, or 3).`,

  pricing_overseas: `Registration is free for overseas users! 🎉\nSign up here: selectproposal.com/register`,

  pricing_menu: `🎉 Registration is FREE for overseas users!\n\n💰 Premium Plans (Male — Pakistan):\n⭐ Select Plus — PKR 1,999 (2 months)\n⭐ Select Gold — PKR 3,999 (3 months)\n⭐ Select Elite — PKR 4,999 (6 months)\n\n💰 Premium Plans (Female — Pakistan):\n⭐ Select Plus — PKR 1,499 (2 months)\n⭐ Select Queen — PKR 2,999 (4 months)\n\n💳 Payment — Bank Transfer:\n🏦 HBL (Habib Bank Limited)\nAccount Title: SELECT PROPOSAL\nAccount No: 53397000055555\nIBAN: PK65HABB0053397000055555\n\n0️⃣ Main Menu`,

  bank_details: `💳 Payment — Bank Transfer:\n🏦 HBL (Habib Bank Limited)\nAccount Title: SELECT PROPOSAL\nAccount No: 53397000055555\nIBAN: PK65HABB0053397000055555\n\nAfter payment, send the screenshot here ✅`,

  free_female_redirect: `The Free Plan is available on our website. Sign up here:\nselectproposal.com/register\n\n0️⃣ Main Menu`,

  payment_received: `Thank you! Your payment is being verified. Your account will be activated within 24 hours, InshaAllah.\nLogin at: selectproposal.com/login`,

  talk_to_admin: `Your message has been received. Admin will reply shortly, InshaAllah. 🙏\nThank you!`,

  education_options: JSON.stringify([
    'Diploma',
    'Bachelors (2 year)',
    'Bachelors (4 year)',
    'Masters',
    'MPhil',
    'PhD',
    'Medical Doctor (MD/MBBS)',
    'Mufti/Aalim',
    'Others'
  ]),

  male_plans: JSON.stringify([
    { name: 'Select Plus', price: 'PKR 1,999', duration: '2 months' },
    { name: 'Select Gold', price: 'PKR 3,999', duration: '3 months' },
    { name: 'Select Elite', price: 'PKR 4,999', duration: '6 months' }
  ]),

  female_plans: JSON.stringify([
    { name: 'Free Plan', price: 'Free', duration: 'website only', free: true },
    { name: 'Select Plus', price: 'PKR 1,499', duration: '2 months' },
    { name: 'Select Queen', price: 'PKR 2,999', duration: '4 months' }
  ])
};

// Insert defaults only if not already set
const insertDefault = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULTS)) {
  insertDefault.run(key, value);
}

// ─── Config helpers ────────────────────────────────────────────────────────

function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value);
}

function getAllConfig() {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const config = {};
  for (const row of rows) {
    config[row.key] = row.value;
  }
  return config;
}

// ─── Lead helpers ──────────────────────────────────────────────────────────

function createLead(data) {
  const stmt = db.prepare(`
    INSERT INTO leads (phone, name, gender, dob_date, dob_month, dob_year, city, education, plan, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    data.phone, data.name, data.gender,
    data.dob_date, data.dob_month, data.dob_year,
    data.city, data.education, data.plan || null, data.status || 'registered'
  );
}

function getLeads(limit = 100, offset = 0) {
  return db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
}

function getLeadCount() {
  return db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
}

function getLeadByPhone(phone) {
  return db.prepare('SELECT * FROM leads WHERE phone = ?').get(phone);
}

function updateLeadStatus(id, status) {
  db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
}

// ─── Chat helpers ──────────────────────────────────────────────────────────

function logChat(phone, direction, message) {
  db.prepare('INSERT INTO chats (phone, direction, message) VALUES (?, ?, ?)').run(phone, direction, message);
}

function getChatHistory(phone, limit = 50) {
  return db.prepare('SELECT * FROM chats WHERE phone = ? ORDER BY timestamp DESC LIMIT ?').all(phone, limit).reverse();
}

function getRecentChats(limit = 20) {
  return db.prepare(`
    SELECT phone, MAX(timestamp) as last_message, COUNT(*) as message_count
    FROM chats GROUP BY phone ORDER BY last_message DESC LIMIT ?
  `).all(limit);
}

// ─── Conversation state helpers ────────────────────────────────────────────

function getConversation(phone) {
  let conv = db.prepare('SELECT * FROM conversations WHERE phone = ?').get(phone);
  if (!conv) {
    db.prepare('INSERT INTO conversations (phone) VALUES (?)').run(phone);
    conv = db.prepare('SELECT * FROM conversations WHERE phone = ?').get(phone);
  }
  return conv;
}

function updateConversation(phone, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(val);
  }
  fields.push("updated_at = datetime('now')");
  values.push(phone);
  db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE phone = ?`).run(...values);
}

function pauseBot(phone) {
  updateConversation(phone, { bot_paused: 1 });
}

function resumeBot(phone) {
  updateConversation(phone, { bot_paused: 0 });
}

function isPaused(phone) {
  const conv = getConversation(phone);
  return conv.bot_paused === 1;
}

module.exports = {
  db,
  getConfig, setConfig, getAllConfig,
  createLead, getLeads, getLeadCount, getLeadByPhone, updateLeadStatus,
  logChat, getChatHistory, getRecentChats,
  getConversation, updateConversation, pauseBot, resumeBot, isPaused
};
