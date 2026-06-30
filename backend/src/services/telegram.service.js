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
 * For every incoming message, auto-replies with the sender's Chat ID
 * so the user can enter it on the IDBP login screen.
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

  if (process.env.DISABLE_TELEGRAM_POLLING === 'true') {
    console.log('[BOT] Telegram long polling is disabled via DISABLE_TELEGRAM_POLLING env variable.');
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

          const message = update.message;
          if (!message) continue;

          const chatId = message.chat?.id;
          const firstName = message.from?.first_name || 'there';

          if (!chatId) continue;

          const replyText =
            `👋 Hi ${firstName}!\n\n` +
            `Your SN Polymers Chat ID is:\n\n` +
            `🔢 \`${chatId}\`\n\n` +
            `*(Tap/Click the number above to copy it automatically)*\n\n` +
            `Enter this number on the IDBP login screen to link your Telegram account and receive your login code.`;

          await sendBotMessage(chatId, replyText);
          console.log(`[BOT] Replied with Chat ID ${chatId} to ${firstName} (${message.from?.username || 'no username'})`);
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
  notifyZoEstimateSubmitted,
  notifyHoEstimateApproved,
  notifyZoFundRequestApproved
};


