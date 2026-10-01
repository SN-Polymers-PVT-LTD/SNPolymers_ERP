const { supabase } = require('../db/supabase');

function sendError(res, error) {
  const code = error?.code;
  if (code === 'P0002' || code === 'PGRST116') return res.status(404).json({ success: false, code: 'ATTENDANCE_NOT_FOUND', message: 'Attendance sheet, employee row or leave request was not found.' });
  if (code === '42501') return res.status(403).json({ success: false, code: 'FACTORY_ACCESS_DENIED', message: 'Factory attendance access denied.' });
  if (code === '23P01') return res.status(409).json({ success: false, code: 'LEAVE_RANGE_CONFLICT', message: 'Pending or Approved leave already covers this employee and date range.' });
  if (code === '23505' || code === 'P0001') return res.status(409).json({ success: false, code: 'ATTENDANCE_CONFLICT', message: error.message });
  if (['23514','23503','22023','22007','22008','22P02','22003'].includes(code)) return res.status(400).json({ success: false, code: 'INVALID_ATTENDANCE', message: 'Invalid attendance or leave values. Check dates, timestamps and category rules.' });
  console.error('Factory attendance operation failed:', error);
  return res.status(500).json({ success: false, message: 'Factory attendance operation failed.' });
}
async function checked(query) { const result = await query; if (result.error) throw result.error; return result; }
// PostgREST caps a response at 1000 rows; do not silently truncate factory rosters.
async function all(queryFactory) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await checked(queryFactory().range(offset, offset + 999));
    rows.push(...data); if (data.length < 1000) return rows;
  }
}
const employeeFields = 'id,employee_code,employee_name,employee_category,joining_date,active_status';
async function sheetById(id) { return (await checked(supabase.from('hr_attendance_sheets').select('*').eq('id', id).single())).data; }
async function detail(sheet) {
  if (!sheet) return { sheet: null, rows: [] };
  const rows = await all(() => supabase.from('hr_attendance_rows').select(`*,employee:hr_employees(${employeeFields}),leave:hr_leave_requests(*),rule:hr_factory_pay_rule_revisions(standard_duty_hours,holiday_pay_enabled)`).eq('sheet_id', sheet.id).order('employee_id'));
  // Covering requests let FM explicitly attach existing range leave to an older draft row.
  const leaves = await all(() => supabase.from('hr_leave_requests').select('*').eq('request_source','FACTORY_MANAGER')
    .eq('employee_category',sheet.employee_category).lte('from_date',sheet.attendance_date).gte('to_date',sheet.attendance_date).order('id'));
  const available = new Map(leaves.filter(l => l.approval_status !== 'Rejected').map(l => [l.employee_id,l]));
  return { sheet, rows: rows.map(row => ({ ...row, available_leave: available.get(row.employee_id) || null })) };
}
const handle = fn => async (req, res) => { try { await fn(req,res); } catch (error) { sendError(res,error); } };
module.exports = {
  calendar: handle(async (req, res) => {
    const { employee_category, month, employee_id } = req.query;
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    const fromDate = `${month}-01`;
    const lastDay = new Date(Date.UTC(year, monthNum, 0)).getDate();
    const toDate = `${month}-${String(lastDay).padStart(2, '0')}`;

    // Include editable and returned sheets for the calendar correction workflow.
    const sheets = await all(() =>
      supabase.from('hr_attendance_sheets')
        .select('id, attendance_date, status, submission_count')
        .eq('employee_category', employee_category)
        .gte('attendance_date', fromDate)
        .lte('attendance_date', toDate)
        .order('attendance_date').order('id')
    );

    const sheetList = sheets || [];
    const sheetIds = sheetList.map(s => s.id);

    let rows = [];
    if (sheetIds.length > 0) {
      rows = await all(() => {
        let query = supabase.from('hr_attendance_rows').select(`
          id, sheet_id, employee_id, attendance_status,
          entry_timestamp, exit_timestamp, actual_hours, ot_hours,
          duty_type, holiday_pay_eligible, leave_request_id, remarks
        `).in('sheet_id', sheetIds).order('id');
        if (employee_id) query = query.eq('employee_id', employee_id);
        return query;
      });
    }

    const employeeIdsFromRows = [...new Set(rows.map(r => r.employee_id))];
    const activeEmployees = await all(() =>
      supabase.from('hr_employees')
        .select('id, employee_code, employee_name, active_status')
        .eq('employee_category', employee_category)
        .order('employee_code').order('id')
    );

    const activeList = activeEmployees || [];
    const employeeMap = new Map(activeList.map(e => [e.id, e]));

    const missingIds = employeeIdsFromRows.filter(id => !employeeMap.has(id));
    for (let offset = 0; offset < missingIds.length; offset += 200) {
      const historicalEmployees = await all(() =>
        supabase.from('hr_employees')
          .select('id, employee_code, employee_name, active_status')
          .in('id', missingIds.slice(offset, offset + 200)).order('id')
      );
      for (const e of historicalEmployees || []) {
        employeeMap.set(e.id, e);
      }
    }

    const codeMap = {
      'Present': 'P',
      'Absent': 'A',
      'Medical Leave': 'ML',
      'Paid Leave': 'PL',
      'Unpaid Leave': 'UL',
      'Compensatory Off': 'CO',
      'Management Issue': 'MI'
    };

    const sheetMap = new Map(sheetList.map(s => [s.id, s]));

    const records = rows.map(r => {
      const s = sheetMap.get(r.sheet_id);
      const emp = employeeMap.get(r.employee_id);
      return {
        id: r.id,
        sheet_id: r.sheet_id,
        sheet_status: s?.status,
        date: s?.attendance_date,
        employee_id: r.employee_id,
        employee_code: emp?.employee_code || null,
        employee_name: emp?.employee_name || null,
        attendance_status: r.attendance_status,
        code: codeMap[r.attendance_status] || '-',
        actual_hours: Number(r.actual_hours) || 0,
        ot_hours: Number(r.ot_hours) || 0,
        duty_type: r.duty_type,
        holiday_pay_eligible: r.holiday_pay_eligible,
        entry_timestamp: r.entry_timestamp,
        exit_timestamp: r.exit_timestamp,
        remarks: r.remarks,
        leave_request_id: r.leave_request_id
      };
    });

    const employees = Array.from(employeeMap.values()).sort((a, b) =>
      (a.employee_code || '').localeCompare(b.employee_code || '')
    );

    res.json({
      success: true,
      month,
      from_date: fromDate,
      to_date: toDate,
      days_in_month: lastDay,
      employee_category,
      sheets: sheetList,
      employees,
      records
    });
  }),
  reviewQueue: handle(async (req,res) => {
    const q=req.query;
    const {data}=await checked(supabase.rpc('get_hr_attendance_review_queue',{p_actor_id:req.user.id,
      p_from_date:q.from_date||null,p_to_date:q.to_date||null,p_category:q.employee_category||null,
      p_status:q.status||null,p_page:q.page,p_limit:q.limit}));
    res.json({success:true,...data});
  }),
  reviewDetail: handle(async (req,res) => {
    const {data}=await checked(supabase.rpc('get_hr_attendance_review_state',{p_sheet_id:req.params.sheetId,p_actor_id:req.user.id}));
    const payload=await detail(await sheetById(req.params.sheetId));
    const actorIds=[...new Set([payload.sheet.submitted_by,payload.sheet.reviewed_by,payload.sheet.returned_by,
      ...payload.rows.flatMap(row=>[row.leave?.created_by,row.leave?.decided_by])].filter(Boolean))];
    const users=actorIds.length?(await checked(supabase.from('authorised_users').select('id,display_name').in('id',actorIds))).data:[];
    res.json({success:true,...payload,review:data,actors:Object.fromEntries(users.map(user=>[user.id,user.display_name]))});
  }),
  decideLeave: handle(async (req,res) => {
    const b=req.body;
    const {data}=await checked(supabase.rpc('decide_hr_factory_sheet_leave',{p_sheet_id:req.params.sheetId,p_leave_id:req.params.leaveId,
      p_decision:b.decision,p_pay_treatment:b.pay_treatment,p_remarks:b.remarks||null,p_actor_id:req.user.id}));
    res.json({success:true,leave:data});
  }),
  returnSheet: handle(async (req,res) => {
    const {data}=await checked(supabase.rpc('transition_hr_attendance_sheet',{p_sheet_id:req.params.sheetId,p_action:'return',p_remarks:req.body.remarks,p_actor_id:req.user.id}));
    res.json({success:true,sheet:data});
  }),
  fmSummary: handle(async (req, res) => {
    const today = req.query.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const returnedSheets = await all(() => supabase.from('hr_attendance_sheets')
      .select('id, employee_category, attendance_date, status, return_remarks, submission_count, updated_at')
      .eq('status', 'Returned for Correction').order('attendance_date', { ascending: false }).order('id'));
    const { data: todaySheets } = await checked(supabase.from('hr_attendance_sheets')
      .select('id, employee_category, attendance_date, status, submission_count').eq('attendance_date', today));
    const hours = todaySheets.length ? await all(() => supabase.from('hr_attendance_rows')
      .select('sheet_id,ot_hours').in('sheet_id',todaySheets.map(sheet => sheet.id)).order('id')) : [];
    const totals = new Map();
    for (const row of hours) totals.set(row.sheet_id,(totals.get(row.sheet_id)||0)+Number(row.ot_hours));
    for (const sheet of todaySheets) sheet.total_ot_hours=totals.get(sheet.id)||0;
    res.json({
      success: true,
      date: today,
      today_sheets: todaySheets || [],
      returned_sheets: returnedSheets || []
    });
  }),
  reviewSheet: handle(async (req,res) => {
    const {data}=await checked(supabase.rpc('transition_hr_attendance_sheet',{p_sheet_id:req.params.sheetId,p_action:'review',p_remarks:req.body.remarks||null,p_actor_id:req.user.id}));
    res.json({success:true,sheet:data});
  }),
  roster: handle(async (req,res) => {
    const employees = await all(() => supabase.from('hr_employees').select(employeeFields).eq('employee_category',req.query.employee_category)
      .eq('active_status','Active').lte('joining_date',req.query.date).order('employee_code').order('id'));
    res.json({ success: true, employees });
  }),
  load: handle(async (req,res) => {
    const { data } = await checked(supabase.from('hr_attendance_sheets').select('*').eq('employee_category',req.query.employee_category).eq('attendance_date',req.query.date).maybeSingle());
    res.json({ success: true, ...await detail(data) });
  }),
  get: handle(async (req,res) => res.json({ success: true, ...await detail(await sheetById(req.params.sheetId)) })),
  populate: handle(async (req,res) => {
    const { data } = await checked(supabase.rpc('populate_hr_attendance_sheet',{ p_date: req.body.date, p_category: req.body.employee_category, p_actor_id: req.user.id }));
    res.json({ success: true, sheet: data });
  }),
  save: handle(async (req,res) => {
    const { data } = await checked(supabase.rpc('save_hr_attendance_rows',{ p_sheet_id: req.params.sheetId, p_rows: req.body.rows, p_actor_id: req.user.id }));
    res.json({ success: true, rows: data });
  }),
  submit: handle(async (req,res) => {
    const { data } = await checked(supabase.rpc('transition_hr_attendance_sheet',{ p_sheet_id: req.params.sheetId, p_action: 'submit', p_remarks: null, p_actor_id: req.user.id }));
    res.json({ success: true, sheet: data });
  }),
  leave: handle(async (req,res) => {
    const b = req.body;
    const { data } = await checked(supabase.rpc('save_hr_factory_attendance_leave',{ p_sheet_id: req.params.sheetId, p_employee_id: b.employee_id, p_leave_id: b.leave_id,
      p_from_date: b.from_date, p_to_date: b.to_date, p_leave_type: b.leave_type, p_reason: b.reason, p_pay_treatment: b.pay_treatment, p_actor_id: req.user.id }));
    res.json({ success: true, leave: data });
  }),
  history: handle(async (req,res) => {
    const sheet = await sheetById(req.params.sheetId);
    const rows = await all(() => supabase.from('hr_attendance_rows').select('id,employee_id').eq('sheet_id',sheet.id).order('id'));
    const leaves = await all(() => supabase.from('hr_leave_requests').select('id,employee_id').eq('request_source','FACTORY_MANAGER').eq('employee_category',sheet.employee_category)
      .lte('from_date',sheet.attendance_date).gte('to_date',sheet.attendance_date).order('id'));
    const employeeIds = new Set(rows.map(r => r.employee_id));
    // A corrected/unlinked Pending request may later move its range. Its original
    // sheet still needs the request's history, traced through immutable row audits.
    const past = rows.length ? await all(() => supabase.from('audit_log')
      .select('old_leave:old_value->>leave_request_id,new_leave:new_value->>leave_request_id')
      .eq('module_name','HR Attendance').in('record_identifier',rows.map(row => row.id)).order('id')) : [];
    const linkedIds = [...new Set(past.flatMap(log => [log.old_leave,log.new_leave]).filter(Boolean))];
    const pastLeaves = linkedIds.length ? await all(() => supabase.from('hr_leave_requests').select('id,employee_id')
      .eq('request_source','FACTORY_MANAGER').eq('employee_category',sheet.employee_category).in('id',linkedIds).order('id')) : [];
    const ids = [...new Set([sheet.id,...rows.map(r => r.id),...[...leaves,...pastLeaves].filter(l => employeeIds.has(l.employee_id)).map(l => l.id)])];
    // UUIDs from validated/database identities only. Scope both the module and record IDs.
    const { page,limit } = req.query;
    const { data,count } = await checked(supabase.from('audit_log').select('*',{count:'exact'}).in('module_name',['HR Attendance','HR Leave'])
      .in('record_identifier',ids).order('timestamp',{ascending:false}).order('id',{ascending:false}).range((page-1)*limit,page*limit-1));
    const actorIds = [...new Set(data.map(log => log.user_id))].filter(id => /^[0-9a-f-]{36}$/i.test(id));
    const users = actorIds.length ? (await checked(supabase.from('authorised_users').select('id,display_name').in('id',actorIds))).data : [];
    const names = new Map(users.map(u => [u.id,u.display_name]));
    res.json({success:true,history:data.map(log => ({...log,user_name:names.get(log.user_id)||log.user_id})),pagination:{page,limit,totalItems:count,totalPages:Math.max(1,Math.ceil(count/limit))}});
  })
};
