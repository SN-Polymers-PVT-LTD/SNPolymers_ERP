import React,{useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {Input,Select,Button} from '../ui';
import {getStatutoryStates,registerStatutoryState} from '../../api/payrollProfilesApi';
export default function StatutoryStateField({data,onChange}){
 const client=useQueryClient(),[adding,setAdding]=useState(false),[name,setName]=useState('');
 const states=useQuery({queryKey:['payroll-statutory-states'],queryFn:async()=>(await getStatutoryStates()).data.result});
 const choose=state=>onChange({...data,state_id:state.id,jurisdiction:state.name});
 const save=useMutation({mutationFn:()=>registerStatutoryState({name:name.trim()}),onSuccess:r=>{client.setQueryData(['payroll-statutory-states'],old=>[...(old||[]).filter(s=>s.id!==r.data.result.id),r.data.result].sort((a,b)=>a.name.localeCompare(b.name)));choose(r.data.result);setAdding(false);setName('');}});
 const list=states.data||[],selected=list.find(s=>s.id===data.state_id)||list.find(s=>s.name.toLowerCase()===data.jurisdiction.toLowerCase());
 return <div className="space-y-3"><div className="flex items-end gap-3"><Select label="Jurisdiction / state" required value={selected?.id||''} disabled={states.isPending||save.isPending} options={[{value:'',label:states.isPending?'Loading states…':'Select state'},...list.map(s=>({value:s.id,label:s.name}))]} onChange={e=>{const s=list.find(s=>s.id===e.target.value);if(s)choose(s);else onChange({...data,state_id:null,jurisdiction:''});}}/><Button type="button" variant="secondary" disabled={save.isPending} onClick={()=>setAdding(true)}>Add state</Button></div>
 {data.jurisdiction&&!selected&&!states.isPending&&<p className="text-xs">Saved jurisdiction: {data.jurisdiction}. Select a saved state for this draft; historical revisions are preserved.</p>}
 {states.isError&&<p role="alert">Unable to load states. <Button type="button" onClick={()=>states.refetch()}>Retry states</Button></p>}
 {adding&&<div className="rounded-xl border border-white/10 p-3 space-y-2"><Input label="New state name" value={name} maxLength={120} onChange={e=>setName(e.target.value)}/><Button type="button" disabled={!name.trim()||save.isPending} onClick={()=>save.mutate()}>Save state</Button><Button type="button" variant="ghost" disabled={save.isPending} onClick={()=>{setAdding(false);setName('');save.reset();}}>Cancel adding state</Button>{save.error&&<p role="alert">{save.error.response?.data?.message||save.error.message}</p>}</div>}
 </div>;
}
