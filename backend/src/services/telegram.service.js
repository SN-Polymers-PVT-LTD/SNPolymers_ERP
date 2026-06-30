const { supabase } = require('../db/supabase');
require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Sends OTP to a user's Telegram account via the Bot API.
 * Falls back to console-only logging if telegram_chat_id is not set.
 * @param {string|null} telegramChatId - The user's Telegram chat ID
 * @param {string} otp - The OTP code to send
 */
async function sendOtp(telegramChatId, otp) {
  const messageText = `Your SN Polymers IDBP login code is: \`${otp}\`.\n\n*(Tap/Click the code above to copy it automatically)*\n\nValid for 5 minutes. Do not share this code with anyone.`;

  // Log OTP to terminal in non-production environments only.
  // Never log in production — OTP codes must not appear in cloud logging services.
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n======================================');
    console.log(`[OTP DEBUG] Telegram Chat ID: ${telegramChatId || 'N/A (console fallback)'}`);
    console.log(`[OTP CODE]: ${otp}`);
    console.log('======================================\n');
  }

  if (!telegramChatId) {
    console.log('[OTP SERVICE] No telegram_chat_id set — running in console-only fallback mode.');
    return { success: true, mode: 'console' };
  }

  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[OTP SERVICE] TELEGRAM_BOT_TOKEN is not set — cannot send via Telegram. Falling back to console.');
    return { success: true, mode: 'console' };
  }

  try {
    // encodeURIComponent is correctly applied to both telegramChatId and messageText.
    // This prevents injection if either contains special URL characters (+, &, =, etc.).
    // Verified: no raw string concatenation without encoding in this URL construction (CQ-10).
    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(telegramChatId)}&text=${encodeURIComponent(messageText)}&parse_mode=Markdown`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
    }

    return { success: true, mode: 'telegram', messageId: data.result?.message_id };
  } catch (error) {
    console.error(`[OTP SERVICE] Telegram sendMessage failed: ${error.message}`);
    console.warn('[OTP SERVICE] Falling back to console-only mode due to delivery failure.');
    return { success: true, mode: 'console' };
  }
}

/**
 * Sends a plain text message to a Telegram chat (used by the bot auto-reply).
 * @param {string|number} chatId
 * @param {string} text
 */
async function sendBotMessage(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.ok) {
      console.warn(`[BOT] Failed to send reply to ${chatId}: ${data.description}`);
    }
  } catch (err) {
    console.warn(`[BOT] sendBotMessage error: ${err.message}`);
  }
}

/**
 * Starts a long-polling loop using Telegram getUpdates (timeout=30).
 * Controlled by the TELEGRAM_MODE env variable:
 *   - 'polling'  → runs the long-poll loop (default in development)
 *   - 'webhook'  → does nothing; Telegram delivers updates via HTTP POST instead
 *
 * This function runs indefinitely in the background — call it once on
 * server startup. It uses offset tracking to avoid processing the same
 * update twice.
 */
async function startPolling() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[BOT] TELEGRAM_BOT_TOKEN not set — Telegram long polling not started.');
    return;
  }

  // Determine effective mode: default to 'webhook' in production, 'polling' in development
  const telegramMode = process.env.TELEGRAM_MODE ||
    (process.env.NODE_ENV === 'production' ? 'webhook' : 'polling');

  if (telegramMode === 'webhook') {
    console.log('[BOT] TELEGRAM_MODE=webhook — long polling skipped. Updates delivered via webhook.');
    return;
  }

  console.log('[BOT] Telegram long polling started. Waiting for messages from @snpolymers_bot...');

  let offset = 0;
  let conflictLogged = false;

  // Infinite polling loop — runs for the lifetime of the server process
  const poll = async () => {
    try {
      const url = `${TELEGRAM_API_BASE}/getUpdates?timeout=30&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.ok) {
        const isConflict = data.description && data.description.includes('Conflict');
        if (isConflict) {
          if (!conflictLogged) {
            console.warn(`[BOT] getUpdates error: Conflict (another instance is running). Suppressing further conflict logs.`);
            conflictLogged = true;
          }
        } else {
          console.warn(`[BOT] getUpdates error: ${data.description || 'Unknown error'}`);
          conflictLogged = false;
        }
      } else {
        conflictLogged = false;
        for (const update of data.result) {
          // Advance offset so this update is not processed again
          offset = update.update_id + 1;

          // Call the unified update processor directly to handle start commands and contacts
          await processWebhookUpdate(update);
        }
      }
    } catch (err) {
      // Network errors (e.g., temporary connectivity loss) — log and retry
      console.error(`[BOT] Polling error: ${err.message}. Retrying in 5s...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Schedule next poll immediately (long-polling keeps the connection alive)
    setImmediate(poll);
  };

  // Kick off the loop
  poll();
}

/**
 * Sends a Telegram message containing a native "Share Contact" button requesting phone link.
 */
async function sendContactRequestKeyboard(chatId, firstName) {
  if (!TELEGRAM_BOT_TOKEN) return;
  try {
    // Use a visually prominent message with arrows pointing to the keyboard button
    const text =
      `👋 Hi *${firstName}*! Welcome to *SN Polymers IDBP*.\n\n` +
      `To securely link your account and receive your login code, tap the button below to share your registered phone number.\n\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `              👇  *TAP THE BUTTON BELOW*  👇`;

    const replyMarkup = {
      keyboard: [[{
        // Emoji-rich button label to catch the eye
        text: "📲  SHARE MY NUMBER  →  Link Account",
        request_contact: true
      }]],
      // resize_keyboard: false renders a taller, more prominent button
      resize_keyboard: false,
      one_time_keyboard: true
    };
    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(text)}&parse_mode=Markdown&reply_markup=${encodeURIComponent(JSON.stringify(replyMarkup))}`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.ok) {
      console.warn(`[BOT] Failed to send contact keyboard to ${chatId}: ${data.description}`);
    }
  } catch (err) {
    console.warn(`[BOT] sendContactRequestKeyboard error: ${err.message}`);
  }
}

/**
 * Parses and handles a Telegram update payload delivered via webhook.
 */
async function processWebhookUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat?.id;
  if (!chatId) return;

  const text = message.text;
  const contact = message.contact;

  if (text && text.startsWith('/start')) {
    const firstName = message.from?.first_name || 'there';
    await sendContactRequestKeyboard(chatId, firstName);
    return;
  }

  if (contact) {
    const firstName = contact.first_name || 'there';
    let phone = contact.phone_number;
    if (!phone) return;

    // Normalise phone number to match the +91XXXXXXXXXX format stored in DB
    let normalizedPhone = phone.trim().replace(/\s+/g, '');
    if (!normalizedPhone.startsWith('+')) {
      normalizedPhone = '+' + normalizedPhone;
    }

    try {
      // Find active user with this normalized mobile number
      const { data: user, error } = await supabase
        .from('authorised_users')
        .select('*')
        .eq('mobile_number', normalizedPhone)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;

      if (!user) {
        const rejectMsg = `❌ *Access Denied.*\n\nThe phone number *${normalizedPhone}* is not whitelisted or is inactive in the system.\n\nPlease contact the administrator to whitelist your mobile number first.`;
        await sendBotMessage(chatId, rejectMsg);
        console.log(`[BOT] Rejected connection for unwhitelisted number ${normalizedPhone} (chat_id: ${chatId})`);
        return;
      }

      // Link account
      const { data: updateData, error: updateError } = await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: String(chatId) })
        .eq('id', user.id)
        .select();

      if (updateError) throw updateError;
      console.log(`[BOT] Database update result:`, updateData);

      const successMsg = `✅ *Account Linked Successfully!*\n\nHello *${user.display_name || firstName}*,\n\nYour Telegram account is now securely linked to the Integrated Digital Business Platform.\n\nYou can close Telegram and return to your web browser to continue logging in.`;
      
      const replyMarkup = { remove_keyboard: true };
      const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(successMsg)}&parse_mode=Markdown&reply_markup=${encodeURIComponent(JSON.stringify(replyMarkup))}`;
      await fetch(url);

      console.log(`[BOT] Linked phone number ${normalizedPhone} to Chat ID ${chatId} (${user.display_name})`);

    } catch (err) {
      console.error(`[BOT] Error linking contact for chat ${chatId}:`, err);
      const errMsg = `⚠️ An error occurred while linking your account. Please try again.`;
      await sendBotMessage(chatId, errMsg);
    }
    return;
  }

  // Fallback info message
  const fallbackMsg = `💡 *SN Polymers IDBP Bot*\n\nPlease tap the link on the web application login screen to start the setup process.`;
  await sendBotMessage(chatId, fallbackMsg);
}

