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
function Harness(){const [value,setValue]=useState(null);return <EmployeeBeneficiary value={value} onChange={v=>{setValue(v);changed(v);}} onReady={ready}/>;}
const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><Harness/></QueryClientProvider>);
beforeEach(()=>{vi.resetAllMocks();api.getBeneficiaries.mockResolvedValue({data:{beneficiaries:[record],pagination:{totalPages:1}}});api.getIndianBanks.mockResolvedValue({data:{indianBanks:[{id:bank,bank_name:'Synthetic bank',is_active:true}]}});api.upsertBeneficiary.mockResolvedValue({data:{beneficiary:record}});});
it('selects and clears a canonical saved beneficiary without upserting or exposing full accounts in choices',async()=>{
 mount();const select=await screen.findByLabelText('Saved employee beneficiary');expect(select).not.toHaveTextContent(record.account_number);fireEvent.change(select,{target:{value:id}});expect(changed).toHaveBeenCalledWith(id);fireEvent.change(select,{target:{value:''}});expect(changed).toHaveBeenLastCalledWith(null);expect(api.upsertBeneficiary).not.toHaveBeenCalled();
});
it('saves explicit bank details through the existing Accounts API and only then allows employee save',async()=>{
 mount();await screen.findByLabelText('Employee beneficiary bank');for(const [label,value] of [['Employee beneficiary beneficiary name',record.beneficiary_name],['Employee beneficiary account number',record.account_number],['Employee beneficiary ifsc','test0000001'],['Employee beneficiary bank',bank]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 expect(ready).toHaveBeenLastCalledWith(false);fireEvent.click(screen.getByRole('button',{name:'Save beneficiary and select'}));await waitFor(()=>expect(changed).toHaveBeenCalledWith(id));expect(api.upsertBeneficiary).toHaveBeenCalledWith({beneficiary_name:record.beneficiary_name,account_number:record.account_number,ifsc:record.ifsc,beneficiary_bank_id:bank});expect(ready).toHaveBeenLastCalledWith(true);
});
it('keeps unsaved input on an Accounts error; discarding makes employee save safe again',async()=>{
 api.upsertBeneficiary.mockRejectedValue(new Error('Beneficiary save failed'));mount();await screen.findByLabelText('Employee beneficiary bank');for(const [label,value] of [['Employee beneficiary beneficiary name',record.beneficiary_name],['Employee beneficiary account number',record.account_number],['Employee beneficiary ifsc',record.ifsc],['Employee beneficiary bank',bank]])fireEvent.change(screen.getByLabelText(label),{target:{value}});fireEvent.click(screen.getByRole('button',{name:'Save beneficiary and select'}));expect(await screen.findByRole('alert')).toHaveTextContent('Beneficiary save failed');expect(changed).not.toHaveBeenCalled();expect(screen.getByLabelText('Employee beneficiary account number')).toHaveValue(record.account_number);fireEvent.click(screen.getByRole('button',{name:'Discard beneficiary entry'}));expect(ready).toHaveBeenLastCalledWith(true);
});
