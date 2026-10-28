import React,{useState} from 'react';
import {beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import EmployeeBeneficiary from './EmployeeBeneficiary';
import * as api from '../../api/acctRequisitionsApi';
vi.mock('../../api/acctRequisitionsApi');
const bank='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const record={id,beneficiary_name:'Synthetic employee',account_number:'123456789012',ifsc:'TEST0000001',beneficiary_bank_id:bank};
const ready=vi.fn(),changed=vi.fn();
function Harness({existing}){const [value,setValue]=useState(existing?.id||null);return <EmployeeBeneficiary record={existing} value={value} onChange={v=>{setValue(v);changed(v);}} onReady={ready}/>;}
const mount=(existing)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><Harness existing={existing}/></QueryClientProvider>);
beforeEach(()=>{vi.resetAllMocks();api.getBeneficiaries.mockResolvedValue({data:{beneficiaries:[record],pagination:{totalPages:1}}});api.getIndianBanks.mockResolvedValue({data:{indianBanks:[{id:bank,bank_name:'Synthetic bank',is_active:true}]}});api.upsertBeneficiary.mockResolvedValue({data:{beneficiary:record}});});
it('shows linked details without a beneficiary directory and clears only the employee link',async()=>{
 mount(record);expect(await screen.findByLabelText('Bank')).toHaveValue(bank);expect(screen.getByLabelText('Account number')).toHaveValue(record.account_number);
 expect(screen.queryByLabelText('Beneficiary search')).not.toBeInTheDocument();expect(screen.queryByLabelText('Saved employee beneficiary')).not.toBeInTheDocument();expect(api.getBeneficiaries).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Remove beneficiary link'}));expect(changed).toHaveBeenLastCalledWith(null);expect(screen.getByLabelText('Account number')).toHaveValue('');expect(api.upsertBeneficiary).not.toHaveBeenCalled();
});
it('saves explicit bank details through the existing Accounts API and only then allows employee save',async()=>{
 mount();await screen.findByLabelText('Bank');for(const [label,value] of [['Beneficiary name',record.beneficiary_name],['Account number',record.account_number],['IFSC','test0000001'],['Bank',bank]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 expect(ready).toHaveBeenLastCalledWith(false);fireEvent.click(screen.getByRole('button',{name:'Save beneficiary'}));await waitFor(()=>expect(changed).toHaveBeenCalledWith(id));expect(api.upsertBeneficiary).toHaveBeenCalledWith({beneficiary_name:record.beneficiary_name,account_number:record.account_number,ifsc:record.ifsc,beneficiary_bank_id:bank});expect(ready).toHaveBeenLastCalledWith(true);
});
it('keeps unsaved input on an Accounts error; discarding makes employee save safe again',async()=>{
 api.upsertBeneficiary.mockRejectedValue(new Error('Beneficiary save failed'));mount();await screen.findByLabelText('Bank');for(const [label,value] of [['Beneficiary name',record.beneficiary_name],['Account number',record.account_number],['IFSC',record.ifsc],['Bank',bank]])fireEvent.change(screen.getByLabelText(label),{target:{value}});fireEvent.click(screen.getByRole('button',{name:'Save beneficiary'}));expect(await screen.findByRole('alert')).toHaveTextContent('Beneficiary save failed');expect(changed).not.toHaveBeenCalled();expect(screen.getByLabelText('Account number')).toHaveValue(record.account_number);fireEvent.click(screen.getByRole('button',{name:'Discard changes'}));expect(ready).toHaveBeenLastCalledWith(true);
});
