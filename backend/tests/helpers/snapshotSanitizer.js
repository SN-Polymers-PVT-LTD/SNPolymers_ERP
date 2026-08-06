const VOLATILE_ROOT_KEYS = new Set(['timestamp', 'built', 'git']);

function stripIdsAndDates(value) {
  if (Array.isArray(value)) {
    return value.map(stripIdsAndDates);
  }
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id' || key.endsWith('_id') || key.endsWith('_at') || key.endsWith('_date')) {
        next[key] = typeof child === 'string' ? 'REDACTED' : child;
      } else {
        next[key] = stripIdsAndDates(child);
      }
    }
    return next;
  }
  return value;
}

function sanitizeForSnapshot(body) {
  const clone = structuredClone(body);

  for (const key of VOLATILE_ROOT_KEYS) {
    if (key in clone) {
      delete clone[key];
    }
  }

  if (clone.user) {
    clone.user = stripIdsAndDates(clone.user);
    if (clone.user.id) clone.user.id = 'UUID';
    if (clone.user.mobile_number) clone.user.mobile_number = 'MOBILE';
  }

  if (Array.isArray(clone.data)) {
    clone.data = clone.data.map((row) => {
      const sanitized = stripIdsAndDates(row);
      if (sanitized.work_order_no && sanitized.work_order_no.startsWith('WO-')) {
        sanitized.work_order_no = 'WO-REDACTED';
      }
      return sanitized;
    });
  }

  return clone;
}

module.exports = { sanitizeForSnapshot, stripIdsAndDates };
