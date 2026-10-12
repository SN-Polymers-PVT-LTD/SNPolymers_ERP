import React,{useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Input,Select,Button,Pagination} from '../ui';
import {getBeneficiaries,getIndianBanks,upsertBeneficiary} from '../../api/acctRequisitionsApi';
const blank={beneficiary_name:'',account_number:'',ifsc:'',beneficiary_bank_id:''};
export default function EmployeeBeneficiary({value,record,onChange,onReady}){
 const client=useQueryClient(),[search,setSearch]=useState(''),[page,setPage]=useState(1),[draft,setDraft]=useState(blank),[dirty,setDirty]=useState(false);
 const list=useQuery({queryKey:['employee-beneficiaries',search,page],queryFn:async()=>(await getBeneficiaries({search,page,limit:20})).data});
 const banks=useQuery({queryKey:['employee-beneficiary-banks'],queryFn:async()=>(await getIndianBanks()).data.indianBanks});
 const [selected,setSelected]=useState(record);
 const save=useMutation({mutationFn:()=>upsertBeneficiary(draft),onSuccess:r=>{setSelected(r.data.beneficiary);onChange(r.data.beneficiary.id);setDraft(blank);setDirty(false);onReady(true);client.invalidateQueries({queryKey:['employee-beneficiaries']});},onError:()=>onReady(false)});
 const edit=(key,next)=>{setDraft(d=>({...d,[key]:next}));setDirty(true);onReady(false);save.reset();};
 const options=(list.data?.beneficiaries||[]).map(b=>({value:b.id,label:`${b.beneficiary_name} / ****${b.account_number.slice(-4)} / ${b.ifsc}`}));
 if(value&&!options.some(o=>o.value===value))options.push({value,label:selected?`${selected.beneficiary_name} / ****${selected.account_number.slice(-4)}`:`Saved beneficiary ${value}`});
 return <fieldset className="border border-slate-700 p-3 space-y-3"><legend>Employee beneficiary (optional)</legend><p>Reuse the Accounts beneficiary and bank masters. Missing details do not become invented payment details. Employee changes apply when you save the employee.</p>
 <Input label="Beneficiary search" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
 {list.isPending?<p role="status">Loading beneficiaries…</p>:list.isError?<p role="alert">Unable to load beneficiaries. <Button type="button" onClick={()=>list.refetch()}>Retry beneficiaries</Button></p>:<><Select label="Saved employee beneficiary" value={value||''} disabled={save.isPending} options={[{value:'',label:'No beneficiary recorded'},...options]} onChange={e=>{onChange(e.target.value||null);setSelected((list.data?.beneficiaries||[]).find(b=>b.id===e.target.value));setDraft(blank);setDirty(false);onReady(true);save.reset();}}/>{!(list.data?.beneficiaries||[]).length&&<p>No matching beneficiaries.</p>}<Pagination currentPage={page} totalPages={list.data?.pagination?.totalPages||1} onPageChange={setPage}/></>}
 <details><summary>Enter beneficiary details in the existing Accounts master</summary><p>Saving here creates or updates the shared Accounts master record for this account/IFSC. It does not record an advance, salary payment or bank transfer.</p>
 {['beneficiary_name','account_number','ifsc'].map(key=><Input key={key} label={`Employee beneficiary ${key.replaceAll('_',' ')}`} value={draft[key]} disabled={save.isPending} onChange={e=>edit(key,key==='ifsc'?e.target.value.toUpperCase():e.target.value)}/>)}
 {banks.isPending?<p>Loading banks…</p>:banks.isError?<p role="alert">Unable to load banks. <Button type="button" onClick={()=>banks.refetch()}>Retry banks</Button></p>:<Select label="Employee beneficiary bank" value={draft.beneficiary_bank_id} disabled={save.isPending} options={[{value:'',label:'Select active bank'},...(banks.data||[]).filter(b=>b.is_active).map(b=>({value:b.id,label:b.bank_name}))]} onChange={e=>edit('beneficiary_bank_id',e.target.value)}/>}
 <Button type="button" disabled={save.isPending||!draft.beneficiary_name.trim()||!/^\d{9,18}$/.test(draft.account_number)||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(draft.ifsc)||!draft.beneficiary_bank_id} onClick={()=>save.mutate()}>Save beneficiary and select</Button><Button type="button" disabled={save.isPending} onClick={()=>{setDraft(blank);setDirty(false);onReady(true);save.reset();}}>Discard beneficiary entry</Button>
 {dirty&&<p>Save or discard this beneficiary entry before saving the employee.</p>}{save.error&&<p role="alert">{save.error.response?.data?.message||save.error.message}</p>}
 </details></fieldset>;
}
