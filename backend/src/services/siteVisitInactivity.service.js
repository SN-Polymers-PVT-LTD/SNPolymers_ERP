'use strict';

const { supabase } = require('../db/supabase');
const { escapeHtml } = require('./telegram.service');

const INACTIVITY_DAYS = 3;

/**
 * Helper: Calculates milliseconds until the next occurrence of target hour & minute in local time.
 * Mirrors the pattern used in streakNotification.service.js.
 */
function msUntilTargetTime(targetHour = 10, targetMinute = 0) {
  const now = new Date();
  const target = new Date();
  target.setHours(targetHour, targetMinute, 0, 0);
  if (now.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/**
 * Formats a date string (YYYY-MM-DD) to DD-Mon-YYYY for the Telegram message.
 */
function formatDateDMY(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  });
}

/**
 * Builds work_order_no → MAX(site_visit_date) using only reports that include a site photo.
 */
function buildLastPhotoVisitMap(reports) {
  const lastVisitMap = {};
  (reports || []).forEach((r) => {
    if (!r.daily_site_photo_url || !String(r.daily_site_photo_url).trim()) return;
    if (!lastVisitMap[r.work_order_no] || r.site_visit_date > lastVisitMap[r.work_order_no]) {
      lastVisitMap[r.work_order_no] = r.site_visit_date;
    }
  });
  return lastVisitMap;
}

/**
 * Returns whole-day difference between today (IST YYYY-MM-DD) and last visit date.
 * Returns Infinity when there is no prior photo visit.
 */
function getDaysSinceVisit(lastVisitStr, todayISTStr) {
  if (!lastVisitStr) return Infinity;
  const todayDate = new Date(todayISTStr + 'T00:00:00');
  const lastVisitDate = new Date(lastVisitStr + 'T00:00:00');
  const diffMs = todayDate - lastVisitDate;
  return diffMs / (1000 * 60 * 60 * 24);
}

function isWorkOrderInactive(lastVisitStr, todayISTStr, thresholdDays = INACTIVITY_DAYS) {
  return getDaysSinceVisit(lastVisitStr, todayISTStr) >= thresholdDays;
}

/**
 * Groups active mappings into one alert payload per work order.
 */
function groupInactiveWorkOrders(mappings, lastVisitMap, todayISTStr, thresholdDays = INACTIVITY_DAYS) {
  const grouped = new Map();

  (mappings || []).forEach((m) => {
    const lastVisit = lastVisitMap[m.work_order_no];
    if (!isWorkOrderInactive(lastVisit, todayISTStr, thresholdDays)) return;

    if (!grouped.has(m.work_order_no)) {
      grouped.set(m.work_order_no, {
        work_order_no: m.work_order_no,
        je_user_ids: new Set(),
        last_visit: lastVisit || null,
        assigned_ats: []
      });
    }
    grouped.get(m.work_order_no).je_user_ids.add(m.je_user_id);
    if (m.assigned_at) {
      grouped.get(m.work_order_no).assigned_ats.push(m.assigned_at);
    }
  });

  return Array.from(grouped.values()).map((g) => {
    let earliestAssignedAt = null;
    if (g.assigned_ats.length > 0) {
      const dates = g.assigned_ats.map((d) => new Date(d));
      earliestAssignedAt = new Date(Math.min(...dates));
    }
    return {
      work_order_no: g.work_order_no,
      je_user_ids: Array.from(g.je_user_ids),
      last_visit: g.last_visit,
      earliest_assigned_at: earliestAssignedAt
    };
  });
}

/**
 * Runs the daily site-visit inactivity check.
 */
