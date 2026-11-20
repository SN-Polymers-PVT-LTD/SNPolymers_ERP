import { describe, it, expect, vi, beforeEach } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const { visibleWorkOrders } = require('../../../src/helpers/workOrderAccess');

describe('visibleWorkOrders helper', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for admin and ho (unrestricted company-wide access)', async () => {
    const fromSpy = vi.spyOn(supabase, 'from');

    const adminResult = await visibleWorkOrders({ role: 'admin', mobile_number: '1234567890' });
    const hoResult = await visibleWorkOrders({ role: 'ho', mobile_number: '1234567891' });

    expect(adminResult).toBeNull();
    expect(hoResult).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns empty array when user is null, undefined, or has an unsupported role', async () => {
    expect(await visibleWorkOrders(null)).toEqual([]);
    expect(await visibleWorkOrders(undefined)).toEqual([]);
    expect(await visibleWorkOrders({ role: 'accounts', mobile_number: '1234567892' })).toEqual([]);
  });

  it('resolves active mapped work orders for JE', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      expect(table).toBe('work_order_mappings');
      const builder = {
        select: (fields) => {
          expect(fields).toBe('work_order_no');
          return builder;
        },
        eq: (field, val) => {
          return builder;
        },
        then: (resolve) => resolve({
          data: [{ work_order_no: 'WO-101' }, { work_order_no: 'WO-102' }],
          error: null
        })
      };
      return builder;
    });

    const result = await visibleWorkOrders({ role: 'je', mobile_number: '9876543210' });
    expect(result).toEqual(['WO-101', 'WO-102']);
  });

  it('resolves deduplicated work orders across supervised JEs for ZO', async () => {
    vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'je_zo_mappings') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          then: (resolve) => resolve({
            data: [{ je_user_id: 'JE-1' }, { je_user_id: 'JE-2' }],
            error: null
          })
        };
        return builder;
      }
      if (table === 'work_order_mappings') {
        const builder = {
          select: () => builder,
          in: () => builder,
          eq: () => builder,
          then: (resolve) => resolve({
            data: [
              { work_order_no: 'WO-101' },
              { work_order_no: 'WO-102' },
              { work_order_no: 'WO-101' } // Duplicate from multiple JEs on same WO
            ],
            error: null
          })
        };
        return builder;
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await visibleWorkOrders({ role: 'zo', mobile_number: '9998887770' });
    expect(result).toEqual(['WO-101', 'WO-102']);
  });

  it('returns empty array if ZO has no mapped JEs without querying work_order_mappings', async () => {
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table) => {
      expect(table).toBe('je_zo_mappings');
      const builder = {
        select: () => builder,
        eq: () => builder,
        then: (resolve) => resolve({ data: [], error: null })
      };
      return builder;
    });

    const result = await visibleWorkOrders({ role: 'zo', mobile_number: '9998887770' });
    expect(result).toEqual([]);
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates database query errors', async () => {
    vi.spyOn(supabase, 'from').mockImplementation(() => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        then: (resolve) => resolve({ data: null, error: new Error('DB connection failed') })
      };
      return builder;
    });

    await expect(visibleWorkOrders({ role: 'je', mobile_number: '9876543210' })).rejects.toThrow('DB connection failed');
  });
});
