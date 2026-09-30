import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DailyAttendance from './DailyAttendance';
import { ModalProvider, useModalOverlay } from '../../components/ModalContext';
const ModalProbe = () => <span data-testid="modal-overlay-state">{useModalOverlay().isModalOpen ? 'open' : 'closed'}</span>;
import ProtectedRoute from '../../components/ProtectedRoute';
import { useAuth } from '../../components/AuthContext';
import * as api from '../../api/hrAttendanceApi';
vi.mock('../../components/AuthContext',()=>({useAuth:vi.fn()}));
vi.mock('../../api/hrAttendanceApi',()=>({loadAttendanceSheet:vi.fn(),populateAttendanceSheet:vi.fn(),saveAttendanceRows:vi.fn(),saveFactoryLeave:vi.fn(),submitAttendanceSheet:vi.fn(),getAttendanceHistory:vi.fn()}));
const casual='SNP Casual Factory Labour'; const local='Local Daily-Wage Workers';
const sheet={id:'sheet-1',status:'Draft',submission_count:0,attendance_date:'2026-09-30',employee_category:casual};
const employee=(id,name)=>({id,employee_id:id,employee:{employee_name:name,employee_code:`EMP-${id}`,active_status:'Active'},rule:{standard_duty_hours:8,holiday_pay_enabled:true},attendance_status:null,entry_timestamp:null,exit_timestamp:null,actual_hours:0,ot_hours:0,duty_type:null,holiday_pay_eligible:false,leave_request_id:null,leave:null,available_leave:null,remarks:null});
let data;
const mount=(category=casual)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>
  <ModalProvider><ModalProbe /><MemoryRouter initialEntries={[`/factory-attendance?category=${encodeURIComponent(category)}&date=2026-09-30`]}><Routes>
    <Route element={<ProtectedRoute allowedRoles={['admin','factory_manager','ho']} />}><Route path="/factory-attendance" element={<DailyAttendance />} /></Route>
    <Route path="/dashboard" element={<p>Dashboard destination</p>} /><Route path="/login" element={<p>Login destination</p>} />
  </Routes></MemoryRouter></ModalProvider></QueryClientProvider>);
