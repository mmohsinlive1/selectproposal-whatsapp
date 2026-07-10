const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { handleMessage, onAdminReply } = require('./bot');
const { saveChat, getAuthValue, setAuthValue, deleteAuthValue, getAuthKeys } = require('./db');
const QRCode = require('qrcode');

const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let statusListeners = [];
let ownJid = null;

function getStatus() {
  return { status: connectionStatus, qrCode };
}

function onStatusChange(cb) {
  statusListeners.push(cb);
}

function notifyStatus() {
  for (const cb of statusListeners) cb(getStatus());
}

// ─── Postgres-backed Auth State ────────────────────────────────────────────
// Stores Baileys credentials & keys in wa_auth table so session survives restarts
async function usePostgresAuthState() {
  // Load or create credentials
  const credsRaw = await getAuthValue('creds');
  const creds = credsRaw ? JSON.parse(JSON.stringify(credsRaw), BufferJSON.reviver) : initAuthCreds();

  const keys = {
    get: async (type, ids) => {
      const result = {};
      for (const id of ids) {
        const val = await getAuthValue(`${type}-${id}`);
        if (val) {
          result[id] = JSON.parse(JSON.stringify(val), BufferJSON.reviver);
        }
      }
      return result;
    },
    set: async (data) => {
      for (const [type, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries)) {
          const key = `${type}-${id}`;
          if (value) {
            await setAuthValue(key, JSON.parse(JSON.stringify(value, BufferJSON.replacer)));
          } else {
            await deleteAuthValue(key);
          }
        }
      }
    }
  };

  const saveCreds = async () => {
    await setAuthValue('creds', JSON.parse(JSON.stringify(creds, BufferJSON.replacer)));
  };

  return { state: { creds, keys }, saveCreds };
}

// ─── Main WhatsApp Connection ──────────────────────────────────────────────
async function startWhatsApp() {
  const { state, saveCreds } = await usePostgresAuthState();
  const { version } = await fetchLatestBaileysVersion();

  connectionStatus = 'connecting';
  notifyStatus();

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal: true,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = await QRCode.toDataURL(qr);
      connectionStatus = 'qr_ready';
      console.log('[WhatsApp] QR code generated — scan from admin panel');
      notifyStatus();
    }

    if (connection === 'open') {
      connectionStatus = 'connected';
      qrCode = null;
      ownJid = sock.user?.id;
      console.log('[WhatsApp] Connected as', ownJid);
      notifyStatus();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('[WhatsApp] Disconnected. Code:', statusCode, 'Reconnecting:', shouldReconnect);

      connectionStatus = 'disconnected';
      qrCode = null;
      notifyStatus();

      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (msg.key.remoteJid?.endsWith('@g.us')) continue;

      const phone = msg.key.remoteJid?.replace('@s.whatsapp.net', '');
      if (!phone) continue;

      // Admin replied from phone → pause bot
      if (msg.key.fromMe) {
        await onAdminReply(phone);
        continue;
      }

      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.buttonsResponseMessage?.selectedDisplayText
        || msg.message?.listResponseMessage?.title
        || '';

      const hasMedia = !!(msg.message?.imageMessage || msg.message?.documentMessage || msg.message?.videoMessage);
      const mediaType = msg.message?.imageMessage ? 'image'
        : msg.message?.documentMessage ? 'document'
        : msg.message?.videoMessage ? 'video'
        : null;

      console.log(`[WhatsApp] Message from ${phone}: ${text || '[media]'}`);

      try {
        const replies = await handleMessage(phone, text, hasMedia, mediaType);
        if (replies && replies.length > 0) {
          for (const reply of replies) {
            await sock.sendMessage(msg.key.remoteJid, { text: reply });
            await saveChat(phone, 'out', reply);
            await new Promise(r => setTimeout(r, 500));
          }
        }
      } catch (err) {
        console.error('[WhatsApp] Error handling message:', err);
      }
    }
  });

  return sock;
}

async function sendMessage(phone, text) {
  if (!sock || connectionStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  await sock.sendMessage(jid, { text });
  await saveChat(phone.replace('@s.whatsapp.net', ''), 'out', text);
}

async function disconnectWhatsApp() {
  if (sock) {
    await sock.logout();
    sock = null;
    connectionStatus = 'disconnected';
    qrCode = null;
    notifyStatus();
  }
}

module.exports = { startWhatsApp, getStatus, onStatusChange, sendMessage, disconnectWhatsApp };
