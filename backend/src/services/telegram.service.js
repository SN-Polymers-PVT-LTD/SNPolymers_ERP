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
  const cleanChatId = telegramChatId ? String(telegramChatId).trim() : null;
  const messageText = `Your SN Polymers IDBP login code is: \`${otp}\`.\n\n*(Tap/Click the code above to copy it automatically)*\n\nValid for 5 minutes. Do not share this code with anyone.`;

  // Log OTP to terminal in non-production environments only.
  // Never log in production — OTP codes must not appear in cloud logging services.
  if (process.env.NODE_ENV !== 'production') {
    console.log('\n======================================');
    console.log(`[OTP DEBUG] Telegram Chat ID: ${cleanChatId || 'N/A (console fallback)'}`);
    console.log(`[OTP CODE]: ${otp}`);
    console.log('======================================\n');
  }

  if (!cleanChatId) {
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
    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(cleanChatId)}&text=${encodeURIComponent(messageText)}&parse_mode=Markdown`;
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
  const cleanChatId = chatId ? String(chatId).trim() : '';
  try {
    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(cleanChatId)}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.ok) {
      console.warn(`[BOT] Failed to send reply to ${cleanChatId}: ${data.description}`);
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

  // Delete webhook before starting polling to resolve conflict if webhook is active on the bot
  try {
    console.log('[BOT] Deleting any existing webhook to enable long polling...');
    const deleteUrl = `${TELEGRAM_API_BASE}/deleteWebhook?drop_pending_updates=true`;
    const delRes = await fetch(deleteUrl);
    const delData = await delRes.json();
    if (delData.ok) {
      console.log('[BOT] Active Telegram webhook cleared successfully for long-polling.');
    } else {
      console.warn(`[BOT] Failed to clear Telegram webhook: ${delData.description}`);
    }
  } catch (err) {
    console.warn(`[BOT] Error clearing Telegram webhook: ${err.message}`);
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
 * Escapes special HTML characters to prevent parse_mode=HTML injection errors.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Resolves a mobile number to a display name.
 * Falls back to the mobile number if not found or on error.
 * @param {string} mobileNumber
 * @returns {Promise<string>}
 */
async function getDisplayName(mobileNumber) {
  if (!mobileNumber) return 'N/A';
  try {
    const { data, error } = await supabase
      .from('authorised_users')
      .select('display_name')
      .eq('mobile_number', mobileNumber)
      .maybeSingle();
    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to resolve display name for ${mobileNumber}: ${error.message}`);
      return mobileNumber;
    }
    return data?.display_name || mobileNumber;
  } catch (err) {
    console.warn(`[TELEGRAM ALERTS] Failed to resolve display name for ${mobileNumber}: ${err.message}`);
    return mobileNumber;
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

    const estimateNo = escapeHtml(estimate.estimate_no || 'N/A');
    const amount = Number(estimate.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const workOrder = escapeHtml(estimate.work_order_no || 'N/A');
    const siteDetails = escapeHtml(estimate.projects_master?.site_details || 'N/A');
    const jeName = await getDisplayName(estimate.je_user_id);
    const jeUserId = escapeHtml(jeName);

    const messageText = 
      `📝 <b>New Estimate Submitted</b>\n\n` +
      `<b>Estimate No:</b> ${estimateNo}\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Details:</b> ${siteDetails}\n` +
      `<b>Amount:</b> ₹${amount}\n` +
      `<b>Submitted By:</b> ${jeUserId}\n\n` +
      `Please review this estimate on the IDBP dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send message to ${recipient.display_name} (${recipient.telegram_chat_id.trim()}): ${data.description}`);
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

    const estimateNo = escapeHtml(estimate.estimate_no || 'N/A');
    const amount = Number(estimate.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const workOrder = escapeHtml(estimate.work_order_no || 'N/A');
    const siteDetails = escapeHtml(estimate.projects_master?.site_details || 'N/A');
    const zoName = await getDisplayName(estimate.zo_approved_by);
    const zoApprovedBy = escapeHtml(zoName);

    const messageText = 
      `<b>Cost Estimate Approved by ZO</b>\n\n` +
      `<b>Estimate No:</b> ${estimateNo}\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Details:</b> ${siteDetails}\n` +
      `<b>Approved Zonal Amount:</b> ₹${amount}\n` +
      `<b>Approved By ZO:</b> ${zoApprovedBy}\n\n` +
      `Please review and finalize this estimate on the IDBP dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send message to ${recipient.display_name} (${recipient.telegram_chat_id.trim()}): ${data.description}`);
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
    }

    const activeToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!activeToken) {
      console.warn(
        `[FUND REQUEST] TELEGRAM_BOT_TOKEN not set. Cannot notify ZO for FR: ${originalRequest.zo_fr_no}`
      );
      return;
    }

    const recipients = [];
    if (zoUser && zoUser.telegram_chat_id && zoUser.telegram_chat_id.trim() !== '') {
      recipients.push(zoUser);
    }

    // Now query active HO users
    const { data: hoUsers, error: hoErr } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (hoErr) {
      console.warn(`[FUND REQUEST] Failed to retrieve HO users:`, hoErr);
    } else if (hoUsers) {
      for (const ho of hoUsers) {
        if (ho.telegram_chat_id && ho.telegram_chat_id.trim() !== '' && ho.telegram_chat_id !== zoUser?.telegram_chat_id) {
          recipients.push(ho);
        }
      }
    }

    if (recipients.length === 0) {
      console.warn(
        `[FUND REQUEST] No active ZO/HO users configured with Telegram chat IDs for fund request approval notification. ` +
        `FR No: ${originalRequest?.zo_fr_no || 'N/A'}`
      );
      return;
    }

    const approvedAmount = Number(updatedRequest.approve_ho_amount);
    const requestedAmount = Number(originalRequest.zo_fr_amount);
    const account = escapeHtml(updatedRequest.transfer_from_account || 'N/A');

    const frNoClean = escapeHtml(originalRequest.zo_fr_no || 'N/A');
    const remarksClean = escapeHtml(updatedRequest.ho_remarks || 'None');

    // Fetch ZO requester name
    const zoRequesterName = zoUser?.display_name || originalRequest.zo_user_id || 'N/A';

    // Fetch HO actor name
    const { data: hoActor } = await supabase
      .from('authorised_users')
      .select('display_name')
      .eq('mobile_number', updatedRequest.approve_ho_user_id)
      .maybeSingle();
    const hoActorName = hoActor?.display_name || updatedRequest.approve_ho_user_id || 'N/A';

    const messageText =
      `✅ <b>Fund Request Approved by HO</b>\n\n` +
      `<b>Fund Request No:</b> ${frNoClean}\n` +
      `<b>Requested By ZO:</b> ${escapeHtml(zoRequesterName)}\n` +
      `<b>Requested Amount:</b> ₹${requestedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `<b>Approved Amount:</b> ₹${approvedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `<b>Approved By HO:</b> ${escapeHtml(hoActorName)}\n` +
      `<b>Transfer Account:</b> ${account}\n` +
      `<b>HO Remarks:</b> ${remarksClean}\n\n` +
      `The fund request has been approved. Funds will be transferred from the <b>${account}</b> account.`;

    const apiBase = `https://api.telegram.org/bot${activeToken}`;
    for (const recipient of recipients) {
      try {
        const url = `${apiBase}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(
            `[FUND REQUEST] Telegram notification failed for ${recipient.display_name}: ${data.description}`
          );
        } else {
          console.log(`[FUND REQUEST] Approval notification sent to ${recipient.display_name}`);
        }
      } catch (err) {
        console.warn(`[FUND REQUEST] Failed to send message to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[FUND REQUEST] notifyZoFundRequestApproved failed: ${error.message}`);
  }
}

async function notifyJeRevisionRequested(estimate, revisionLog) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: jeUser, error: jeError } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('mobile_number', estimate.created_by)
      .eq('is_active', true)
      .maybeSingle();

    if (jeError) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve JE user: ${jeError.message}`);
      return;
    }

    if (!jeUser || !jeUser.telegram_chat_id || jeUser.telegram_chat_id.trim() === '') {
      console.warn(
        `[TELEGRAM ALERTS] JE user ${estimate.created_by} has no active Telegram chat ID configured.`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set.`);
      return;
    }

    // Fetch line items details
    const { data: items, error: itemsError } = await supabase
      .from('project_cost_estimate_items')
      .select('zo_office_approve, ho_office_approve')
      .eq('estimate_id', estimate.estimate_id);

    if (itemsError) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve line items: ${itemsError.message}`);
      return;
    }

    const totalRows = items ? items.length : 0;
    const stage = revisionLog.stage;
    const approveField = stage === 'ZO' ? 'zo_office_approve' : 'ho_office_approve';
    const notApprovedRows = items ? items.filter(item => item[approveField] === 'Not Approve').length : 0;

    const requestedByMob = revisionLog.requested_by;
    const { resolveDisplayNames } = require('../controllers/estimates.helpers');
    const userMap = await resolveDisplayNames([requestedByMob]);
    const requestedByName = userMap[requestedByMob] || requestedByMob || 'N/A';

    const estimateNo = escapeHtml(estimate.estimate_no || 'N/A');
    const workOrder = escapeHtml(estimate.work_order_no || 'N/A');
    const siteDetails = escapeHtml(estimate.projects_master?.site_details || 'N/A');
    const deadlineFormatted = new Date(revisionLog.revision_deadline).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata'
    });

    const messageText =
      `⚠️ <b>Estimate Revision Requested (${stage})</b>\n\n` +
      `<b>Estimate No:</b> ${estimateNo}\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Details:</b> ${siteDetails}\n` +
      `<b>Revision Cycle:</b> ${revisionLog.revision_cycle}\n` +
      `<b>Requested By:</b> ${escapeHtml(requestedByName)}\n` +
      `<b>Unapproved Rows:</b> ${notApprovedRows} out of ${totalRows} rows not approved\n` +
      `<b>Deadline:</b> ${deadlineFormatted} (IST)\n\n` +
      `Please review the remarks and resubmit the revised estimate on the IDBP dashboard.`;

    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(jeUser.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.ok) {
      console.warn(`[TELEGRAM ALERTS] Failed to send message to JE ${jeUser.display_name} (${jeUser.telegram_chat_id.trim()}): ${data.description}`);
    } else {
      console.log(`[TELEGRAM ALERTS] Revision request notification sent to JE ${jeUser.display_name}`);
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyJeRevisionRequested failed: ${error.message}`);
  }
}

async function notifyHoFundRequestSubmitted(fundRequest) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: hoUsers, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve active HO users for fund request notification: ${error.message}`);
      return;
    }

    const recipients = (hoUsers || []).filter(u => u.telegram_chat_id && u.telegram_chat_id.trim() !== '');
    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active HO users configured with Telegram chat IDs for fund request submission. ` +
        `Fund Request No: ${fundRequest?.zo_fr_no || 'N/A'}`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN not set.`);
      return;
    }

    const { data: zoUser } = await supabase
      .from('authorised_users')
      .select('display_name')
      .eq('mobile_number', fundRequest.zo_user_id)
      .maybeSingle();
    const zoName = zoUser?.display_name || fundRequest.zo_user_id || 'N/A';

    const frNo = escapeHtml(fundRequest.zo_fr_no || 'N/A');
    const amount = Number(fundRequest.zo_fr_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const remarks = escapeHtml(fundRequest.zo_remarks || 'None');

    const messageText =
      `📥 <b>New Fund Request Submitted</b>\n\n` +
      `<b>Fund Request No:</b> ${frNo}\n` +
      `<b>Requested Amount:</b> ₹${amount}\n` +
      `<b>Submitted By:</b> ${escapeHtml(zoName)}\n` +
      `<b>Remarks:</b> ${remarks}\n\n` +
      `Please review this fund request on the IDBP dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send fund request notification to ${recipient.display_name}: ${data.description}`);
        }
      } catch (err) {
        console.warn(`[TELEGRAM ALERTS] Failed to send fund request notification to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyHoFundRequestSubmitted failed: ${error.message}`);
  }
}

