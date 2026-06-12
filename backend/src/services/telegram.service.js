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
  const messageText = `Your SN Polymers IDBP login code is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;

  // Always log OTP to terminal for backend visibility/debugging
  console.log('\n======================================');
  console.log(`[OTP DEBUG] Telegram Chat ID: ${telegramChatId || 'N/A (console fallback)'}`);
  console.log(`[OTP CODE]: ${otp}`);
  console.log('======================================\n');

  if (!telegramChatId) {
    console.log('[OTP SERVICE] No telegram_chat_id set — running in console-only fallback mode.');
    return { success: true, mode: 'console' };
  }

  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[OTP SERVICE] TELEGRAM_BOT_TOKEN is not set — cannot send via Telegram. Falling back to console.');
    return { success: true, mode: 'console' };
  }

  try {
    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(telegramChatId)}&text=${encodeURIComponent(messageText)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
    }

    return { success: true, mode: 'telegram', messageId: data.result?.message_id };
  } catch (error) {
    console.error(`[OTP SERVICE] Telegram sendMessage failed: ${error.message}`);
    throw new Error(`Telegram delivery failed: ${error.message}`);
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
    const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(text)}`;
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

  console.log('[BOT] Telegram long polling started. Waiting for messages from @snpolymers_bot...');

  let offset = 0;

  // Infinite polling loop — runs for the lifetime of the server process
  const poll = async () => {
    try {
      const url = `${TELEGRAM_API_BASE}/getUpdates?timeout=30&offset=${offset}&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.ok) {
        console.warn(`[BOT] getUpdates error: ${data.description || 'Unknown error'}`);
      } else {
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
            `🔢 ${chatId}\n\n` +
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

module.exports = {
  sendOtp,
  startPolling
};
