import React from 'react';
import { beforeEach,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import DailyAttendance from './DailyAttendance';
import authApi from '../../api/authApi';
vi.mock('../../components/AuthContext',()=>({useAuth:()=>({user:{role:'factory_manager'}})}));
// Exercise the real attendance API wrappers with a transport matching the HTTP contract.
// The same request/response shapes are covered against PostgreSQL in hrAttendanceApi.test.js.
vi.mock('../../api/authApi',()=>({default:{get:vi.fn(),post:vi.fn(),put:vi.fn()}}));
const category='Local Daily-Wage Workers';
let data;
beforeEach(()=>{
  vi.resetAllMocks();
  data={success:true,sheet:{id:'sheet-id',status:'Draft',submission_count:0},rows:[{id:'row-id',employee_id:'employee-id',employee:{employee_name:'Local Worker',employee_code:'EMP-1',active_status:'Active'},attendance_status:'Present',entry_timestamp:null,exit_timestamp:null,duty_type:null,holiday_pay_eligible:false,actual_hours:0,ot_hours:0,remarks:null}]};
  authApi.get.mockImplementation(async(path)=>{expect(path).toBe('/hr/attendance/sheet');return {data:structuredClone(data)};});
  authApi.put.mockImplementation(async(path,body)=>{
    expect(path).toBe('/hr/attendance/sheets/sheet-id/rows'); expect(body.rows).toHaveLength(1);
    Object.assign(data.rows[0],body.rows[0],{actual_hours:24,ot_hours:0});return {data:{success:true,rows:structuredClone(data.rows)}};
  });
  authApi.post.mockImplementation(async(path,body)=>{
    expect(path).toBe('/hr/attendance/sheets/sheet-id/submit');expect(body).toEqual({});data.sheet.status='Submitted';data.sheet.submission_count=1;return {data:{success:true,sheet:{...data.sheet}}};
  });
});
function mount(){render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={[`/factory-attendance?date=2026-09-30&category=${encodeURIComponent(category)}`]}><DailyAttendance /></MemoryRouter></QueryClientProvider>);}
it('UI → real API wrapper → response reload: 24-hour Double Duty saves zero OT then submits read-only',async()=>{
  mount();await screen.findByText('Local Worker');
  expect(authApi.get).toHaveBeenCalledWith('/hr/attendance/sheet',{params:{date:'2026-09-30',employee_category:category}});
  fireEvent.change(screen.getByLabelText('Entry for Local Worker'),{target:{value:'2026-09-30T08:00'}});
  fireEvent.change(screen.getByLabelText('Exit for Local Worker'),{target:{value:'2026-10-01T08:00'}});
  fireEvent.change(screen.getByLabelText('Duty for Local Worker'),{target:{value:'Double Duty'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
  expect(await screen.findByText('24.00')).toBeInTheDocument();expect(screen.getByText('0.00')).toBeInTheDocument();
  expect(authApi.put).toHaveBeenCalledWith('/hr/attendance/sheets/sheet-id/rows',{rows:[{employee_id:'employee-id',entry_timestamp:'2026-09-30T08:00:00+05:30',exit_timestamp:'2026-10-01T08:00:00+05:30',duty_type:'Double Duty'}]});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Submit to HO'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Submit to HO'}));
  expect(await screen.findByText('Submitted to HO.')).toBeInTheDocument();expect(screen.getByLabelText('Duty for Local Worker')).toBeDisabled();
});
it('real wrapper propagates stable 409 rejection to UI while keeping its unsaved values',async()=>{
  authApi.put.mockRejectedValue({response:{status:409,data:{success:false,code:'ATTENDANCE_CONFLICT',message:'Sheet is not editable'}}});
  mount();await screen.findByText('Local Worker');fireEvent.change(screen.getByLabelText('Remarks for Local Worker'),{target:{value:'Keep this correction'}});fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sheet is not editable');expect(screen.getByLabelText('Remarks for Local Worker')).toHaveValue('Keep this correction');
});