async function notifyZoFundRequestHeld(originalRequest, updatedRequest) {
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
        `[FUND REQUEST] ZO user ${originalRequest.zo_user_id} has no Telegram chat ID configured for hold notification.`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[FUND REQUEST] TELEGRAM_BOT_TOKEN not set.`);
      return;
    }

    const requestedAmount = Number(originalRequest.zo_fr_amount);
    const frNoClean = escapeHtml(originalRequest.zo_fr_no || 'N/A');
    const remarksClean = escapeHtml(updatedRequest.ho_remarks || 'None');

    const messageText =
      `⚠️ <b>Fund Request Placed on Hold</b>\n\n` +
      `<b>Fund Request No:</b> ${frNoClean}\n` +
      `<b>Requested Amount:</b> ₹${requestedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
      `<b>HO Remarks:</b> ${remarksClean}\n\n` +
      `Your fund request has been placed on hold. Please check the dashboard for details.`;

    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(zoUser.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      console.warn(`[FUND REQUEST] Telegram hold notification failed for ${zoUser.display_name}: ${data.description}`);
    } else {
      console.log(`[FUND REQUEST] Hold notification sent to ${zoUser.display_name}`);
    }
  } catch (error) {
    console.error(`[FUND REQUEST] notifyZoFundRequestHeld failed: ${error.message}`);
  }
}

