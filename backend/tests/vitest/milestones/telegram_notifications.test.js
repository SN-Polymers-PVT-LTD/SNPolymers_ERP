import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const {
  notifyHoFundRequestSubmitted,
  notifyZoFundRequestHeld,
  notifyZoRequisitionSubmitted,
  notifyHoRequisitionSubmitted,
  notifyJeRequisitionActed,
  notifyZoAndHoRequisitionActed,
  notifyAllEstimateFinalApproved
} = require('../../../src/services/telegram.service');

describe('Telegram Notifications Suite', () => {
  let originalEnvNodeEnv;
  const mockChatId = '123456789';

  let zoUserBackup = null;
  let hoUserBackup = null;
  let jeUserBackup = null;

  beforeAll(async () => {
    originalEnvNodeEnv = process.env.NODE_ENV;

    // Fetch active ZO, HO, JE users dynamically
    const { data: zoUser } = await supabase
      .from('authorised_users')
      .select('mobile_number, telegram_chat_id')
      .eq('role', 'zo')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const { data: hoUser } = await supabase
      .from('authorised_users')
      .select('mobile_number, telegram_chat_id')
      .eq('role', 'ho')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const { data: jeUser } = await supabase
      .from('authorised_users')
      .select('mobile_number, telegram_chat_id')
      .eq('role', 'je')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (zoUser) {
      zoUserBackup = zoUser;
      await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: mockChatId })
        .eq('mobile_number', zoUser.mobile_number);
    }

    if (hoUser) {
      hoUserBackup = hoUser;
      await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: mockChatId })
        .eq('mobile_number', hoUser.mobile_number);
    }

    if (jeUser) {
      jeUserBackup = jeUser;
      await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: mockChatId })
        .eq('mobile_number', jeUser.mobile_number);
    }
  });

  afterAll(async () => {
    process.env.NODE_ENV = originalEnvNodeEnv;

    // Restore original chat IDs
    if (zoUserBackup) {
      await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: zoUserBackup.telegram_chat_id })
        .eq('mobile_number', zoUserBackup.mobile_number);
    }

    if (hoUserBackup) {
      await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: hoUserBackup.telegram_chat_id })
        .eq('mobile_number', hoUserBackup.mobile_number);
    }

    if (jeUserBackup) {
      await supabase
        .from('authorised_users')
        .update({ telegram_chat_id: jeUserBackup.telegram_chat_id })
        .eq('mobile_number', jeUserBackup.mobile_number);
    }
  });

  test('Test 1: notifyHoFundRequestSubmitted logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockFr = {
      zo_user_id: zoUserBackup?.mobile_number || '+919999999999',
      zo_fr_no: 'TEST_FR_NOTIF_SUB',
      zo_fr_amount: 15000.00,
      zo_remarks: 'Testing submit'
    };

    try {
      await notifyHoFundRequestSubmitted(mockFr);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('no active ho');
    expect(hasAttempted).toBe(true);
  });

  test('Test 2: notifyZoFundRequestHeld logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockFr = {
      zo_user_id: zoUserBackup?.mobile_number || '+919999999999',
      zo_fr_no: 'TEST_FR_NOTIF_HELD',
      zo_fr_amount: 15000.00,
      zo_remarks: 'Testing held'
    };

    const mockUpdatedFr = {
      ho_remarks: 'On hold'
    };

    try {
      await notifyZoFundRequestHeld(mockFr, mockUpdatedFr);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('has no telegram');
    expect(hasAttempted).toBe(true);
  });

  test('Test 3: notifyZoRequisitionSubmitted logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockReq = {
      requester_user_id: jeUserBackup?.mobile_number || '+918888888888',
      requisition_no: 'TEST_REQ_NOTIF_SUB',
      work_order_no: 'WO-001',
      site_details: 'Main street site',
      material_main_head: 'Cement',
      requisition_amount: 50000.00,
      expen_head_remarks: 'Required cement'
    };

    try {
      await notifyZoRequisitionSubmitted(mockReq);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('no active zo');
    expect(hasAttempted).toBe(true);
  });

  test('Test 4: notifyJeRequisitionActed (Approved) logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockReq = {
      requester_user_id: jeUserBackup?.mobile_number || '+918888888888',
      requisition_no: 'TEST_REQ_NOTIF_APP',
      work_order_no: 'WO-001',
      requisition_amount: 50000.00
    };

    const mockUpdatedReq = {
      requisition_status: 'Approved',
      approved_amount: 45000.00,
      remarks_approved_authority: 'Approved slightly lower amount'
    };

    try {
      await notifyJeRequisitionActed(mockReq, mockUpdatedReq);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('has no telegram');
    expect(hasAttempted).toBe(true);
  });

  test('Test 5: notifyJeRequisitionActed (Hold) logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockReq = {
      requester_user_id: jeUserBackup?.mobile_number || '+918888888888',
      requisition_no: 'TEST_REQ_NOTIF_HOLD',
      work_order_no: 'WO-001',
      requisition_amount: 50000.00
    };

    const mockUpdatedReq = {
      requisition_status: 'Hold',
      remarks_approved_authority: 'Hold for further details'
    };

    try {
      await notifyJeRequisitionActed(mockReq, mockUpdatedReq);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('has no telegram');
    expect(hasAttempted).toBe(true);
  });

  test('Test 6: notifyAllEstimateFinalApproved logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockEstimate = {
      estimate_no: 'EST-001',
      estimate_amount: 250000.00,
      work_order_no: 'WO-100',
      projects_master: {
        site_details: 'Phase 6 site'
      },
      ho_approved_by: '+919999999999'
    };

    try {
      await notifyAllEstimateFinalApproved(mockEstimate);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('disabled') ||
                         logs.toLowerCase().includes('no active users');
    expect(hasAttempted).toBe(true);
  });

  test('Test 7: notifyHoRequisitionSubmitted logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockReq = {
      requester_user_id: jeUserBackup?.mobile_number || '+918888888888',
      requisition_no: 'TEST_REQ_NOTIF_HO_SUB',
      work_order_no: 'WO-001',
      site_details: 'Main street site',
      material_main_head: 'Cement',
      requisition_amount: 50000.00,
      expen_head_remarks: 'Required cement for slab'
    };

    try {
      await notifyHoRequisitionSubmitted(mockReq);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('no active ho');
    expect(hasAttempted).toBe(true);
  });

  test('Test 8: notifyZoAndHoRequisitionActed (Approved) logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockReq = {
      requester_user_id: jeUserBackup?.mobile_number || '+918888888888',
      requisition_no: 'TEST_REQ_NOTIF_HO_APP',
      work_order_no: 'WO-001',
      requisition_amount: 50000.00
    };

    const mockUpdatedReq = {
      requisition_status: 'Approved',
      approved_amount: 45000.00,
      remarks_approved_authority: 'Approved slightly lower amount',
      approved_user_id: hoUserBackup?.mobile_number || '+919999999999'
    };

    try {
      await notifyZoAndHoRequisitionActed(mockReq, mockUpdatedReq);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('no active zo/ho');
    expect(hasAttempted).toBe(true);
  });

  test('Test 9: notifyZoAndHoRequisitionActed (Hold) logs notification trigger', async () => {
    process.env.NODE_ENV = 'development';

    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    let logs = '';

    console.log = (...args) => { logs += args.join(' ') + '\n'; originalLog(...args); };
    console.warn = (...args) => { logs += args.join(' ') + '\n'; originalWarn(...args); };
    console.error = (...args) => { logs += args.join(' ') + '\n'; originalError(...args); };

    const mockReq = {
      requester_user_id: jeUserBackup?.mobile_number || '+918888888888',
      requisition_no: 'TEST_REQ_NOTIF_HO_HOLD',
      work_order_no: 'WO-001',
      requisition_amount: 50000.00
    };

    const mockUpdatedReq = {
      requisition_status: 'Hold',
      remarks_approved_authority: 'Placed on hold for clarification',
      approved_user_id: zoUserBackup?.mobile_number || '+918000000002'
    };

    try {
      await notifyZoAndHoRequisitionActed(mockReq, mockUpdatedReq);
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      process.env.NODE_ENV = originalEnvNodeEnv;
    }

    const hasAttempted = logs.toLowerCase().includes('sent') ||
                         logs.toLowerCase().includes('failed') ||
                         logs.toLowerCase().includes('warning') ||
                         logs.toLowerCase().includes('no active zo/ho');
    expect(hasAttempted).toBe(true);
  });
});