async function checkSiteVisitInactivity() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  console.log('[SITE VISIT INACTIVITY] Starting daily inactivity check...');

  try {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

    if (!TELEGRAM_BOT_TOKEN) {
      console.warn('[SITE VISIT INACTIVITY] TELEGRAM_BOT_TOKEN not configured. Alerts cannot be sent.');
      return;
    }

    const todayISTStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

    const { data: mappings, error: mapErr } = await supabase
      .from('work_order_mappings')
      .select('work_order_no, je_user_id, assigned_at')
      .eq('is_active', true);

    if (mapErr) throw mapErr;
    if (!mappings || mappings.length === 0) {
      console.log('[SITE VISIT INACTIVITY] No active work order mappings found.');
      return;
    }

    const workOrderNos = [...new Set(mappings.map((m) => m.work_order_no))];

    // status = 'Active' is the only predicate — NO date window
    const { data: onBreakWOs, error: breakErr } = await supabase
      .from('work_order_activity_breaks')
      .select('work_order_no')
      .eq('status', 'Active');

    if (breakErr) throw breakErr;

    const onBreakSet = new Set((onBreakWOs || []).map((b) => b.work_order_no));
    const activeMappings = (mappings || []).filter((m) => !onBreakSet.has(m.work_order_no));

    const { data: reports, error: reportErr } = await supabase
      .from('daily_progress_reports')
      .select('work_order_no, site_visit_date, daily_site_photo_url')
      .in('work_order_no', workOrderNos)
      .order('site_visit_date', { ascending: false });

    if (reportErr) throw reportErr;

    const lastVisitMap = buildLastPhotoVisitMap(reports);
    const flaggedGroups = groupInactiveWorkOrders(activeMappings, lastVisitMap, todayISTStr);

    if (flaggedGroups.length === 0) {
      console.log('[SITE VISIT INACTIVITY] No inactivity cases found today.');
      return;
    }

    console.log(`[SITE VISIT INACTIVITY] Found ${flaggedGroups.length} flagged work order(s).`);

    const jeIds = [...new Set(activeMappings.map((m) => m.je_user_id))];

    const { data: jeUsers, error: jeErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name, telegram_chat_id')
      .in('mobile_number', jeIds);

    if (jeErr) throw jeErr;

    const jeMap = {};
    (jeUsers || []).forEach((u) => { jeMap[u.mobile_number] = u; });

    const { data: jeZoMappings, error: jeZoErr } = await supabase
      .from('je_zo_mappings')
      .select('je_user_id, zo_user_id')
      .in('je_user_id', jeIds)
      .eq('is_active', true);

    if (jeZoErr) throw jeZoErr;

    const jeToZoMap = {};
    (jeZoMappings || []).forEach((m) => { jeToZoMap[m.je_user_id] = m.zo_user_id; });

    const { data: projects, error: projErr } = await supabase
      .from('projects_master')
      .select('work_order_no, zo_user_id')
      .in('work_order_no', workOrderNos);

    if (projErr) throw projErr;

    const projectZoMap = {};
    (projects || []).forEach((p) => { projectZoMap[p.work_order_no] = p.zo_user_id; });

    const zoIds = new Set([
      ...Object.values(jeToZoMap),
      ...Object.values(projectZoMap)
    ].filter(Boolean));

    const { data: zoUsers, error: zoErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name, telegram_chat_id')
      .in('mobile_number', [...zoIds]);

    if (zoErr) throw zoErr;

    const zoMap = {};
    (zoUsers || []).forEach((u) => { zoMap[u.mobile_number] = u; });

    const { data: hoUsers, error: hoErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null);

    if (hoErr) throw hoErr;

    async function sendTelegramMessage(chatId, text) {
      try {
        const url = `${TELEGRAM_API_BASE}/sendMessage?chat_id=${encodeURIComponent(chatId.trim())}&text=${encodeURIComponent(text)}&parse_mode=HTML`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.ok) {
          console.warn(`[SITE VISIT INACTIVITY] Telegram send failed to ${chatId}: ${json.description}`);
        }
      } catch (err) {
        console.error(`[SITE VISIT INACTIVITY] Telegram send error to ${chatId}: ${err.message}`);
      }
    }

    for (const group of flaggedGroups) {
      const employeeNames = group.je_user_ids
        .map((id) => jeMap[id]?.display_name || id)
        .join(', ');
      const lastVisitFormatted = group.last_visit ? formatDateDMY(group.last_visit) : 'No record found';

      const earliestAssignedAtStr = group.earliest_assigned_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(group.earliest_assigned_at)
        : null;
      const daysCount = (group.last_visit || earliestAssignedAtStr)
        ? Math.round(getDaysSinceVisit(group.last_visit || earliestAssignedAtStr, todayISTStr))
        : INACTIVITY_DAYS;

      const messageText =
        `⚠️ <b>Site Visit Inactivity Alert</b>\n\n` +
        `Work Order: <b>${escapeHtml(group.work_order_no)}</b>\n` +
        `Employee: <b>${escapeHtml(employeeNames)}</b>\n` +
        `Last Site Visit: <b>${escapeHtml(lastVisitFormatted)}</b>\n\n` +
        `No site-visit photo has been uploaded for the last ${daysCount} days.\n` +
        `Please check and take necessary action.`;

      const recipientChatIds = new Set();

      for (const jeId of group.je_user_ids) {
        const zoId = jeToZoMap[jeId] || projectZoMap[group.work_order_no];
        if (zoId) {
          const zo = zoMap[zoId];
          if (zo?.telegram_chat_id) {
            recipientChatIds.add(zo.telegram_chat_id.trim());
          }
        }
      }

      (hoUsers || []).forEach((ho) => {
        if (ho.telegram_chat_id) {
          recipientChatIds.add(ho.telegram_chat_id.trim());
        }
      });

      console.log(`[SITE VISIT INACTIVITY] Alerting for WO ${group.work_order_no} (JE: ${employeeNames}) → ${recipientChatIds.size} recipient(s).`);

      for (const chatId of recipientChatIds) {
        await sendTelegramMessage(chatId, messageText);
      }
    }

    console.log('[SITE VISIT INACTIVITY] Daily inactivity check complete.');
  } catch (err) {
    console.error('[SITE VISIT INACTIVITY] Scheduled check failed:', err.message || err);
  }
}

function startSiteVisitInactivityScheduler(targetHour = 10, targetMinute = 0) {
  console.log('Site visit inactivity scheduler registered — 10:00 AM daily');

  const runInactivityTask = async () => {
    await checkSiteVisitInactivity();
    scheduleNext();
  };

  const scheduleNext = () => {
    const delay = msUntilTargetTime(targetHour, targetMinute);
    const hours = (delay / 3600000).toFixed(2);
    console.log(`[SITE VISIT INACTIVITY] Next inactivity check scheduled in ${hours} hours.`);
    setTimeout(runInactivityTask, delay);
  };

  scheduleNext();
}

module.exports = {
  checkSiteVisitInactivity,
  startSiteVisitInactivityScheduler,
  buildLastPhotoVisitMap,
  getDaysSinceVisit,
  isWorkOrderInactive,
  groupInactiveWorkOrders,
  INACTIVITY_DAYS
};