async function notifyZoRequisitionSubmitted(requisition) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: zoUsers, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'zo')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve active ZO users for requisition: ${error.message}`);
      return;
    }

    const recipients = (zoUsers || []).filter(u => u.telegram_chat_id && u.telegram_chat_id.trim() !== '');
    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active ZO users configured with Telegram chat IDs for requisition submission. ` +
        `Requisition No: ${requisition?.requisition_no || 'N/A'}`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set.`);
      return;
    }

    const { data: jeUser } = await supabase
      .from('authorised_users')
      .select('display_name')
      .eq('mobile_number', requisition.requester_user_id)
      .maybeSingle();
    const jeName = jeUser?.display_name || requisition.requester_user_id || 'N/A';

    const reqNo = escapeHtml(requisition.requisition_no || 'N/A');
    const workOrder = escapeHtml(requisition.work_order_no || 'N/A');
    const siteDetails = escapeHtml(requisition.site_details || 'N/A');
    const materialHead = escapeHtml(requisition.material_main_head || 'N/A');
    const amount = Number(requisition.requisition_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const remarks = escapeHtml(requisition.expen_head_remarks || 'None');

    const messageText =
      `📥 <b>New Payment Requisition Submitted</b>\n\n` +
      `<b>Requisition No:</b> ${reqNo}\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Details:</b> ${siteDetails}\n` +
      `<b>Material Head:</b> ${materialHead}\n` +
      `<b>Amount:</b> ₹${amount}\n` +
      `<b>Submitted By:</b> ${escapeHtml(jeName)}\n` +
      `<b>Remarks:</b> ${remarks}\n\n` +
      `Please review this requisition on the IDBP dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id)}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send requisition notification to ${recipient.display_name}: ${data.description}`);
        }
      } catch (err) {
        console.warn(`[TELEGRAM ALERTS] Failed to send requisition notification to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyZoRequisitionSubmitted failed: ${error.message}`);
  }
}

async function notifyHoRequisitionSubmitted(requisition) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: hoUsers, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve active HO users for requisition: ${error.message}`);
      return;
    }

    const recipients = (hoUsers || []).filter(u => u.telegram_chat_id && u.telegram_chat_id.trim() !== '');
    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active HO users configured with Telegram chat IDs for requisition submission. ` +
        `Requisition No: ${requisition?.requisition_no || 'N/A'}`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set.`);
      return;
    }

    const { data: jeUser } = await supabase
      .from('authorised_users')
      .select('display_name')
      .eq('mobile_number', requisition.requester_user_id)
      .maybeSingle();
    const jeName = jeUser?.display_name || requisition.requester_user_id || 'N/A';

    const reqNo = escapeHtml(requisition.requisition_no || 'N/A');
    const workOrder = escapeHtml(requisition.work_order_no || 'N/A');
    const siteDetails = escapeHtml(requisition.site_details || 'N/A');
    const materialHead = escapeHtml(requisition.material_main_head || 'N/A');
    const amount = Number(requisition.requisition_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const remarks = escapeHtml(requisition.expen_head_remarks || 'None');

    const messageText =
      `📥 <b>New Payment Requisition Submitted</b>\n\n` +
      `<b>Requisition No:</b> ${reqNo}\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Details:</b> ${siteDetails}\n` +
      `<b>Material Head:</b> ${materialHead}\n` +
      `<b>Amount:</b> ₹${amount}\n` +
      `<b>Submitted By:</b> ${escapeHtml(jeName)}\n` +
      `<b>Remarks:</b> ${remarks}\n\n` +
      `Please review this requisition on the IDBP dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send requisition notification to ${recipient.display_name}: ${data.description}`);
        }
      } catch (err) {
        console.warn(`[TELEGRAM ALERTS] Failed to send requisition notification to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyHoRequisitionSubmitted failed: ${error.message}`);
  }
}

