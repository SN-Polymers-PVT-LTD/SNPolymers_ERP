import { describe, it, expect } from 'vitest';
import { buildJeStats, computeWorkloadShare, filterProjectsByZoId } from './zoDashboard';

describe('buildJeStats utility tests', () => {
  it('should correctly handle multi-JE assignments (Case 1)', () => {
    const projects = [
      {
        work_order_no: 'WO1',
        physical_progress: 50,
        assigned_jes: [
          { mobile_number: '919000000001', name: 'JE1' },
          { mobile_number: '919000000002', name: 'JE2' }
        ]
      },
      {
        work_order_no: 'WO2',
        physical_progress: 30,
        assigned_jes: [
          { mobile_number: '919000000001', name: 'JE1' }
        ]
      }
    ];

    const stats = buildJeStats(projects, []);

    const je1 = stats.find(s => s.mobile_number === '919000000001');
    const je2 = stats.find(s => s.mobile_number === '919000000002');

    expect(je1).toBeDefined();
    expect(je1.count).toBe(2);
    expect(je1.avg).toBe(40); // (50 + 30) / 2 = 40

    expect(je2).toBeDefined();
    expect(je2.count).toBe(1);
    expect(je2.avg).toBe(50); // 50 / 1 = 50
  });

  it('should prevent duplicate assignment row counts for same JE on same WO (Case 2)', () => {
    const projects = [
      {
        work_order_no: 'WO1',
        physical_progress: 60,
        assigned_jes: [
          { mobile_number: '919000000001', name: 'JE1' },
          { mobile_number: '919000000001', name: 'JE1' } // Duplicate
        ]
      }
    ];

    const stats = buildJeStats(projects, []);

    const je1 = stats.find(s => s.mobile_number === '919000000001');
    expect(je1).toBeDefined();
    expect(je1.count).toBe(1);
    expect(je1.avg).toBe(60);
  });

  it('should fall back to legacy je_user_id field when assigned_jes is absent', () => {
    const projects = [
      {
        work_order_no: 'WO1',
        physical_progress: 40,
        je_user_id: '919000000001',
        je_name: 'JE1'
      },
      {
        work_order_no: 'WO2',
        physical_progress: 60,
        je_user_id: '919000000001',
        je_name: 'JE1'
      }
    ];

    const stats = buildJeStats(projects, []);
    const je1 = stats.find(s => s.mobile_number === '919000000001');

    expect(je1).toBeDefined();
    expect(je1.count).toBe(2);
    expect(je1.avg).toBe(50);
  });

  it('should fall back to comma-separated je_name when assigned_jes is absent', () => {
    const projects = [
      {
        work_order_no: 'WO1',
        physical_progress: 50,
        je_name: 'JE1, JE2'
      }
    ];

    const stats = buildJeStats(projects, []);
    const je1 = stats.find(s => s.name === 'JE1');
    const je2 = stats.find(s => s.name === 'JE2');

    expect(je1).toBeDefined();
    expect(je1.count).toBe(1);
    expect(je2).toBeDefined();
    expect(je2.count).toBe(1);
  });

  it('should successfully left join leaderboard metrics (Case 3)', () => {
    const projects = [
      {
        work_order_no: 'WO1',
        physical_progress: 20,
        assigned_jes: [
          { mobile_number: '919000000001', name: 'JE1' }
        ]
      },
      {
        work_order_no: 'WO2',
        physical_progress: 30,
        assigned_jes: [
          { mobile_number: '919000000002', name: 'JE2' }
        ]
      }
    ];

    const leaderboardData = [
      {
        mobile_number: '919000000001',
        display_name: 'JE1',
        daily_streak: 5,
        total_reports: 12,
        avg_progress: 75,
        score: 450
      }
    ];

    const stats = buildJeStats(projects, leaderboardData);

    const je1 = stats.find(s => s.mobile_number === '919000000001');
    const je2 = stats.find(s => s.mobile_number === '919000000002');

    // JE1 gets leaderboard streak/score but portfolio avg/status (20% → Warning)
    expect(je1).toBeDefined();
    expect(je1.count).toBe(1);
    expect(je1.streak).toBe(5);
    expect(je1.avg).toBe(20);
    expect(je1.status).toBe('Warning');
    expect(je1.score).toBe(450);

    // JE2 has 0 reports, fallback physical_progress used
    expect(je2).toBeDefined();
    expect(je2.count).toBe(1);
    expect(je2.streak).toBe(0);
    expect(je2.avg).toBe(30);
    expect(je2.status).toBe('Warning');
    expect(je2.score).toBe(0);
  });

  it('should use portfolio avg/status over weekly leaderboard when JE has assignments', () => {
    const projects = [
      {
        work_order_no: 'WO1',
        physical_progress: 80,
        assigned_jes: [{ mobile_number: '919000000001', name: 'JE1' }]
      }
    ];

    const leaderboardData = [
      {
        mobile_number: '919000000001',
        display_name: 'JE1',
        daily_streak: 2,
        total_reports: 0,
        avg_progress: 0,
        score: 20
      }
    ];

    const stats = buildJeStats(projects, leaderboardData);
    const je1 = stats.find(s => s.mobile_number === '919000000001');

    expect(je1.avg).toBe(80);
    expect(je1.status).toBe('Excellent');
    expect(je1.streak).toBe(2);
  });

  it('computeWorkloadShare splits shared assignments evenly', () => {
    expect(computeWorkloadShare(4, 8)).toBe(50);
    expect(computeWorkloadShare(4, 4)).toBe(100);
    expect(computeWorkloadShare(0, 0)).toBe(0);
  });

  it('filterProjectsByZoId matches zo_user_id only', () => {
    const projects = [
      { work_order_no: 'WO1', zo_user_id: '919000000002' },
      { work_order_no: 'WO2', zo_user_id: '919000000005' }
    ];
    const filtered = filterProjectsByZoId(projects, '919000000002');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].work_order_no).toBe('WO1');
  });
});
