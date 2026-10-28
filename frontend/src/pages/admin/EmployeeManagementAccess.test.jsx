import React from 'react';
import {it,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';
import EmployeeManagement from './EmployeeManagement';
let role='admin';vi.mock('../../components/AuthContext',()=>({useAuth:()=>({user:{id:role,role}})}));
vi.mock('./EmployeeMaster',()=>({default:({onNavigateToPayStructure})=><button onClick={()=>onNavigateToPayStructure('employee-42')}>Directory employee pay structure</button>}));
vi.mock('./PermanentPayStructure',()=>({default:()=> <p>Admin pay editor</p>}));
vi.mock('../../components/payroll/EmployeeStatutorySetup',()=>({default:({initialEmployeeId})=><p>Employee setup for {initialEmployeeId||'all employees'}</p>}));
function Location(){const l=useLocation();return <output data-testid="url">{l.pathname+l.search}</output>;}
function mount(url='/admin/employee-management'){return render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/admin/employee-management" element={<><EmployeeManagement/><Location/></>}/></Routes></MemoryRouter>);}
beforeEach(()=>{role='admin';});
it('Admin opens pay structure from an employee and preserves the selected identity',()=>{mount();fireEvent.click(screen.getByRole('button',{name:'Directory employee pay structure'}));expect(screen.getByText('Admin pay editor')).toBeInTheDocument();expect(screen.getByTestId('url')).toHaveTextContent('tab=pay-structure&employeeId=employee-42');});
it.each(['directory','pay-structure'])('Accounts %s deep links expose only employee payroll setup',tab=>{role='accounts';mount('/admin/employee-management?tab='+tab+'&employeeId=employee-42');expect(screen.getByText('Employee setup for employee-42')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Export Both Sheets'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Directory employee pay structure'})).not.toBeInTheDocument();expect(screen.queryByText('Admin pay editor')).not.toBeInTheDocument();});
it.each(['ho','factory_manager','je','zo'])('denies %s without rendering any employee editor',denied=>{role=denied;mount();expect(screen.getByRole('alert')).toHaveTextContent('Accounts or Admin');expect(screen.queryByText('Admin pay editor')).not.toBeInTheDocument();expect(screen.queryByText('Employee setup for all employees')).not.toBeInTheDocument();});
it('Admin retains pay setup without the Accounts payroll setup tab',()=>{mount('/admin/employee-management?tab=pay-structure');expect(screen.getByText('Admin pay editor')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Employee Payroll Setup'})).not.toBeInTheDocument();});
it('Admin payroll-setup deep link cannot expose Accounts deduction setup',()=>{mount('/admin/employee-management?tab=payroll-setup&employeeId=employee-42');expect(screen.getByRole('alert')).toHaveTextContent('Accounts only');expect(screen.queryByText('Employee setup for employee-42')).not.toBeInTheDocument();});
