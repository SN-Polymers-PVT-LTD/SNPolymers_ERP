'use strict';

const { supabase } = require('../db/supabase');

/**
 * Helper: Calculates milliseconds until the next occurrence of target hour & minute in local time.
 */
function msUntilTargetTime(targetHour = 13, targetMinute = 0) {
  const now = new Date();
  const target = new Date();
  target.setHours(targetHour, targetMinute, 0, 0);
  if (now.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/**
 * Runs the daily check for progress report submissions.
 * Finds JEs who have active work orders but haven't submitted a report today,
 * and sends them a Telegram notification to maintain their streak.
 */
async function checkAndSendStreakReminders() {
  console.log('[STREAK REMINDER] Starting daily progress check...');
  try {
    const todayISTStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    // 1. Fetch active JEs with Telegram chat IDs
    const { data: jes, error: jeError } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name, telegram_chat_id, daily_streak, last_report_date')
      .eq('role', 'je')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (jeError) throw jeError;
    if (!jes || jes.length === 0) {
      console.log('[STREAK REMINDER] No active JEs with linked Telegram accounts found.');
      return;
    }

    // 2. Fetch all active work order mappings
    const { data: mappings, error: mapError } = await supabase
      .from('work_order_mappings')
      .select('je_user_id')
      .eq('is_active', true);

    if (mapError) throw mapError;
    const activeJeMobiles = new Set((mappings || []).map(m => m.je_user_id));

    // Filter JEs to only those with active work order mappings
    const JEsToNotify = jes.filter(je => activeJeMobiles.has(je.mobile_number));
    if (JEsToNotify.length === 0) {
      console.log('[STREAK REMINDER] No active JEs are currently mapped to any work orders.');
      return;
    }

    // 3. Fetch progress reports submitted for today
    const { data: reports, error: reportsError } = await supabase
      .from('daily_progress_reports')
      .select('created_by')
      .eq('site_visit_date', todayISTStr);

    if (reportsError) throw reportsError;
    const submittedJeMobiles = new Set((reports || []).map(r => r.created_by));

    // 4. Send reminders to JEs who haven't submitted today
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn('[STREAK REMINDER] TELEGRAM_BOT_TOKEN is not configured. Reminders cannot be sent.');
      return;
    }

    for (const je of JEsToNotify) {
      if (!submittedJeMobiles.has(je.mobile_number)) {
        const streak = je.daily_streak || 0;
        let messageText = '';

        if (streak > 0) {
          messageText = `⚠️ <b>Daily Streak Alert!</b>\n\nHi <b>${je.display_name}</b>, you haven't submitted your daily progress report for today yet.\n\nLog your site visit report before midnight to maintain your current streak of <b>${streak} days</b>! 🔥`;
        } else {
          messageText = `⚠️ <b>Daily Streak Alert!</b>\n\nHi <b>${je.display_name}</b>, you haven't submitted your daily progress report for today yet.\n\nLog your site visit report today to start your daily streak! 🚀`;
        }

        try {
          const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(je.telegram_chat_id.trim())}&text=${encodeURIComponent(messageText)}&parse_mode=HTML`;
          const response = await fetch(url);
          const data = await response.json();
          if (!data.ok) {
            console.warn(`[STREAK REMINDER] Failed to send Telegram reminder to ${je.display_name}: ${data.description}`);
          } else {
            console.log(`[STREAK REMINDER] Streak reminder sent to ${je.display_name}`);
          }
        } catch (err) {
          console.error(`[STREAK REMINDER] Error sending reminder to ${je.display_name}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error('[STREAK REMINDER] Scheduled check failed:', err.message || err);
  }
}

/**
 * Initializes the daily 1:00 PM streak reminder scheduler.
 */
function startStreakReminderScheduler(targetHour = 13, targetMinute = 0) {
  console.log(`Streak reminder scheduler registered — 1:00 PM daily`);

  const runReminderTask = async () => {
    await checkAndSendStreakReminders();
    scheduleNext();
  };

  const scheduleNext = () => {
    const delay = msUntilTargetTime(targetHour, targetMinute);
    const hours = (delay / 3600000).toFixed(2);
    console.log(`[STREAK REMINDER] Next streak check scheduled in ${hours} hours.`);
    setTimeout(runReminderTask, delay);
  };

  scheduleNext();
}

module.exports = {
  checkAndSendStreakReminders,
  startStreakReminderScheduler
};