/**
 * Automatically registers the webhook endpoint with Telegram on server startup.
 * Controlled by the TELEGRAM_MODE env variable:
 *   - 'webhook'  → registers the webhook URL with Telegram (default in production)
 *   - 'polling'  → skips registration; long polling is used instead
 */
async function registerWebhook() {
  // Determine effective mode: default to 'webhook' in production, 'polling' in development
  const telegramMode = process.env.TELEGRAM_MODE ||
    (process.env.NODE_ENV === 'production' ? 'webhook' : 'polling');

  if (telegramMode !== 'webhook') {
    console.log('[BOT] TELEGRAM_MODE=polling — skipping webhook registration.');
    return;
  }

  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[BOT] TELEGRAM_BOT_TOKEN not set — cannot register webhook.');
    return;
  }
  if (!WEBHOOK_URL) {
    console.warn('[BOT] WEBHOOK_URL is not set — cannot register webhook.');
    return;
  }

  try {
    const targetUrl = `${WEBHOOK_URL}/api/v1/telegram-webhook`;
    let setupUrl = `${TELEGRAM_API_BASE}/setWebhook?url=${encodeURIComponent(targetUrl)}`;
    if (WEBHOOK_SECRET) {
      setupUrl += `&secret_token=${encodeURIComponent(WEBHOOK_SECRET)}`;
    }

    const response = await fetch(setupUrl);
    const data = await response.json();
    if (data.ok) {
      console.log(`[BOT] Telegram Webhook registered successfully to: ${targetUrl}`);
    } else {
      console.error(`[BOT] Telegram Webhook registration failed: ${data.description}`);
    }
  } catch (err) {
    console.error(`[BOT] Error registering Telegram webhook: ${err.message}`);
  }
}

