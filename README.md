# Select Proposal — WhatsApp Bot + Admin Panel

Self-hosted WhatsApp chatbot for [Select Proposal](https://selectproposal.com).  
Uses Postgres for persistent storage — **WhatsApp session + all data survives server restarts** (no daily QR rescanning).

## Features

- **Menu-driven bot**: How it works / Register / Pricing / Talk to Admin
- **Registration flow**: Name → Gender → DOB → City → Education (phone auto-captured)
- **Smart pricing**: +92 Male → paid only, +92 Female → free + paid, Overseas → free
- **Payment handling**: Bank details → accept screenshot → admin verifies
- **Admin panel**: Dashboard, Leads, Chats, Settings — all editable, no code needed
- **Auto-pause**: Bot pauses when admin replies from phone
- **Session persistence**: WhatsApp credentials stored in Postgres — no re-scanning QR after restart

## Tech Stack

- Node.js + Express
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web API)
- PostgreSQL (all data + WhatsApp session)
- QRCode generation for admin panel

## Heroku Deployment

```bash
# 1. Create app
heroku create sp-whatsapp-bot

# 2. Add Postgres
heroku addons:create heroku-postgresql:essential-0

# 3. Set admin password
heroku config:set ADMIN_PASSWORD=yourpassword

# 4. Deploy
git push heroku main

# 5. Open admin panel
heroku open
```

Login → Click **Connect WhatsApp** → Scan QR once → done.  
After restart, it reconnects automatically (session stored in database).

## Local Development

```bash
git clone https://github.com/mmohsinlive1/selectproposal-whatsapp.git
cd selectproposal-whatsapp
npm install

# Create local Postgres database
createdb sp_whatsapp

# Configure
cp .env.example .env
# Edit .env: set DATABASE_URL=postgres://localhost:5432/sp_whatsapp

npm start
# Open http://localhost:3000
```

## Admin Panel

| Page | What it does |
|------|-------------|
| **Dashboard** | WhatsApp status, QR scan, lead count, toggle bot on/off |
| **Leads** | View all registrations, change status (registered → approved) |
| **Chats** | Full chat history, reply manually, pause/resume bot per user |
| **Settings** | Edit every bot message — welcome, questions, pricing, bank details |
