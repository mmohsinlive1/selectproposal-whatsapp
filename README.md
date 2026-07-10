# Select Proposal — WhatsApp Bot + Admin Panel

Self-hosted WhatsApp chatbot for Select Proposal (selectproposal.com).

## Features
- **Menu-driven bot**: How it works / Register / Pricing / Talk to Admin
- **Registration flow**: Name → Gender → DOB → City → Education → auto-captures WhatsApp number
- **Smart pricing**: +92 Male → paid only, +92 Female → free + paid, Overseas → free
- **Payment handling**: Shows bank details, accepts screenshot, forwards to admin
- **Admin panel**: Edit all messages, view leads, chat history, pause/resume bot per conversation
- **Auto-pause**: Bot stops when admin replies from phone

## Setup

```bash
# 1. Clone and install
git clone https://github.com/mmohsinlive1/selectproposal-whatsapp.git
cd selectproposal-whatsapp
npm install

# 2. Configure
cp .env.example .env
# Edit .env with your admin password

# 3. Run
npm start
# Open http://localhost:3000 — login and scan QR code
```

## Heroku Deployment

```bash
heroku create sp-whatsapp-bot
heroku buildpacks:add heroku/nodejs
git push heroku main

# Set environment variables
heroku config:set ADMIN_PASSWORD=yourpassword
heroku config:set FORWARD_EMAIL=info@selectproposal.com
```

**Note:** Heroku's ephemeral filesystem means the WhatsApp session and SQLite database will reset on dyno restart. For production, consider using Heroku Postgres or an add-on for persistent storage.

## Admin Panel

- **Dashboard**: Connection status, QR scan, quick actions
- **Leads**: View all registrations, update status (registered/payment_pending/approved)
- **Chats**: View conversation history, reply manually, pause/resume bot per user
- **Settings**: Edit every bot message — no code changes needed