/**
 * Sends a notification to all active ZO users when a new estimate is submitted.
 * @param {object} estimate - The submitted estimate object (enriched with projects_master data if possible)
 */
async function notifyZoEstimateSubmitted(estimate) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    // 1. Fetch active ZO users with non-null chat IDs:
    const { data: zoUsers, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'zo')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve active ZO users: ${error.message}`);
      return;
    }

    // 2. Filter list in JS to ensure clean values (excluding empty strings and whitespace):
    const recipients = (zoUsers || []).filter(u => u.telegram_chat_id && u.telegram_chat_id.trim() !== '');

    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active ZO users configured with Telegram chat IDs for estimate submission notification. ` +
        `Estimate: ${estimate?.estimate_id || 'N/A'}, Work Order: ${estimate?.work_order_no || 'N/A'}`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(
        `[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set. Silent console fallback. ` +
        `Estimate ID: ${estimate?.estimate_id}, Work Order: ${estimate?.work_order_no}`
      );
      return;
    }

    const estimateNo = estimate.estimate_no || 'N/A';
    const amount = estimate.estimate_amount || 0;
    const workOrder = estimate.work_order_no || 'N/A';
    const siteDetails = estimate.projects_master?.site_details || 'N/A';

    const messageText = 
      `📝 *New Estimate Submitted*\n\n` +
      `*Estimate No:* ${estimateNo}\n` +
      `*Work Order:* ${workOrder}\n` +
      `*Site Details:* ${siteDetails}\n` +
      `*Amount:* ₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `*Submitted By:* ${estimate.je_user_id || 'N/A'}\n\n` +
      `Please review this estimate on the IDBP dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id)}&text=${encodeURIComponent(messageText)}&parse_mode=Markdown`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send message to ${recipient.display_name} (${recipient.telegram_chat_id}): ${data.description}`);
        } else {
          console.log(`[TELEGRAM ALERTS] Notification sent to ${recipient.display_name}`);
        }
      } catch (err) {
        console.warn(`[TELEGRAM ALERTS] Failed to send message to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyZoEstimateSubmitted failed: ${error.message}`);
  }
}

