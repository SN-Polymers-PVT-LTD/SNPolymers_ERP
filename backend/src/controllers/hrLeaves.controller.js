const { supabase } = require('../db/supabase');

function sendError(res, error) {
  const code = error?.code;
  if (code === 'P0002' || code === 'PGRST116') {
    return res.status(404).json({ success: false, code: 'LEAVE_NOT_FOUND', message: 'Leave request or employee not found.' });
  }
  if (code === '42501') {
    return res.status(403).json({ success: false, code: 'LEAVE_ACCESS_DENIED', message: error.message || 'Access denied.' });
  }
  if (code === '23P01') {
    return res.status(409).json({ success: false, code: 'LEAVE_RANGE_CONFLICT', message: 'An active or pending leave already exists for these dates.' });
  }
  if (code === '23505' || code === 'P0001') {
    return res.status(409).json({ success: false, code: 'LEAVE_CONFLICT', message: error.message || 'Leave conflict occurred.' });
  }
  if (['23514', '23503', '22023', '22007', '22008', '22P02', '22003'].includes(code)) {
    return res.status(400).json({ success: false, code: 'INVALID_LEAVE', message: error.message || 'Invalid leave values. Check dates, types and rules.' });
  }
  console.error('Leave operation failed:', error);
  return res.status(500).json({ success: false, message: 'Leave operation failed.' });
}

async function checked(query) {
  const result = await query;
  if (result.error) throw result.error;
  return result;
}

const handle = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendError(res, error);
  }
};

const ELIGIBLE_CATEGORIES = ['HO Staff', 'Projects Department Employees'];

async function getLinkedEmployee(userId) {
  const { data: employee } = await checked(
    supabase.from('hr_employees')
      .select('id, employee_code, employee_name, employee_category, department, joining_date, active_status')
      .eq('erp_user_id', userId)
      .maybeSingle()
  );
  return employee;
}

