import { describe, test, expect } from 'vitest';
const {
  buildLastPhotoVisitMap,
  getDaysSinceVisit,
  isWorkOrderInactive,
  groupInactiveWorkOrders,
  INACTIVITY_DAYS
} = require('../../../src/services/siteVisitInactivity.service');

describe('Site Visit Inactivity helpers', () => {
  test('buildLastPhotoVisitMap ignores reports without a photo URL', () => {
    const map = buildLastPhotoVisitMap([
      { work_order_no: 'WO1', site_visit_date: '2026-08-07', daily_site_photo_url: 'https://example.com/a.jpg' },
      { work_order_no: 'WO1', site_visit_date: '2026-08-08', daily_site_photo_url: '' },
      { work_order_no: 'WO2', site_visit_date: '2026-08-08', daily_site_photo_url: '   ' },
      { work_order_no: 'WO3', site_visit_date: '2026-08-06', daily_site_photo_url: 'https://example.com/b.jpg' }
    ]);

    expect(map).toEqual({
      WO1: '2026-08-07',
      WO3: '2026-08-06'
    });
  });

  test('getDaysSinceVisit returns Infinity when no prior visit exists', () => {
    expect(getDaysSinceVisit(null, '2026-08-08')).toBe(Infinity);
  });

  test('isWorkOrderInactive flags visits at or beyond the threshold', () => {
    expect(isWorkOrderInactive('2026-08-05', '2026-08-08', INACTIVITY_DAYS)).toBe(true);
    expect(isWorkOrderInactive('2026-08-06', '2026-08-08', INACTIVITY_DAYS)).toBe(false);
    expect(isWorkOrderInactive(null, '2026-08-08', INACTIVITY_DAYS)).toBe(true);
  });

  test('groupInactiveWorkOrders deduplicates multiple JEs on the same work order', () => {
    const mappings = [
      { work_order_no: 'WO1', je_user_id: '111' },
      { work_order_no: 'WO1', je_user_id: '222' },
      { work_order_no: 'WO2', je_user_id: '333' }
    ];
    const lastVisitMap = {
      WO1: '2026-08-01',
      WO2: '2026-08-07'
    };

    const grouped = groupInactiveWorkOrders(mappings, lastVisitMap, '2026-08-08');

    expect(grouped).toHaveLength(1);
    expect(grouped[0].work_order_no).toBe('WO1');
    expect(grouped[0].je_user_ids.sort()).toEqual(['111', '222']);
    expect(grouped[0].earliest_assigned_at).toBeNull();
  });

  test('groupInactiveWorkOrders extracts the earliest assigned_at date correctly', () => {
    const mappings = [
      { work_order_no: 'WO1', je_user_id: '111', assigned_at: '2026-08-03T10:00:00Z' },
      { work_order_no: 'WO1', je_user_id: '222', assigned_at: '2026-08-02T12:00:00Z' },
      { work_order_no: 'WO2', je_user_id: '333', assigned_at: '2026-08-05T09:00:00Z' }
    ];
    const lastVisitMap = {
      WO1: '2026-08-01',
      WO2: '2026-08-07'
    };

    const grouped = groupInactiveWorkOrders(mappings, lastVisitMap, '2026-08-08');

    expect(grouped).toHaveLength(1);
    expect(grouped[0].work_order_no).toBe('WO1');
    expect(grouped[0].je_user_ids.sort()).toEqual(['111', '222']);
    expect(grouped[0].earliest_assigned_at).toBeInstanceOf(Date);
    // The earliest date should be 2026-08-02
    expect(grouped[0].earliest_assigned_at.toISOString()).toBe('2026-08-02T12:00:00.000Z');
  });
});
