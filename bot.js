const {
  getConfig, setConfig,
  createLead, getLeadByPhone,
  logChat,
  getConversation, updateConversation, pauseBot, isPaused
} = require('./db');

const EDUCATION_MAP = {
  '1': 'Diploma',
  '2': 'Bachelors (2 year)',
  '3': 'Bachelors (4 year)',
  '4': 'Masters',
  '5': 'MPhil',
  '6': 'PhD',
  '7': 'Medical Doctor (MD/MBBS)',
  '8': 'Mufti/Aalim',
  '9': 'Others'
};

/**
 * Check if a phone number is Pakistani (+92 / 92...)
 */
function isPakistani(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  return cleaned.startsWith('92');
}

/**
 * Main message handler — processes incoming message and returns reply text(s).
 * Returns an array of strings to send as separate messages, or null if bot should stay silent.
 */
function handleMessage(phone, text, hasMedia = false, mediaType = null) {
  // Check global bot toggle
  if (getConfig('bot_enabled') !== '1') return null;

  // Check if bot is paused for this conversation
  if (isPaused(phone)) return null;

  // Log incoming message
  logChat(phone, 'in', text || (hasMedia ? `[${mediaType || 'media'}]` : ''));

  const conv = getConversation(phone);
  const input = (text || '').trim();

  // ─── State machine ────────────────────────────────────────────────────

  // Handle "0" → Main Menu from any state
  if (input === '0') {
    updateConversation(phone, { state: 'idle', step: null, data: '{}' });
    return [getConfig('welcome_message')];
  }

  switch (conv.state) {
    case 'idle':
    case null:
      return handleMenu(phone, input, hasMedia, mediaType);

    case 'register':
      return handleRegistration(phone, input, conv);

    case 'choose_plan':
      return handlePlanSelection(phone, input, conv);

    case 'awaiting_screenshot':
      return handleScreenshot(phone, input, hasMedia, mediaType, conv);

    case 'talk_to_admin':
      // Bot is passive — admin replied or user is chatting
      // Keep bot paused until admin reactivates
      return null;

    default:
      updateConversation(phone, { state: 'idle', step: null, data: '{}' });
      return [getConfig('welcome_message')];
  }
}

/**
 * Handle main menu selections
 */
function handleMenu(phone, input, hasMedia, mediaType) {
  switch (input) {
    case '1':
      return [getConfig('how_it_works')];

    case '2':
      // Start registration flow
      updateConversation(phone, { state: 'register', step: 'q1', data: '{}' });
      return [getConfig('register_q1')];

    case '3':
      return [getConfig('pricing_menu')];

    case '4':
      // Talk to admin — pause bot for this conversation
      updateConversation(phone, { state: 'talk_to_admin', step: null });
      pauseBot(phone);
      return [getConfig('talk_to_admin')];

    default:
      // Any other message (including first "hi"/"hello"/etc) → show welcome
      return [getConfig('welcome_message')];
  }
}

/**
 * Handle registration flow step by step
 */