module.exports = {
  context: handle(async (req, res) => {
    const employee = await getLinkedEmployee(req.user.id);
    const eligible = Boolean(
      employee &&
      employee.active_status === 'Active' &&
      ELIGIBLE_CATEGORIES.includes(employee.employee_category)
    );
    res.json({
      success: true,
      eligible,
      employee: employee || null
    });
  }),

  myRequests: handle(async (req, res) => {
    const employee = await getLinkedEmployee(req.user.id);
    if (!employee || employee.active_status !== 'Active' || !ELIGIBLE_CATEGORIES.includes(employee.employee_category)) {
      return res.status(403).json({
        success: false,
        code: 'LEAVE_ACCESS_DENIED',
        message: 'Self-service leave is restricted to linked HO Staff and Projects Department employees.'
      });
    }

    const { data: requests } = await checked(
      supabase.from('hr_leave_requests')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('request_source', 'SELF_SERVICE')
        .order('from_date', { ascending: false })
    );

    const reqList = requests || [];
    const actorIds = [...new Set(reqList.map(r => r.decided_by).filter(Boolean))];
    let actors = {};
    if (actorIds.length > 0) {
      const { data: users } = await checked(
        supabase.from('authorised_users').select('id, display_name').in('id', actorIds)
      );
      actors = Object.fromEntries((users || []).map(u => [u.id, u.display_name]));
    }

    res.json({
      success: true,
      requests: reqList,
      actors
    });
  }),

  create: handle(async (req, res) => {
    const employee = await getLinkedEmployee(req.user.id);
    if (!employee || employee.active_status !== 'Active' || !ELIGIBLE_CATEGORIES.includes(employee.employee_category)) {
      return res.status(403).json({
        success: false,
        code: 'LEAVE_ACCESS_DENIED',
        message: 'Self-service leave is restricted to linked HO Staff and Projects Department employees.'
      });
    }

    const b = req.body;
    const { data } = await checked(
      supabase.rpc('save_hr_leave_request', {
        p_leave_id: null,
        p_employee_id: employee.id,
        p_source: 'SELF_SERVICE',
        p_from_date: b.from_date,
        p_to_date: b.to_date,
        p_leave_type: b.leave_type,
        p_reason: b.reason || null,
        p_pay_treatment: 'Pending',
        p_actor_id: req.user.id
      })
    );

    res.json({ success: true, leave: data });
  }),

  update: handle(async (req, res) => {
    const employee = await getLinkedEmployee(req.user.id);
    if (!employee || employee.active_status !== 'Active' || !ELIGIBLE_CATEGORIES.includes(employee.employee_category)) {
      return res.status(403).json({
        success: false,
        code: 'LEAVE_ACCESS_DENIED',
        message: 'Self-service leave is restricted to linked HO Staff and Projects Department employees.'
      });
    }

    const { data: existing } = await checked(
      supabase.from('hr_leave_requests')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle()
    );

    if (!existing) {
      return res.status(404).json({ success: false, code: 'LEAVE_NOT_FOUND', message: 'Leave request not found.' });
    }

    if (existing.employee_id !== employee.id || existing.request_source !== 'SELF_SERVICE') {
      return res.status(403).json({ success: false, code: 'LEAVE_ACCESS_DENIED', message: 'You can only edit your own self-service leave.' });
    }

    if (existing.approval_status !== 'Pending') {
      return res.status(409).json({ success: false, code: 'LEAVE_CONFLICT', message: 'Decided leave is immutable.' });
    }

    const b = req.body;
    const { data } = await checked(
      supabase.rpc('save_hr_leave_request', {
        p_leave_id: req.params.id,
        p_employee_id: employee.id,
        p_source: 'SELF_SERVICE',
        p_from_date: b.from_date,
        p_to_date: b.to_date,
        p_leave_type: b.leave_type,
        p_reason: b.reason || null,
        p_pay_treatment: 'Pending',
        p_actor_id: req.user.id
      })
    );

    res.json({ success: true, leave: data });
  }),

  queue: handle(async (req, res) => {
    const { status, employee_category, from_date, to_date, page = 1, limit = 20 } = req.query;

    let query = supabase.from('hr_leave_requests')
      .select('*, employee:hr_employees(id, employee_code, employee_name, department, employee_category)', { count: 'exact' })
      .eq('request_source', 'SELF_SERVICE');

    if (status) query = query.eq('approval_status', status);
    if (employee_category) query = query.eq('employee_category', employee_category);
    if (from_date) query = query.gte('from_date', from_date);
    if (to_date) query = query.lte('to_date', to_date);

    query = query.order('from_date', { ascending: false });
    query = query.range((page - 1) * limit, page * limit - 1);

    const { data, count } = await checked(query);
    const reqList = data || [];

    const actorIds = [...new Set(reqList.flatMap(r => [r.created_by, r.decided_by]).filter(Boolean))];
    let actors = {};
    if (actorIds.length > 0) {
      const { data: users } = await checked(
        supabase.from('authorised_users').select('id, display_name').in('id', actorIds)
      );
      actors = Object.fromEntries((users || []).map(u => [u.id, u.display_name]));
    }

    res.json({
      success: true,
      requests: reqList,
      actors,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        totalItems: count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / limit))
      }
    });
  }),

  decide: handle(async (req, res) => {
    const { data: existing } = await checked(
      supabase.from('hr_leave_requests')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle()
    );

    if (!existing) {
      return res.status(404).json({ success: false, code: 'LEAVE_NOT_FOUND', message: 'Leave request not found.' });
    }

    if (existing.request_source !== 'SELF_SERVICE') {
      return res.status(400).json({ success: false, code: 'INVALID_LEAVE', message: 'Factory leave must be decided through attendance sheet review.' });
    }

    if (existing.approval_status !== 'Pending') {
      return res.status(409).json({ success: false, code: 'LEAVE_CONFLICT', message: 'Decided leave is immutable.' });
    }

    const b = req.body;
    const finalTreatment = b.decision === 'Rejected' ? 'Unpaid' : b.pay_treatment;

    const { data } = await checked(
      supabase.rpc('decide_hr_leave_request', {
        p_leave_id: req.params.id,
        p_decision: b.decision,
        p_pay_treatment: finalTreatment,
        p_remarks: b.remarks || null,
        p_actor_id: req.user.id
      })
    );

    res.json({ success: true, leave: data });
  })
};