async function notifyHoEstimateApproved(estimate) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    // 1. Fetch active HO users with non-null chat IDs:
    const { data: hoUsers, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve active HO users: ${error.message}`);
      return;
    }

    // 2. Filter list in JS to ensure clean values (excluding empty strings and whitespace):
    const recipients = (hoUsers || []).filter(u => u.telegram_chat_id && u.telegram_chat_id.trim() !== '');

    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active HO users configured with Telegram chat IDs for estimate approval notification. ` +
        `Estimate: ${estimate?.estimate_id || 'N/A'}, Work Order: ${estimate?.work_order_no || 'N/A'}`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(
        `[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set. Silent console fallback. ` +
        `Estimate ID: ${estimate?.estimate_id}, Work Order: ${estimate?.work_order_no}`
      );
      return;
    }

    const estimateNo = estimate.estimate_no || 'N/A';
    const amount = estimate.estimate_amount || 0;
    const workOrder = estimate.work_order_no || 'N/A';
    const siteDetails = estimate.projects_master?.site_details || 'N/A';

    const messageText = 
      `✅ *Estimate Approved by ZO*\n\n` +
      `*Estimate No:* ${estimateNo}\n` +
      `*Work Order:* ${workOrder}\n` +
      `*Site Details:* ${siteDetails}\n` +
      `*Approved Zonal Amount:* ₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `*Approved By ZO:* ${estimate.zo_approved_by || 'N/A'}\n\n` +
      `Please review and finalize this estimate on the IDBP dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id)}&text=${encodeURIComponent(messageText)}&parse_mode=Markdown`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send message to ${recipient.display_name} (${recipient.telegram_chat_id}): ${data.description}`);
        } else {
          console.log(`[TELEGRAM ALERTS] Notification sent to ${recipient.display_name}`);
        }
      } catch (err) {
        console.warn(`[TELEGRAM ALERTS] Failed to send message to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyHoEstimateApproved failed: ${error.message}`);
  }
}

async function notifyZoFundRequestApproved(originalRequest, updatedRequest) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: zoUser, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('mobile_number', originalRequest.zo_user_id)
      .maybeSingle();

    if (error) {
      console.warn(`[FUND REQUEST] Failed to fetch ZO user for notification: ${error.message}`);
      return;
    }

    if (!zoUser || !zoUser.telegram_chat_id || zoUser.telegram_chat_id.trim() === '') {
      console.warn(
        `[FUND REQUEST] ZO user ${originalRequest.zo_user_id} has no Telegram chat ID configured. ` +
        `Fund Request: ${originalRequest.fund_request_id}, FR No: ${originalRequest.zo_fr_no}`
      );
      return;
    }

    const activeToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!activeToken) {
      console.warn(
        `[FUND REQUEST] TELEGRAM_BOT_TOKEN not set. Cannot notify ZO for FR: ${originalRequest.zo_fr_no}`
      );
      return;
    }

    const approvedAmount = Number(updatedRequest.approve_ho_amount);
    const requestedAmount = Number(originalRequest.zo_fr_amount);
    const account = updatedRequest.transfer_from_account;

    // Escape underscores for Telegram Markdown V1 parser
    const frNoClean = String(originalRequest.zo_fr_no).replace(/_/g, '\\_');
    const remarksClean = String(updatedRequest.ho_remarks || 'None').replace(/_/g, '\\_');

    const messageText =
      `✅ *Fund Request Approved*\n\n` +
      `*Fund Request No:* ${frNoClean}\n` +
      `*Requested Amount:* ₹${requestedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `*Approved Amount:* ₹${approvedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `*Transfer Account:* ${account}\n` +
      `*HO Remarks:* ${remarksClean}\n\n` +
      `Your fund request has been approved. Funds will be transferred from the *${account}* account.`;

    const apiBase = `https://api.telegram.org/bot${activeToken}`;
    const url = `${apiBase}/sendMessage?chat_id=${encodeURIComponent(zoUser.telegram_chat_id)}&text=${encodeURIComponent(messageText)}&parse_mode=Markdown`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      console.warn(
        `[FUND REQUEST] Telegram notification failed for ${zoUser.display_name}: ${data.description}`
      );
    } else {
      console.log(`[FUND REQUEST] Approval notification sent to ${zoUser.display_name}`);
    }

  } catch (error) {
    console.error(`[FUND REQUEST] notifyZoFundRequestApproved failed: ${error.message}`);
  }
}

module.exports = {
  sendOtp,
  startPolling,
  processWebhookUpdate,
  registerWebhook,
  notifyZoEstimateSubmitted,
  notifyHoEstimateApproved,
  notifyZoFundRequestApproved
};