async function notifyJeRequisitionActed(originalRequisition, updatedRequisition) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: jeUser, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('mobile_number', originalRequisition.requester_user_id)
      .maybeSingle();

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to fetch JE user for requisition notification: ${error.message}`);
      return;
    }

    if (!jeUser || !jeUser.telegram_chat_id || jeUser.telegram_chat_id.trim() === '') {
      console.warn(
        `[TELEGRAM ALERTS] JE user ${originalRequisition.requester_user_id} has no Telegram chat ID configured.`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set.`);
      return;
    }

    const action = updatedRequisition.requisition_status;
    const reqNo = escapeHtml(originalRequisition.requisition_no || 'N/A');
    const workOrder = escapeHtml(originalRequisition.work_order_no || 'N/A');
    const requestedAmount = Number(originalRequisition.requisition_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const remarks = escapeHtml(updatedRequisition.remarks_approved_authority || 'None');

    let messageText = '';
    if (action === 'Approved') {
      const approvedAmount = Number(updatedRequisition.approved_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      messageText =
        `✅ <b>Payment Requisition Approved</b>\n\n` +
        `<b>Requisition No:</b> ${reqNo}\n` +
        `<b>Work Order:</b> ${workOrder}\n` +
        `<b>Requested Amount:</b> ₹${requestedAmount}\n` +
        `<b>Approved Amount:</b> ₹${approvedAmount}\n` +
        `<b>Remarks:</b> ${remarks}\n\n` +
        `Your payment requisition has been approved.`;
    } else if (action === 'Hold') {
      messageText =
        `⚠️ <b>Payment Requisition Placed on Hold</b>\n\n` +
        `<b>Requisition No:</b> ${reqNo}\n` +
        `<b>Work Order:</b> ${workOrder}\n` +
        `<b>Requested Amount:</b> ₹${requestedAmount}\n` +
        `<b>Remarks:</b> ${remarks}\n\n` +
        `Your payment requisition has been placed on hold. Please check the dashboard for details.`;
    } else {
      messageText =
        `🔔 <b>Payment Requisition Status Updated</b>\n\n` +
        `<b>Requisition No:</b> ${reqNo}\n` +
        `<b>Work Order:</b> ${workOrder}\n` +
        `<b>New Status:</b> ${action}\n` +
        `<b>Remarks:</b> ${remarks}`;
    }

    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(jeUser.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      console.warn(`[TELEGRAM ALERTS] Telegram notification failed for ${jeUser.display_name}: ${data.description}`);
    } else {
      console.log(`[TELEGRAM ALERTS] Requisition notification sent to ${jeUser.display_name}`);
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyJeRequisitionActed failed: ${error.message}`);
  }
}

async function notifyZoAndHoRequisitionActed(originalRequisition, updatedRequisition) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: zoUsers, error: zoErr } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'zo')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    const { data: hoUsers, error: hoErr } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (zoErr || hoErr) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve recipients for requisition action:`, zoErr || hoErr);
      return;
    }

    const combined = [...(zoUsers || []), ...(hoUsers || [])];
    const seen = new Set();
    const recipients = [];
    for (const r of combined) {
      if (r.telegram_chat_id && r.telegram_chat_id.trim() !== '' && !seen.has(r.telegram_chat_id)) {
        seen.add(r.telegram_chat_id);
        recipients.push(r);
      }
    }

    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active ZO/HO users configured with Telegram chat IDs for requisition action notification. ` +
        `Requisition No: ${originalRequisition?.requisition_no || 'N/A'}`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set.`);
      return;
    }

    // Fetch actor's display name and role
    const { data: actorUser } = await supabase
      .from('authorised_users')
      .select('display_name, role')
      .eq('mobile_number', updatedRequisition.approved_user_id)
      .maybeSingle();
    const actorName = actorUser?.display_name || updatedRequisition.approved_user_id || 'N/A';
    const actorRole = (actorUser?.role || 'Authority').toUpperCase();

    const action = updatedRequisition.requisition_status;
    const reqNo = escapeHtml(originalRequisition.requisition_no || 'N/A');
    const workOrder = escapeHtml(originalRequisition.work_order_no || 'N/A');
    const requestedAmount = Number(originalRequisition.requisition_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const remarks = escapeHtml(updatedRequisition.remarks_approved_authority || 'None');

    let messageText = '';
    if (action === 'Approved') {
      const approvedAmount = Number(updatedRequisition.approved_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      messageText =
        `✅ <b>Payment Requisition Approved by ${actorRole}</b>\n\n` +
        `<b>Requisition No:</b> ${reqNo}\n` +
        `<b>Work Order:</b> ${workOrder}\n` +
        `<b>Requested Amount:</b> ₹${requestedAmount}\n` +
        `<b>Approved Amount:</b> ₹${approvedAmount}\n` +
        `<b>Action By:</b> ${escapeHtml(actorName)} (${actorRole})\n` +
        `<b>Remarks:</b> ${remarks}`;
    } else if (action === 'Hold') {
      messageText =
        `⚠️ <b>Payment Requisition Placed on Hold by ${actorRole}</b>\n\n` +
        `<b>Requisition No:</b> ${reqNo}\n` +
        `<b>Work Order:</b> ${workOrder}\n` +
        `<b>Requested Amount:</b> ₹${requestedAmount}\n` +
        `<b>Action By:</b> ${escapeHtml(actorName)} (${actorRole})\n` +
        `<b>Remarks:</b> ${remarks}`;
    } else {
      messageText =
        `🔔 <b>Payment Requisition Status Updated by ${actorRole}</b>\n\n` +
        `<b>Requisition No:</b> ${reqNo}\n` +
        `<b>Work Order:</b> ${workOrder}\n` +
        `<b>New Status:</b> ${action}\n` +
        `<b>Action By:</b> ${escapeHtml(actorName)} (${actorRole})\n` +
        `<b>Remarks:</b> ${remarks}`;
    }

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send requisition action notification to ${recipient.display_name}: ${data.description}`);
        }
      } catch (err) {
        console.warn(`[TELEGRAM ALERTS] Failed to send requisition action notification to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyZoAndHoRequisitionActed failed: ${error.message}`);
  }
}


async function notifyZoAndHoBackdatedProgressSubmitted(progressReport) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: zoUsers, error: zoErr } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'zo')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    const { data: hoUsers, error: hoErr } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (zoErr || hoErr) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve recipients for backdated progress:`, zoErr || hoErr);
      return;
    }

    const combined = [...(zoUsers || []), ...(hoUsers || [])];
    const seen = new Set();
    const recipients = [];
    for (const r of combined) {
      if (r.telegram_chat_id && r.telegram_chat_id.trim() !== '' && !seen.has(r.telegram_chat_id)) {
        seen.add(r.telegram_chat_id);
        recipients.push(r);
      }
    }

    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active ZO or HO users configured with Telegram chat IDs for backdated progress submission.`
      );
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set.`);
      return;
    }

    const { data: jeUser } = await supabase
      .from('authorised_users')
      .select('display_name')
      .eq('mobile_number', progressReport.created_by)
      .maybeSingle();
    const jeName = jeUser?.display_name || progressReport.created_by || 'N/A';

    const workOrder = escapeHtml(progressReport.work_order_no || 'N/A');
    const visitDate = escapeHtml(progressReport.site_visit_date || 'N/A');
    const progress = progressReport.physical_work_progress;
    const explanation = escapeHtml(progressReport.remarks_after_site_visit || 'None');
    const details = escapeHtml(progressReport.work_progress_details || 'N/A');

    const messageText =
      `⚠️ <b>Back-Dated Daily Progress Submitted</b>\n\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Visit Date:</b> ${visitDate} (Back-Dated)\n` +
      `<b>Physical Progress:</b> ${progress}%\n` +
      `<b>Submitted By:</b> ${escapeHtml(jeName)}\n` +
      `<b>Progress Details:</b> ${details}\n` +
      `<b>Reason / Remarks:</b> ${explanation}\n\n` +
      `This report requires approval or rejection by a ZO or HO user on the dashboard.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
          console.warn(`[TELEGRAM ALERTS] Failed to send backdated progress notification to ${recipient.display_name}: ${data.description}`);
        }
      } catch (err) {
        console.warn(`[TELEGRAM ALERTS] Failed to send backdated progress notification to ${recipient.display_name}: ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyZoAndHoBackdatedProgressSubmitted failed: ${error.message}`);
  }
}

async function notifyJeProgressActed(originalReport, updatedReport) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: jeUser, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('mobile_number', updatedReport.created_by)
      .maybeSingle();

    if (error || !jeUser) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve JE details for progress notification:`, error);
      return;
    }

    if (!jeUser.telegram_chat_id || jeUser.telegram_chat_id.trim() === '') {
      console.warn(`[TELEGRAM ALERTS] JE user ${updatedReport.created_by} has no Telegram chat ID configured.`);
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn(`[TELEGRAM ALERTS] TELEGRAM_BOT_TOKEN is not set.`);
      return;
    }

    const { data: approver } = await supabase
      .from('authorised_users')
      .select('display_name')
      .eq('mobile_number', updatedReport.approved_user_id)
      .maybeSingle();
    const approverName = approver?.display_name || updatedReport.approved_user_id || 'N/A';

    const workOrder = escapeHtml(updatedReport.work_order_no || 'N/A');
    const visitDate = escapeHtml(updatedReport.site_visit_date || 'N/A');
    const remarks = escapeHtml(updatedReport.remarks_approved_authority || 'None');
    const status = updatedReport.approval_status;
    const statusFormatted = status === 'Approved' ? '✅ <b>Approved</b>' : '❌ <b>Rejected (Back-Dated)</b>';

    const messageText =
      `📢 <b>Daily Progress Review Action</b>\n\n` +
      `Your back-dated daily progress entry has been reviewed.\n\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Visit Date:</b> ${visitDate}\n` +
      `<b>Review Status:</b> ${statusFormatted}\n` +
      `<b>Reviewed By:</b> ${escapeHtml(approverName)}\n` +
      `<b>Authority Remarks:</b> ${remarks}\n\n` +
      `Please check the details on your IDBP dashboard.`;

    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(jeUser.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.ok) {
      console.warn(`[TELEGRAM ALERTS] Failed to send progress action notification to JE: ${data.description}`);
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyJeProgressActed failed: ${error.message}`);
  }
}

async function notifyAllEstimateFinalApproved(estimate) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: allUsers, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve active users: ${error.message}`);
      return;
    }

    const recipients = (allUsers || []).filter(u => u.telegram_chat_id && u.telegram_chat_id.trim() !== '');

    if (recipients.length === 0) {
      console.warn(
        `[TELEGRAM ALERTS] No active users configured with Telegram chat IDs for final estimate approval notification. ` +
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

    const estimateNo = escapeHtml(estimate.estimate_no || 'N/A');
    const amount = Number(estimate.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const workOrder = escapeHtml(estimate.work_order_no || 'N/A');
    const siteDetails = escapeHtml(estimate.projects_master?.site_details || 'N/A');
    const hoName = await getDisplayName(estimate.ho_approved_by);
    const hoApprovedBy = escapeHtml(hoName);

    const messageText = 
      `<b>Cost Estimate Approved by HO</b>\n\n` +
      `<b>Estimate No:</b> ${estimateNo}\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Details:</b> ${siteDetails}\n` +
      `<b>Final Approved Amount:</b> ₹${amount}\n` +
      `<b>Approved By HO:</b> ${hoApprovedBy}\n\n` +
      `The cost estimate has been approved by Head Office.`;

    for (const recipient of recipients) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(recipient.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
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
    console.error(`[TELEGRAM ALERTS] notifyAllEstimateFinalApproved failed: ${error.message}`);
  }
}

async function notifyJeEstimateZoApproved(estimate) {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    const { data: jeUser, error } = await supabase
      .from('authorised_users')
      .select('display_name, telegram_chat_id')
      .eq('mobile_number', estimate.created_by)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.warn(`[TELEGRAM ALERTS] Failed to retrieve JE user: ${error.message}`);
      return;
    }

    if (!jeUser || !jeUser.telegram_chat_id || jeUser.telegram_chat_id.trim() === '') {
      return;
    }

    if (!TELEGRAM_BOT_TOKEN) {
      return;
    }

    const estimateNo = escapeHtml(estimate.estimate_no || 'N/A');
    const amount = Number(estimate.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const workOrder = escapeHtml(estimate.work_order_no || 'N/A');
    const siteDetails = escapeHtml(estimate.projects_master?.site_details || 'N/A');
    const zoName = await getDisplayName(estimate.zo_approved_by);
    const zoApprovedBy = escapeHtml(zoName);

    const messageText = 
      `<b>Cost Estimate Approved by ZO</b>\n\n` +
      `<b>Estimate No:</b> ${estimateNo}\n` +
      `<b>Work Order:</b> ${workOrder}\n` +
      `<b>Site Details:</b> ${siteDetails}\n` +
      `<b>Approved Zonal Amount:</b> ₹${amount}\n` +
      `<b>Approved By ZO:</b> ${zoApprovedBy}\n\n` +
      `Your cost estimate has been approved by the Zonal Office and forwarded to Head Office.`;

    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(jeUser.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
    const response = await fetch(url);
    const data = await response.json();
    if (!data.ok) {
      console.warn(`[TELEGRAM ALERTS] Failed to send message to JE ${jeUser.display_name} (${jeUser.telegram_chat_id}): ${data.description}`);
    }
  } catch (error) {
    console.error(`[TELEGRAM ALERTS] notifyJeEstimateZoApproved failed: ${error.message}`);
  }
}

module.exports = {
  sendOtp,
  startPolling,
  processWebhookUpdate,
  registerWebhook,
  notifyZoEstimateSubmitted,
  notifyHoEstimateApproved,
  notifyJeEstimateZoApproved,
  notifyZoFundRequestApproved,
  notifyJeRevisionRequested,
  notifyHoFundRequestSubmitted,
  notifyZoFundRequestHeld,
  notifyZoRequisitionSubmitted,
  notifyHoRequisitionSubmitted,
  notifyJeRequisitionActed,
  notifyZoAndHoRequisitionActed,
  notifyZoAndHoBackdatedProgressSubmitted,
  notifyJeProgressActed,
  notifyAllEstimateFinalApproved
};


