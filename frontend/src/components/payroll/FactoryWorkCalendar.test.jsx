import React from 'react';
import {test,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import FactoryWorkCalendar from './FactoryWorkCalendar';
import * as api from '../../api/payrollLedgerApi';
vi.mock('../../api/payrollLedgerApi');let user={id:'admin',role:'admin'};
vi.mock('../AuthContext',()=>({useAuth:()=>({user})}));
const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><FactoryWorkCalendar department="SNP Factory" onDepartmentChange={vi.fn()}/></QueryClientProvider>);
beforeEach(()=>{vi.resetAllMocks();user={id:'admin',role:'admin'};api.getFactoryCalendar.mockResolvedValue({data:{result:{version:0,schedule:null,days:[],changes:[]}}});api.saveFactoryCalendar.mockResolvedValue({data:{result:{}}});});
test('one setup date enables recurring Sundays without monthly publishing controls',async()=>{
 mount();await screen.findByText('Set up your working week');fireEvent.change(screen.getByLabelText(/Applies from/),{target:{value:'2026-08-01'}});fireEvent.click(screen.getByRole('button',{name:'Enable Sunday off'}));
 await waitFor(()=>expect(api.saveFactoryCalendar).toHaveBeenCalledWith({department:'SNP Factory',expected_version:0,action:'SCHEDULE',date:'2026-08-01',label:'Sunday weekly off'}));
 expect(await screen.findByText(/Calendar saved/)).toBeInTheDocument();expect(screen.queryByText(/Publish month/)).not.toBeInTheDocument();
});
test('holiday editor saves a dated exception with version and displays conflicts without closing',async()=>{
 api.getFactoryCalendar.mockResolvedValue({data:{result:{version:2,schedule:{applies_on:'2026-01-01'},days:[],changes:[]}}});api.saveFactoryCalendar.mockRejectedValue({response:{data:{message:'Calendar changed. Refresh and try again.'}}});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Add day off'}));fireEvent.change(screen.getByLabelText(/^Date/),{target:{value:'2026-11-08'}});fireEvent.change(screen.getByLabelText(/Holiday name/),{target:{value:'Diwali'}});fireEvent.click(screen.getByRole('button',{name:'Save date'}));
 await waitFor(()=>expect(api.saveFactoryCalendar).toHaveBeenCalledWith({department:'SNP Factory',expected_version:2,action:'DAY_OFF',date:'2026-11-08',label:'Diwali'}));expect(await screen.findByRole('alert')).toHaveTextContent('Calendar changed');expect(screen.getByRole('dialog')).toBeInTheDocument();
});
test('Accounts can read schedule without setup or date mutation actions',async()=>{user={id:'accounts',role:'accounts'};mount();expect(await screen.findByText('Ask Admin, HO or your Factory Manager to enable the calendar.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Enable Sunday off'})).not.toBeInTheDocument();});
test('read errors can be retried',async()=>{api.getFactoryCalendar.mockRejectedValueOnce(new Error('Calendar unavailable'));mount();expect(await screen.findByRole('alert')).toHaveTextContent('Calendar unavailable');fireEvent.click(screen.getByRole('button',{name:'Retry calendar'}));expect(await screen.findByText('Set up your working week')).toBeInTheDocument();});

test('Factory Manager can enable the calendar',async()=>{user={id:'fm',role:'factory_manager'};mount();await screen.findByText('Set up your working week');fireEvent.change(screen.getByLabelText(/Applies from/),{target:{value:'2026-08-01'}});expect(screen.getByRole('button',{name:'Enable Sunday off'})).toBeEnabled();});
