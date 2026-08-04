import { describe, it, expect } from 'vitest';
import {
  buildJeMappedProjects,
  resolveJeStreakCount,
  resolveActiveZoMapping,
  countEstimateBuckets,
  DEFAULT_ESTIMATE_STATUS
} from './jeDashboard';
import { jeDprFixture } from '../test/fixtures/dashboardFixtures';

describe('jeDashboard utils', () => {
  const projects = [{ work_order_no: 'WO1', site_details: 'Kolkata Site', physical_progress: 5 }];
  const estimates = [{ work_order_no: 'WO1', estimate_status: 'Under ZO Review' }];
  const requisitions = [{ work_order_no: 'WO1' }, { work_order_no: 'WO1' }];

  it('buildJeMappedProjects uses latest DPR by visit date for progress', () => {
    const rows = buildJeMappedProjects(projects, estimates, requisitions, jeDprFixture);
    expect(rows[0].progress).toBe(40);
    expect(rows[0].estimates).toBe('Under ZO Review');
    expect(rows[0].requisitions).toBe(2);
    expect(rows[0].lastLogged).toContain('logged');
  });

  it('defaults estimate status when no matching estimate exists', () => {
    const rows = buildJeMappedProjects(projects, [], [], []);
    expect(rows[0].estimates).toBe(DEFAULT_ESTIMATE_STATUS);
    expect(rows[0].progress).toBe(5);
  });

  it('resolveJeStreakCount prefers user.daily_streak from DB', () => {
    expect(resolveJeStreakCount({ daily_streak: 7 }, jeDprFixture)).toBe(7);
  });

  it('resolveJeStreakCount falls back to consecutive visit dates', () => {
    expect(resolveJeStreakCount({}, jeDprFixture)).toBe(3);
  });

  it('resolveActiveZoMapping matches JE mobile from mappings list', () => {
    const mappings = {
      mappings: [
        { je_user_id: '919000000003', zo_name: 'ZO Kolkata', zo_user_id: '919000000002', is_active: true }
      ]
    };
    const user = { mobile_number: '919000000003' };
    const mapping = resolveActiveZoMapping(mappings, user, []);
    expect(mapping.zo_name).toBe('ZO Kolkata');
  });

  it('resolveActiveZoMapping falls back to project ZO metadata', () => {
    const mapping = resolveActiveZoMapping(null, {}, [
      { zo_name: 'Zone A', zo_user_id: '919000000002' }
    ]);
    expect(mapping.zo_name).toBe('Zone A');
  });

  it('countEstimateBuckets splits approved vs pending', () => {
    const buckets = countEstimateBuckets([
      { estimate_status: 'Final Approved' },
      { estimate_status: 'Under ZO Review' }
    ]);
    expect(buckets.approvedEstsCount).toBe(1);
    expect(buckets.pendingEstsCount).toBe(1);
  });
});
