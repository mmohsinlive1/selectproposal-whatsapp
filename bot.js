const {
  getConfig, getAllConfig,
  createLead, getLeadByPhone, updateLead,
  saveChat,
  getConversation, upsertConversation, pauseBot
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

function isPakistani(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  return cleaned.startsWith('92');
}

/**
 * Main message handler — async, processes incoming message and returns reply text(s).
 * Returns an array of strings to send, or null if bot should stay silent.
 */
async function handleMessage(phone, text, hasMedia = false, mediaType = null) {
  // Check global bot toggle
  const botEnabled = await getConfig('bot_enabled');
  if (botEnabled !== '1') return null;

  // Check if bot is paused for this conversation
  const conv = await getConversation(phone);
  if (conv?.bot_paused) return null;

  // Log incoming message
  await saveChat(phone, 'in', text || (hasMedia ? `[${mediaType || 'media'}]` : ''));

  const input = (text || '').trim();
  const state = conv?.state || 'idle';

  // Handle "0" → Main Menu from any state
  if (input === '0') {
    await upsertConversation(phone, { state: 'idle', step: null, data: {} });
    return [await getConfig('welcome_message')];
  }

  switch (state) {
    case 'idle':
      return handleMenu(phone, input, hasMedia, mediaType);
    case 'register':
      return handleRegistration(phone, input, conv);
    case 'choose_plan':
      return handlePlanSelection(phone, input, conv);
    case 'awaiting_screenshot':
      return handleScreenshot(phone, input, hasMedia, mediaType, conv);
    case 'talk_to_admin':
      return null;
    default:
      await upsertConversation(phone, { state: 'idle', step: null, data: {} });
      return [await getConfig('welcome_message')];
  }
}

async function handleMenu(phone, input) {
  switch (input) {
    case '1':
      return [await getConfig('how_it_works')];
    case '2':
      await upsertConversation(phone, { state: 'register', step: 'q1', data: {} });
      return [await getConfig('register_q1')];
    case '3':
      return [await getConfig('pricing_menu')];
    case '4':
      await upsertConversation(phone, { state: 'talk_to_admin', step: null });
      await pauseBot(phone);
      return [await getConfig('talk_to_admin')];
    default:
      return [await getConfig('welcome_message')];
  }
}

async function handleRegistration(phone, input, conv) {
  const data = typeof conv.data === 'string' ? JSON.parse(conv.data) : (conv.data || {});

  switch (conv.step) {
    case 'q1': {
      if (!input || input.length < 2) {
        return ['Please enter your full name (at least 2 characters).\n_(Example: Ahmed Khan)_'];
      }
      data.name = input;
      await upsertConversation(phone, { state: 'register', step: 'q2', data });
      return [await getConfig('register_q2')];
    }
    case 'q2': {
      if (input !== '1' && input !== '2') {
        return ['Please reply with:\n1 — Male\n2 — Female'];
      }
      data.gender = input === '1' ? 'Male' : 'Female';
      await upsertConversation(phone, { state: 'register', step: 'q3', data });
      return [await getConfig('register_q3')];
    }
    case 'q3': {
      const day = parseInt(input);
      if (isNaN(day) || day < 1 || day > 31) return ['Please enter a valid date (1-31).\n_(Example: 15)_'];
      data.dob_date = String(day);
      await upsertConversation(phone, { state: 'register', step: 'q4', data });
      return [await getConfig('register_q4')];
    }
    case 'q4': {
      const month = parseInt(input);
      if (isNaN(month) || month < 1 || month > 12) return ['Please enter a valid month (1-12).\n_(Example: 6)_'];
      data.dob_month = String(month);
      await upsertConversation(phone, { state: 'register', step: 'q5', data });
      return [await getConfig('register_q5')];
    }
    case 'q5': {
      const year = parseInt(input);
      if (isNaN(year) || year < 1940 || year > 2010) return ['Please enter a valid 4-digit year (e.g. 1995).'];
      data.dob_year = String(year);
      await upsertConversation(phone, { state: 'register', step: 'q6', data });
      return [await getConfig('register_q6')];
    }
    case 'q6': {
      if (!input || input.length < 2) return ['Please enter your city name.\n_(Example: Lahore)_'];
      data.city = input;
      await upsertConversation(phone, { state: 'register', step: 'q7', data });
      return [await getConfig('register_q7')];
    }
    case 'q7': {
      const edu = EDUCATION_MAP[input];
      if (!edu) return ['Please reply with a number (1-9):\n' + await getConfig('register_q7')];
      data.education = edu;

      // Save lead
      await createLead(phone);
      const lead = await getLeadByPhone(phone);
      if (lead) {
        await updateLead(lead.id, {
          name: data.name,
          gender: data.gender,
          dob_date: parseInt(data.dob_date),
          dob_month: parseInt(data.dob_month),
          dob_year: parseInt(data.dob_year),
          city: data.city,
          education: data.education
        });
      }

      const completeMsg = (await getConfig('register_complete')).replace('{{name}}', data.name);

      if (!isPakistani(phone)) {
        await upsertConversation(phone, { state: 'idle', step: null, data: {} });
        return [completeMsg, await getConfig('pricing_overseas')];
      }
      if (data.gender === 'Female') {
        await upsertConversation(phone, { state: 'choose_plan', step: 'female_pk', data });
        return [completeMsg, await getConfig('pricing_female_pk')];
      }
      await upsertConversation(phone, { state: 'choose_plan', step: 'male_pk', data });
      return [completeMsg, await getConfig('pricing_male')];
    }
    default:
      await upsertConversation(phone, { state: 'idle', step: null, data: {} });
      return [await getConfig('welcome_message')];
  }
}

async function handlePlanSelection(phone, input, conv) {
  const data = typeof conv.data === 'string' ? JSON.parse(conv.data) : (conv.data || {});

  if (conv.step === 'female_pk') {
    switch (input) {
      case '1':
        await upsertConversation(phone, { state: 'idle', step: null, data: {} });
        return [await getConfig('free_female_redirect')];
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

  const lead = await getLeadByPhone(phone);
  if (lead) {
    await updateLead(lead.id, { plan: data.plan });
  }

  await upsertConversation(phone, { state: 'awaiting_screenshot', step: null, data });
  return [`You selected: ${data.plan}\n\n${await getConfig('bank_details')}`];
}

async function handleScreenshot(phone, input, hasMedia, mediaType) {
  if (hasMedia && (mediaType === 'image' || mediaType === 'document')) {
    const lead = await getLeadByPhone(phone);
    if (lead) {
      await updateLead(lead.id, { status: 'payment_pending' });
    }
    await upsertConversation(phone, { state: 'idle', step: null, data: {} });
    return [await getConfig('payment_received')];
  }
  return ['Please send a screenshot of your payment receipt. 📸'];
}

async function onAdminReply(phone) {
  await pauseBot(phone);
  await saveChat(phone, 'out_admin', '[Admin replied manually]');
}

module.exports = { handleMessage, onAdminReply, isPakistani };
