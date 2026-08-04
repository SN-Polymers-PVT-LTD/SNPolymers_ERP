/** Shared golden datasets for dashboard unit tests */

export const zoProjectsFixture = [
  {
    work_order_no: 'WO1',
    zo_user_id: '919000000002',
    physical_progress: 80,
    assigned_jes: [
      { mobile_number: '919000000003', name: 'JE-1' },
      { mobile_number: '919000000004', name: 'JE-2' }
    ]
  },
  {
    work_order_no: 'WO2',
    zo_user_id: '919000000002',
    physical_progress: 60,
    assigned_jes: [
      { mobile_number: '919000000003', name: 'JE-1' },
      { mobile_number: '919000000004', name: 'JE-2' }
    ]
  }
];

export const hoOverviewFixture = { totalProjects: 10, running: 0, closed: 5, maintenance: 2 };

export const hoRequisitionsFixture = [
  { requisition_status: 'Pending', requisition_amount: 50000 },
  { requisition_status: 'Approved', approved_amount: 100000, payment_date: new Date().toISOString() },
  { requisition_status: 'Approved', approved_amount: 200000, payment_date: '2020-01-01' }
];

export const jeDprFixture = [
  { work_order_no: 'WO1', site_visit_date: '2026-08-03', physical_work_progress: 40, created_at: '2026-08-03T10:00:00Z' },
  { work_order_no: 'WO1', site_visit_date: '2026-08-02', physical_work_progress: 30, created_at: '2026-08-02T10:00:00Z' },
  { work_order_no: 'WO1', site_visit_date: '2026-08-01', physical_work_progress: 20, created_at: '2026-08-01T10:00:00Z' },
  { work_order_no: 'WO1', site_visit_date: '2026-07-28', physical_work_progress: 10, created_at: '2026-07-28T10:00:00Z' }
];