function handleRegistration(phone, input, conv) {
  const data = JSON.parse(conv.data || '{}');

  switch (conv.step) {
    case 'q1': {
      // Name — accept any non-empty text
      if (!input || input.length < 2) {
        return ['Please enter your full name (at least 2 characters).\n_(Example: Ahmed Khan)_'];
      }
      data.name = input;
      updateConversation(phone, { step: 'q2', data: JSON.stringify(data) });
      return [getConfig('register_q2')];
    }

    case 'q2': {
      // Gender
      if (input !== '1' && input !== '2') {
        return ['Please reply with:\n1 — Male\n2 — Female'];
      }
      data.gender = input === '1' ? 'Male' : 'Female';
      updateConversation(phone, { step: 'q3', data: JSON.stringify(data) });
      return [getConfig('register_q3')];
    }

    case 'q3': {
      // DOB Date
      const day = parseInt(input);
      if (isNaN(day) || day < 1 || day > 31) {
        return ['Please enter a valid date (1-31).\n_(Example: 15)_'];
      }
      data.dob_date = String(day);
      updateConversation(phone, { step: 'q4', data: JSON.stringify(data) });
      return [getConfig('register_q4')];
    }

    case 'q4': {
      // DOB Month
      const month = parseInt(input);
      if (isNaN(month) || month < 1 || month > 12) {
        return ['Please enter a valid month (1-12).\n_(Example: 6)_'];
      }
      data.dob_month = String(month);
      updateConversation(phone, { step: 'q5', data: JSON.stringify(data) });
      return [getConfig('register_q5')];
    }

    case 'q5': {
      // DOB Year
      const year = parseInt(input);
      if (isNaN(year) || year < 1940 || year > 2010) {
        return ['Please enter a valid 4-digit year (e.g. 1995).'];
      }
      data.dob_year = String(year);
      updateConversation(phone, { step: 'q6', data: JSON.stringify(data) });
      return [getConfig('register_q6')];
    }

    case 'q6': {
      // City
      if (!input || input.length < 2) {
        return ['Please enter your city name.\n_(Example: Lahore)_'];
      }
      data.city = input;
      updateConversation(phone, { step: 'q7', data: JSON.stringify(data) });
      return [getConfig('register_q7')];
    }

    case 'q7': {
      // Education
      const edu = EDUCATION_MAP[input];
      if (!edu) {
        return ['Please reply with a number (1-9):\n' + getConfig('register_q7')];
      }
      data.education = edu;

      // Registration complete — save lead
      createLead({
        phone,
        name: data.name,
        gender: data.gender,
        dob_date: data.dob_date,
        dob_month: data.dob_month,
        dob_year: data.dob_year,
        city: data.city,
        education: data.education,
        status: 'registered'
      });

      // Determine next step based on phone number and gender
      const completeMsg = getConfig('register_complete').replace('{{name}}', data.name);

      if (!isPakistani(phone)) {
        // Overseas — free registration
        updateConversation(phone, { state: 'idle', step: null, data: '{}' });
        return [completeMsg, getConfig('pricing_overseas')];
      }

      if (data.gender === 'Female') {
        // Pakistani female — free option + paid
        updateConversation(phone, { state: 'choose_plan', step: 'female_pk', data: JSON.stringify(data) });
        return [completeMsg, getConfig('pricing_female_pk')];
      }

      // Pakistani male — paid only
      updateConversation(phone, { state: 'choose_plan', step: 'male_pk', data: JSON.stringify(data) });
      return [completeMsg, getConfig('pricing_male')];
    }

    default:
      updateConversation(phone, { state: 'idle', step: null, data: '{}' });
      return [getConfig('welcome_message')];
  }
}

/**
 * Handle plan selection after registration
 */
function handlePlanSelection(phone, input, conv) {
  const data = JSON.parse(conv.data || '{}');

  if (conv.step === 'female_pk') {
    switch (input) {
      case '1':
        // Free plan → redirect to website
        updateConversation(phone, { state: 'idle', step: null, data: '{}' });
        return [getConfig('free_female_redirect')];
      case '2':
        data.plan = 'Select Plus — PKR 1,499 (2 months)';
        break;
      case '3':
        data.plan = 'Select Queen — PKR 2,999 (4 months)';
        break;
      default:
        return ['Please reply with 1, 2, or 3.'];
    }
  } else {
    // male_pk
    switch (input) {
      case '1':
        data.plan = 'Select Plus — PKR 1,999 (2 months)';
        break;
      case '2':
        data.plan = 'Select Gold — PKR 3,999 (3 months)';
        break;
      case '3':
        data.plan = 'Select Elite — PKR 4,999 (6 months)';
        break;
      default:
        return ['Please reply with 1, 2, or 3.'];
    }
  }

  // Update lead with plan
  const lead = getLeadByPhone(phone);
  if (lead) {
    const { db } = require('./db');
    db.prepare(`UPDATE leads SET plan = ?, updated_at = datetime('now') WHERE id = ?`).run(data.plan, lead.id);
  }

  updateConversation(phone, { state: 'awaiting_screenshot', step: null, data: JSON.stringify(data) });
  return [`You selected: ${data.plan}\n\n${getConfig('bank_details')}`];
}

/**
 * Handle payment screenshot
 */
function handleScreenshot(phone, input, hasMedia, mediaType, conv) {
  if (hasMedia && (mediaType === 'image' || mediaType === 'document')) {
    // Screenshot received — mark as payment_pending
    const lead = getLeadByPhone(phone);
    if (lead) {
      const { db } = require('./db');
      db.prepare(`UPDATE leads SET status = ?, updated_at = datetime('now') WHERE id = ?`).run('payment_pending', lead.id);
    }

    updateConversation(phone, { state: 'idle', step: null, data: '{}' });
    return [getConfig('payment_received')];
  }

  // No media — remind them
  return ['Please send a screenshot of your payment receipt. 📸'];
}

/**
 * Called when admin sends a message from phone to a user.
 * Used to auto-pause the bot for that conversation.
 */
function onAdminReply(phone) {
  pauseBot(phone);
  logChat(phone, 'out_admin', '[Admin replied manually]');
}

module.exports = { handleMessage, onAdminReply, isPakistani };
