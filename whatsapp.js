const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const { handleMessage, onAdminReply } = require('./bot');
const { logChat, getConversation, resumeBot } = require('./db');
const QRCode = require('qrcode');

const AUTH_DIR = path.join(__dirname, 'data', 'auth');
const logger = pino({ level: 'silent' });

let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected'; // disconnected | connecting | qr_ready | connected
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

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
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

  // Connection updates
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

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Handle incoming messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip status messages
      if (msg.key.remoteJid === 'status@broadcast') continue;
      // Skip group messages
      if (msg.key.remoteJid?.endsWith('@g.us')) continue;

      const phone = msg.key.remoteJid?.replace('@s.whatsapp.net', '');
      if (!phone) continue;

      // Check if this is an outgoing message (admin replied from phone)
      if (msg.key.fromMe) {
        onAdminReply(phone);
        continue;
      }

      // Extract message text
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.buttonsResponseMessage?.selectedDisplayText
        || msg.message?.listResponseMessage?.title
        || '';

      // Check for media
      const hasMedia = !!(
        msg.message?.imageMessage
        || msg.message?.documentMessage
        || msg.message?.videoMessage
      );
      const mediaType = msg.message?.imageMessage ? 'image'
        : msg.message?.documentMessage ? 'document'
        : msg.message?.videoMessage ? 'video'
        : null;

      console.log(`[WhatsApp] Message from ${phone}: ${text || '[media]'}`);

      try {
        const replies = handleMessage(phone, text, hasMedia, mediaType);
        if (replies && replies.length > 0) {
          for (const reply of replies) {
            await sock.sendMessage(msg.key.remoteJid, { text: reply });
            logChat(phone, 'out', reply);
            // Small delay between messages
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
  logChat(phone.replace('@s.whatsapp.net', ''), 'out', text);
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