beforeEach(()=>{
  vi.resetAllMocks(); useAuth.mockReturnValue({user:{role:'factory_manager'},loading:false});
  data={sheet:{...sheet},rows:[employee('one','Ramesh'),employee('two','Suresh')]};
  api.loadAttendanceSheet.mockImplementation(async()=>({data:structuredClone(data)}));
  api.populateAttendanceSheet.mockImplementation(async()=>{data.sheet={...sheet};return {data:{sheet:data.sheet}};});
  api.saveAttendanceRows.mockImplementation(async(_id,rows)=>{for(const patch of rows) Object.assign(data.rows.find(r=>r.employee_id===patch.employee_id),patch);return {data:{rows:data.rows}};});
  api.submitAttendanceSheet.mockImplementation(async()=>{data.sheet.status='Submitted';return {data:{sheet:data.sheet}};});
  api.saveFactoryLeave.mockResolvedValue({data:{leave:{id:'leave-1'}}});
  api.getAttendanceHistory.mockResolvedValue({data:{history:[],pagination:{totalPages:1}}});
});
describe('Daily factory attendance',()=>{
  it('loads a category/date deep link without creating a sheet; creation is explicit',async()=>{
    data.sheet=null; data.rows=[]; mount(); await screen.findByText('No sheet exists for this date/category.');
    expect(api.loadAttendanceSheet).toHaveBeenCalledWith({employee_category:casual,date:'2026-09-30'}); expect(api.populateAttendanceSheet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Create Attendance Sheet'}));
    await waitFor(()=>expect(api.populateAttendanceSheet).toHaveBeenCalledWith({employee_category:casual,date:'2026-09-30'}));
    expect(await screen.findByText('Attendance sheet/roster refreshed.')).toBeInTheDocument();
    expect(await screen.findByText('No eligible employees. Employees must be Active and joined on or before this date.')).toBeInTheDocument();
  });
  it('Mark All Present preserves existing exceptions and does not invent timestamps or hours',async()=>{
    data.rows[1].attendance_status='Absent'; mount(); await screen.findByText('Ramesh');
    fireEvent.click(screen.getByRole('button',{name:'Mark All Present'}));
    expect(screen.getByLabelText('Status for Ramesh')).toHaveValue('Present'); expect(screen.getByLabelText('Status for Suresh')).toHaveValue('Absent');
    expect(screen.getByLabelText('Entry for Ramesh')).toHaveValue(''); expect(screen.getByRole('button',{name:'Submit to HO'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
    await waitFor(()=>expect(api.saveAttendanceRows).toHaveBeenCalledWith(sheet.id,[{employee_id:'one',attendance_status:'Present'}]));
  });
  it('sends full India-time timestamps for overnight/24-hour duty and shows server-calculated hours after save',async()=>{
    data.rows[0].attendance_status='Present'; mount(); await screen.findByText('Ramesh');
    fireEvent.change(screen.getByLabelText('Entry for Ramesh'),{target:{value:'2026-09-30T08:00'}});
    fireEvent.change(screen.getByLabelText('Exit for Ramesh'),{target:{value:'2026-10-01T08:00'}});
    api.saveAttendanceRows.mockImplementation(async(_id,patches)=>{Object.assign(data.rows[0],patches[0],{actual_hours:24,ot_hours:16});return {data:{rows:data.rows}};});
    fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
    await waitFor(()=>expect(api.saveAttendanceRows).toHaveBeenCalledWith(sheet.id,[{employee_id:'one',entry_timestamp:'2026-09-30T08:00:00+05:30',exit_timestamp:'2026-10-01T08:00:00+05:30'}]));
    expect(await screen.findByText('24.00')).toBeInTheDocument(); expect(screen.getByText('16.00')).toBeInTheDocument();
  });
  it('changing a working row to Absent clears duty, leave link, and holiday while preserving remarks',async()=>{
    Object.assign(data.rows[0],{attendance_status:'Present',entry_timestamp:'2026-09-30T08:00:00+05:30',exit_timestamp:'2026-09-30T18:00:00+05:30',holiday_pay_eligible:true,remarks:'Existing note'});
    mount(); await screen.findByText('Ramesh'); fireEvent.change(screen.getByLabelText('Status for Ramesh'),{target:{value:'Absent'}});
    expect(screen.getByLabelText('Entry for Ramesh')).toBeDisabled(); expect(screen.getByLabelText('Entry for Ramesh')).toHaveValue(''); expect(screen.getByLabelText('Holiday for Ramesh')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
    await waitFor(()=>expect(api.saveAttendanceRows).toHaveBeenCalledWith(sheet.id,[expect.objectContaining({attendance_status:'Absent',entry_timestamp:null,exit_timestamp:null,duty_type:null,leave_request_id:null,holiday_pay_eligible:false})]));
    expect(screen.getByLabelText('Remarks for Ramesh')).toHaveValue('Existing note');
  });
  it('exposes Local explicit Single/Double Duty, zero-OT rule and Unpaid leave controls',async()=>{
    data.sheet.employee_category=local; data.rows[0].attendance_status='Present'; mount(local); await screen.findByText('Ramesh');
    expect(screen.queryByLabelText('Holiday for Ramesh')).not.toBeInTheDocument(); expect(screen.getByText(/Double Duty has zero OT/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Duty for Ramesh'),{target:{value:'Double Duty'}}); fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
    await waitFor(()=>expect(api.saveAttendanceRows).toHaveBeenCalledWith(sheet.id,[{employee_id:'one',duty_type:'Double Duty'}]));
    await waitFor(()=>expect(screen.getAllByRole('button',{name:'Record Leave'})[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button',{name:'Record Leave'})[0]);
    expect(screen.getByLabelText('Pay Treatment')).toHaveValue('Unpaid'); expect(screen.getByLabelText('Pay Treatment')).toBeDisabled();
    expect(screen.getByLabelText('Leave Type').querySelector('option[value="Paid Leave"]')).toBeNull();
    fireEvent.change(screen.getByLabelText(/Leave Reason/),{target:{value:'Personal'}}); fireEvent.click(screen.getByRole('button',{name:'Save Leave'}));
    await waitFor(()=>expect(api.saveFactoryLeave).toHaveBeenCalledWith(sheet.id,expect.objectContaining({employee_id:'one',leave_type:'Leave / Not Working',pay_treatment:'Unpaid',leave_id:null})));
  });
  it('edits a Pending range request through one API operation and retains form after conflict',async()=>{
    const leave={id:'leave-1',leave_type:'Medical Leave',approval_status:'Pending',pay_treatment:'Pending',from_date:'2026-09-30',to_date:'2026-10-02',reason:'Fever'};
    Object.assign(data.rows[0],{leave_request_id:leave.id,leave,attendance_status:'Medical Leave'});
    api.saveFactoryLeave.mockRejectedValue({response:{data:{message:'Pending or Approved leave already covers this employee and date range.'}}});
    mount(); await screen.findByText('Ramesh'); fireEvent.click(screen.getByRole('button',{name:'Edit Leave'}));
    expect(screen.getByLabelText(/To Date/)).toHaveValue('2026-10-02'); fireEvent.change(screen.getByLabelText(/Leave Reason/),{target:{value:'Updated'}});
    fireEvent.click(screen.getByRole('button',{name:'Save Leave'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('already covers'); expect(screen.getByLabelText(/Leave Reason/)).toHaveValue('Updated');
    expect(api.saveFactoryLeave).toHaveBeenCalledWith(sheet.id,expect.objectContaining({leave_id:'leave-1',reason:'Updated'}));
    expect(api.saveAttendanceRows).not.toHaveBeenCalled();
  });
  it('uses an existing Approved leave with HO-decided treatment, without creating another request',async()=>{
    data.rows[0].available_leave={id:'existing',leave_type:'Paid Leave',approval_status:'Approved',pay_treatment:'Unpaid',from_date:'2026-09-30',to_date:'2026-10-01',reason:'HO changed treatment'};
    mount(); await screen.findByText('Ramesh'); fireEvent.click(screen.getByRole('button',{name:'Use Existing Leave'}));
    expect(screen.getByLabelText('Status for Ramesh')).toHaveValue('Unpaid Leave'); fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
    await waitFor(()=>expect(api.saveAttendanceRows).toHaveBeenCalledWith(sheet.id,[expect.objectContaining({leave_request_id:'existing',attendance_status:'Unpaid Leave'})])); expect(api.saveFactoryLeave).not.toHaveBeenCalled();
  });
  it('Submitted/Locked sheets and HO are read-only, with history available',async()=>{
    data.sheet.status='Submitted'; mount(); await screen.findByText('Ramesh');
    expect(screen.getByLabelText('Status for Ramesh')).toBeDisabled(); expect(screen.queryByRole('button',{name:'Save Draft'})).not.toBeInTheDocument();
    expect(screen.getByText(/HO must return it/)).toBeInTheDocument(); fireEvent.click(screen.getByRole('button',{name:'Show History'})); expect(await screen.findByText('No history for this sheet.')).toBeInTheDocument();
  });
  it('shows returned rejection unchanged until FM explicitly corrects and resubmits',async()=>{
    data.sheet.status='Returned for Correction'; data.sheet.return_remarks='Rejected medical leave; correct facts';
    Object.assign(data.rows[0],{attendance_status:'Medical Leave',leave_request_id:'rejected',leave:{id:'rejected',leave_type:'Medical Leave',approval_status:'Rejected',pay_treatment:'Unpaid',reason:'Fever'}});
    mount(); await screen.findByText('Ramesh'); expect(screen.getByLabelText('Status for Ramesh')).toHaveValue('Medical Leave'); expect(screen.getByText(/Rejected medical leave; correct facts/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status for Ramesh'),{target:{value:'Absent'}}); fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Resubmit to HO'})).toBeEnabled()); fireEvent.click(screen.getByRole('button',{name:'Resubmit to HO'}));
    expect(await screen.findByText('Submitted to HO.')).toBeInTheDocument(); expect(api.submitAttendanceSheet).toHaveBeenCalledWith(sheet.id);
  });
  it('guards unsaved edits and blocks date/category changes during a write',async()=>{
    mount(); await screen.findByText('Ramesh'); fireEvent.change(screen.getByLabelText('Remarks for Ramesh'),{target:{value:'unsaved'}});
    expect(screen.getByLabelText('Employee Category')).toBeDisabled(); expect(screen.getByLabelText('Attendance Date')).toBeDisabled(); expect(screen.getAllByRole('button',{name:'Record Leave'})[0]).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Discard Changes'})); expect(screen.getByLabelText('Remarks for Ramesh')).toHaveValue(''); expect(screen.getByLabelText('Attendance Date')).toBeEnabled();
    api.populateAttendanceSheet.mockReturnValue(new Promise(()=>{})); fireEvent.click(screen.getByRole('button',{name:'Refresh Roster'})); await waitFor(()=>expect(screen.getByLabelText('Attendance Date')).toBeDisabled());
  });
  it('HO has no editing actions',async()=>{
    useAuth.mockReturnValue({user:{role:'ho'},loading:false}); mount(); await screen.findByText('Ramesh');
    expect(screen.queryByRole('button',{name:'Mark All Present'})).not.toBeInTheDocument(); expect(screen.getByLabelText('Entry for Ramesh')).toBeDisabled();
  });
  it.each(['je','zo','accounts'])('denies direct attendance navigation for %s before API reads',role=>{
    useAuth.mockReturnValue({user:{role},loading:false}); mount(); expect(screen.getByText('Dashboard destination')).toBeInTheDocument(); expect(api.loadAttendanceSheet).not.toHaveBeenCalled();
  });
  it('handles read failure and retry',async()=>{
    api.loadAttendanceSheet.mockRejectedValueOnce(new Error('unavailable')); mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load attendance');
    fireEvent.click(screen.getByRole('button',{name:'Retry'})); expect(await screen.findByText('Ramesh')).toBeInTheDocument();
  });
  it('preserves timestamps after a database rejection and permits retry',async()=>{
    data.rows[0].attendance_status='Present'; api.saveAttendanceRows.mockRejectedValue({response:{data:{message:'Exit timestamp must be after Entry'}}});
    mount(); await screen.findByText('Ramesh'); fireEvent.change(screen.getByLabelText('Entry for Ramesh'),{target:{value:'2026-09-30T08:00'}}); fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Exit timestamp must be after Entry'); expect(screen.getByLabelText('Entry for Ramesh')).toHaveValue('2026-09-30T08:00'); expect(screen.getByRole('button',{name:'Save Draft'})).toBeEnabled();
  });
  describe('Step 1 Ergonomics Acceptance Tests', () => {
    it('implements focus management, focus trapping, and focus restoration on the Leave Modal', async () => {
      mount();
      await screen.findByText('Ramesh');
      const recordBtn = screen.getAllByRole('button', { name: 'Record Leave' })[0];
      recordBtn.focus();
      expect(document.activeElement).toBe(recordBtn);

      fireEvent.click(recordBtn);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByTestId('modal-overlay-state')).toHaveTextContent('open');
      expect(dialog.parentElement).toBe(document.body.lastElementChild);
      expect(dialog).toHaveClass('max-h-[85vh]');
      expect(dialog).toHaveAttribute('aria-labelledby', 'factory-leave-modal-title');

      const fromDateInput = screen.getByLabelText(/From Date/);
      expect(document.activeElement).toBe(fromDateInput);

      // Focus trapping test: Tab on last button cycles back to first focusable element
      const saveBtn = screen.getByRole('button', { name: 'Save Leave' });
      saveBtn.focus();
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: false });
      const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
      expect(document.activeElement).toBe(closeBtn);

      // Shift-Tab on first focusable element cycles to last
      fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(saveBtn);

      // Close modal and verify focus restores to trigger button
      fireEvent.click(screen.getByRole('button', { name: 'Cancel Leave Entry' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(document.activeElement).toBe(recordBtn);
    });

    it('blocks Escape, backdrop click, and close button dismissal while save is pending', async () => {
      mount();
      await screen.findByText('Ramesh');
      fireEvent.click(screen.getAllByRole('button', { name: 'Record Leave' })[0]);

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toBeInTheDocument();

      let resolveSave;
      api.saveFactoryLeave.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));

      fireEvent.change(screen.getByLabelText(/Leave Reason/), { target: { value: 'Medical rest' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Leave' }));

      // Save is in flight
      await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();

      // Attempt Escape during save
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Attempt backdrop click during save
      fireEvent.click(dialog.parentElement);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Resolve save
      resolveSave({ data: { success: true } });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('protects modified leave-form values from accidental dismissal via Escape or backdrop', async () => {
      mount();
      await screen.findByText('Ramesh');
      fireEvent.click(screen.getAllByRole('button', { name: 'Record Leave' })[0]);

      const dialog = await screen.findByRole('dialog');
      fireEvent.change(screen.getByLabelText(/Leave Reason/), { target: { value: 'Entered notes' } });

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      // Attempt Escape -> cancel confirmation -> remains open
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(confirmSpy).toHaveBeenCalledWith('Discard unsaved leave entry?');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByLabelText(/Leave Reason/)).toHaveValue('Entered notes');

      // Attempt backdrop click -> confirm discard -> closes
      confirmSpy.mockReturnValue(true);
      fireEvent.click(dialog.parentElement);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      confirmSpy.mockRestore();
    });

    it('assigns opaque theme-aware sticky column classes and distinguishes marked vs entry-complete counts', async () => {
      mount();
      await screen.findByText('Ramesh');

      // Sticky column verification
      const headers = screen.getAllByRole('columnheader');
      expect(headers[0]).toHaveClass('sticky-col-opaque');
      expect(headers[0]).toHaveClass('sticky');
      expect(headers[0]).toHaveClass('left-0');
      expect(headers[0]).toHaveClass('z-20');

      const cells = screen.getAllByRole('cell');
      expect(cells[0]).toHaveClass('sticky-col-opaque');
      expect(cells[0]).toHaveClass('sticky');
      expect(cells[0]).toHaveClass('left-0');
      expect(cells[0]).toHaveClass('z-10');

      // Marked vs Entry Complete verification
      expect(screen.getByText('Saved OT Hours')).toBeInTheDocument();
      expect(screen.getByTestId('metric-total-roster')).toHaveTextContent('2');
      expect(screen.getByTestId('metric-marked-count')).toHaveTextContent('0 / 2');
      expect(screen.getByTestId('metric-complete-count')).toHaveTextContent('0 / 2');

      // Mark row Present without timestamps
      fireEvent.change(screen.getByLabelText('Status for Ramesh'), { target: { value: 'Present' } });
      expect(screen.getByTestId('metric-marked-count')).toHaveTextContent('1 / 2');
      expect(screen.getByTestId('metric-complete-count')).toHaveTextContent('0 / 2');

      // Stale hours warning while dirty
      expect(screen.getAllByText(/Save to recalculate hours/).length).toBeGreaterThan(0);

      // Enter timestamps
      fireEvent.change(screen.getByLabelText('Entry for Ramesh'), { target: { value: '2026-09-30T08:00' } });
      fireEvent.change(screen.getByLabelText('Exit for Ramesh'), { target: { value: '2026-09-30T20:00' } });

      // Entry Complete is now 1 / 2
      expect(screen.getByTestId('metric-marked-count')).toHaveTextContent('1 / 2');
      expect(screen.getByTestId('metric-complete-count')).toHaveTextContent('1 / 2');
    });
  });
});
