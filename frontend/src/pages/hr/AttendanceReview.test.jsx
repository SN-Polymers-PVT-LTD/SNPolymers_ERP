import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AttendanceReviewQueue from './AttendanceReviewQueue';
import AttendanceReviewDetail from './AttendanceReviewDetail';
import authApi from '../../api/authApi';
vi.mock('../../api/authApi',()=>({default:{get:vi.fn(),post:vi.fn()}}));
const category='SNP Casual Factory Labour';let data,queue;
function mount(path='/factory-attendance/review/sheet-id') {
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/factory-attendance/review" element={<AttendanceReviewQueue />} /><Route path="/factory-attendance/review/:sheetId" element={<AttendanceReviewDetail />} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(()=>{
  vi.resetAllMocks();
  data={sheet:{id:'sheet-id',status:'Submitted',attendance_date:'2026-09-30',employee_category:category,submission_count:1,submitted_at:'2026-09-30T12:00:00Z'},review:{can_review:false,blocking_reason:'Unresolved leave'},rows:[{
    id:'row-1',employee_id:'employee-1',employee:{employee_code:'EMP-1',employee_name:'Ramesh'},attendance_status:'Medical Leave',entry_timestamp:null,exit_timestamp:null,actual_hours:0,ot_hours:0,remarks:'Fever',leave:{id:'leave-1',approval_status:'Pending',from_date:'2026-09-30',to_date:'2026-10-01',leave_type:'Medical Leave',reason:'Fever',pay_treatment:'Pending'}
  },{id:'row-2',employee:{employee_code:'EMP-2',employee_name:'Suresh'},attendance_status:'Present',entry_timestamp:'2026-09-30T20:00:00+05:30',exit_timestamp:'2026-10-01T06:00:00+05:30',actual_hours:10,ot_hours:2,duty_type:null,holiday_pay_eligible:true,remarks:'Overnight duty'}]};
  queue={sheets:[{id:'sheet-id',attendance_date:'2026-09-30',employee_category:category,roster:2,present:1,absent:0,leave_medical:1,comp_off:0,holiday_pay_eligible:1,total_ot_hours:2,submitted_by_name:'Factory Operator',status:'Submitted',ho_remarks:null}],pagination:{totalItems:21,totalPages:2}};
  authApi.get.mockImplementation(async(path)=>({data:structuredClone(path.endsWith('/review-queue')?queue:path.endsWith('/history')?{history:[{id:'audit-1',timestamp:'2026-09-30T12:00:00Z',action:'SHEET_SUBMITTED',user_name:'Factory Operator'}],pagination:{totalPages:1}}:data)}));
  authApi.post.mockImplementation(async(path,body)=>{
    if(path.endsWith('/decision')) {Object.assign(data.rows[0].leave,{approval_status:body.decision,pay_treatment:body.pay_treatment,decision_remarks:body.remarks});data.review={can_review:true,blocking_reason:null};}
    if(path.endsWith('/review'))data.sheet.status='Locked';
    if(path.endsWith('/return')){data.sheet.status='Returned for Correction';data.sheet.return_remarks=body.remarks;}
    return {data:{success:true}};
  });
});
it('queue deep links retain filters/page, show summaries and open read-only sheet',async()=>{
  mount(`/factory-attendance/review?from_date=2026-09-01&to_date=2026-09-30&employee_category=${encodeURIComponent(category)}&status=Locked&page=2`);
  await screen.findByText('Factory Operator');expect(authApi.get).toHaveBeenCalledWith('/hr/attendance/review-queue',{params:{from_date:'2026-09-01',to_date:'2026-09-30',employee_category:category,status:'Locked',page:2,limit:20}});
  expect(screen.getByText('2.00')).toBeInTheDocument();expect(screen.getByRole('columnheader',{name:'Leave / Medical'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Review Status'),{target:{value:'All'}});await waitFor(()=>expect(authApi.get).toHaveBeenLastCalledWith('/hr/attendance/review-queue',{params:expect.not.objectContaining({status:expect.anything()})}));
  fireEvent.click(await screen.findByRole('link',{name:'Open Sheet'}));await screen.findByText('Linked Leave Requests');expect(authApi.get).toHaveBeenCalledWith('/hr/attendance/sheets/sheet-id/review-detail');
});
it('queue provides loading, empty and stable API errors',async()=>{
  queue.sheets=[];queue.pagination={totalItems:0,totalPages:1};mount('/factory-attendance/review');expect(screen.getByRole('status')).toHaveTextContent('Loading');await screen.findByText('No sheets match these filters.');
  authApi.get.mockRejectedValue({response:{data:{message:'Access denied'}}});fireEvent.click(screen.getByRole('button',{name:'Refresh'}));expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
});
it('shows stored timestamps, hours, exceptions and leave; no attendance entry controls',async()=>{
  mount();await screen.findByText('Linked Leave Requests');
  expect(screen.getByText('30 Sept 2026, 20:00')).toBeInTheDocument();expect(screen.getByText('1 Oct 2026, 06:00')).toBeInTheDocument();expect(screen.getByText('10.00')).toBeInTheDocument();expect(screen.getByText('2.00')).toBeInTheDocument();
  expect(screen.getByText('Overnight duty')).toBeInTheDocument();expect(screen.queryByLabelText('Entry for Suresh')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Review & Lock'})).toBeDisabled();
});
it('approval selects final treatment then enables Review & Lock; immutable result has no separate Lock action',async()=>{
  mount();await screen.findByText('Linked Leave Requests');
  expect(screen.getByRole('button',{name:'Approve Leave for Ramesh'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Pay Treatment for Ramesh'),{target:{value:'Paid'}});
  expect(screen.getByRole('button',{name:'Approve Leave for Ramesh'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Approve Leave for Ramesh'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Review & Lock'})).toBeEnabled());
  expect(authApi.post).toHaveBeenCalledWith('/hr/attendance/sheets/sheet-id/leaves/leave-1/decision',{decision:'Approved',pay_treatment:'Paid',remarks:''});
  fireEvent.change(screen.getByLabelText('HO Remarks'),{target:{value:'Reviewed overnight duty and holiday'}});fireEvent.click(screen.getByRole('button',{name:'Review & Lock'}));
  await screen.findByText('Status: Locked');expect(authApi.post).toHaveBeenCalledWith('/hr/attendance/sheets/sheet-id/review',{remarks:'Reviewed overnight duty and holiday'});
  expect(screen.queryByRole('button',{name:'Review & Lock'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Unlock|Reopen|^Lock$/})).not.toBeInTheDocument();
});
it('Local leave pay control is forced Unpaid and Double Duty is displayed with stored zero OT',async()=>{
  data.sheet.employee_category='Local Daily-Wage Workers';data.rows[0].leave.pay_treatment='Unpaid';data.rows[1].duty_type='Double Duty';data.rows[1].ot_hours=0;
  mount();await screen.findByText('Linked Leave Requests');expect(screen.getByLabelText('Pay Treatment for Ramesh')).toBeDisabled();expect(screen.getByLabelText('Pay Treatment for Ramesh')).toHaveValue('Unpaid');expect(screen.getByText('Double Duty')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Approve Leave for Ramesh'}));await waitFor(()=>expect(authApi.post).toHaveBeenCalledWith(expect.stringContaining('/decision'),{decision:'Approved',pay_treatment:'Unpaid',remarks:''}));
});
it('reject requires remarks, returns sheet and preserves Medical Leave attendance',async()=>{
  authApi.post.mockImplementation(async(_path,body)=>{data.rows[0].leave.approval_status='Rejected';data.sheet.status='Returned for Correction';data.sheet.return_remarks=body.remarks;return {data:{success:true}};});
  mount();await screen.findByText('Linked Leave Requests');expect(screen.getByRole('button',{name:'Reject Leave for Ramesh'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Pay Treatment for Ramesh'),{target:{value:'Paid'}});
  fireEvent.change(screen.getByLabelText('Decision Remarks for Ramesh'),{target:{value:'Clarify dates'}});
  expect(screen.getByRole('button',{name:'Reject Leave for Ramesh'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Reject Leave for Ramesh'}));
  await screen.findByText('Status: Returned for Correction');expect(authApi.post).toHaveBeenCalledWith(expect.stringContaining('/decision'),{decision:'Rejected',pay_treatment:'Unpaid',remarks:'Clarify dates'});
  expect(within(screen.getByRole('table')).getByText('Medical Leave')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Review & Lock'})).not.toBeInTheDocument();
});
it('changed approval treatment reloads Returned state and prevents locking',async()=>{
  data.rows[0].attendance_status='Paid Leave';data.rows[0].leave.leave_type='Paid Leave';data.rows[0].leave.pay_treatment='Paid';
  authApi.post.mockImplementation(async()=>{data.rows[0].leave.approval_status='Approved';data.rows[0].leave.pay_treatment='Unpaid';data.sheet.status='Returned for Correction';return {data:{success:true}};});
  mount();await screen.findByText('Linked Leave Requests');fireEvent.change(screen.getByLabelText('Pay Treatment for Ramesh'),{target:{value:'Unpaid'}});fireEvent.click(screen.getByRole('button',{name:'Approve Leave for Ramesh'}));
  await screen.findByText('Status: Returned for Correction');expect(within(screen.getByRole('table')).getByText('Paid Leave')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Review & Lock'})).not.toBeInTheDocument();
});
it('return requires remarks and reloads workflow; failed mutation retains input',async()=>{
  mount();await screen.findByText('Linked Leave Requests');expect(screen.getByRole('button',{name:'Return for Correction'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('HO Remarks'),{target:{value:'Correct exception'}});
  authApi.post.mockRejectedValueOnce({response:{data:{message:'Sheet already locked'}}});fireEvent.click(screen.getByRole('button',{name:'Return for Correction'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sheet already locked');expect(screen.getByLabelText('HO Remarks')).toHaveValue('Correct exception');
  fireEvent.click(screen.getByRole('button',{name:'Return for Correction'}));await screen.findByText('Status: Returned for Correction');expect(authApi.post).toHaveBeenLastCalledWith('/hr/attendance/sheets/sheet-id/return',{remarks:'Correct exception'});
});
it('scoped history shows named actors and detail error state',async()=>{
  mount();await screen.findByText('Linked Leave Requests');fireEvent.click(screen.getByRole('button',{name:'Show History'}));await screen.findByText(/SHEET_SUBMITTED · Factory Operator/);
  expect(authApi.get).toHaveBeenCalledWith('/hr/attendance/sheets/sheet-id/history',{params:{page:1,limit:20}});
});

describe('Step 2 Presentation Acceptance Tests', () => {
  it('renders styled status badge chips in queue and structured header summary cards in detail', async () => {
    // 1. Queue presentation test
    mount('/factory-attendance/review');
    await screen.findByText('Factory Operator');

    // Styled action button in queue
    const openSheetLinks = screen.getAllByRole('link', { name: 'Open Sheet' });
    expect(openSheetLinks.length).toBeGreaterThan(0);
    expect(openSheetLinks[0]).toHaveClass('uppercase');

    // 2. Detail presentation test
    mount('/factory-attendance/review/sheet-id');
    await screen.findByText('Linked Leave Requests');

    // Metadata card summary
    expect(screen.getByText('Submitted Roster Verification')).toBeInTheDocument();
    expect(screen.getByText(/Submission Round/)).toBeInTheDocument();
    expect(screen.getByText(/Total Headcount/)).toBeInTheDocument();

    // Leave Decision card
    const leaveSection = screen.getByRole('region', { name: 'Leave for Ramesh' });
    expect(leaveSection).toBeInTheDocument();
    expect(within(leaveSection).getByText('Employee Leave Request')).toBeInTheDocument();
    expect(within(leaveSection).getByRole('button', { name: 'Approve Leave for Ramesh' })).toBeInTheDocument();
    expect(within(leaveSection).getByRole('button', { name: 'Reject Leave for Ramesh' })).toBeInTheDocument();
  });
});
