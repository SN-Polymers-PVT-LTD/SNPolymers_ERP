import React,{useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '../AuthContext';
import {Input,Select,Button,Pagination} from '../ui';
import {getStatutoryProfileContext,registerStatutoryScope,bindStatutoryScope} from '../../api/payrollProfilesApi';
const message=e=>e?.response?.data?.message||e.message;
export default function StatutoryScopeManager(){
 const {user}=useAuth(),client=useQueryClient();const allowed=['admin','accounts'].includes(user?.role);
 const [scopeSearch,setScopeSearch]=useState(''),[scopePage,setScopePage]=useState(1);
 const [scopeDraft,setScopeDraft]=useState({jurisdiction_code:'',establishment_code:'',evidence_reference:''});
 const [binding,setBinding]=useState({revision_id:'',statutory_scope_id:'',evidence_reference:''});
 const context=useQuery({queryKey:['statutory-profile-scopes',user?.id,scopeSearch,scopePage],enabled:allowed,queryFn:async()=>(await getStatutoryProfileContext({search:scopeSearch,page:scopePage,limit:20})).data.result});
 const refresh=()=>{client.invalidateQueries({queryKey:['statutory-profile-scopes']});client.invalidateQueries({queryKey:['statutory-profile-history']});};
 const register=useMutation({mutationFn:()=>registerStatutoryScope(scopeDraft),onSuccess:()=>{setScopeDraft({jurisdiction_code:'',establishment_code:'',evidence_reference:''});refresh();}});
 const bind=useMutation({mutationFn:()=>bindStatutoryScope(binding),onSuccess:()=>{setBinding({revision_id:'',statutory_scope_id:'',evidence_reference:''});refresh();}});
 const scopeOptions=value=>[{value:'',label:'Select state / establishment mapping'},...(context.data?.scopes||[]).map(s=>({value:s.id,label:`${s.jurisdiction_code} / ${s.establishment_code}`})),...((value&&!(context.data?.scopes||[]).some(s=>s.id===value))?[{value,label:`Recorded mapping: ${value}`}]:[])];
 const busy=register.isPending||bind.isPending;
 if(!allowed)return null;
 return <section aria-label="State and establishment mappings">
 {[register.error,bind.error].filter(Boolean).map((e,i)=><p key={i} role="alert">{message(e)}</p>)}
      {/* 3. Canonical Scopes Registry & Binding */}
      <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-6 shadow-xl">
        <div className="flex items-center gap-2 text-indigo-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-200">State / Establishment Mappings & Master Bindings</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <Input label="Canonical scope search" value={scopeSearch} onChange={e => { setScopeSearch(e.target.value); setScopePage(1); }} />
          {context.isPending ? (
            <p role="status" className="text-xs text-slate-400 py-3">Loading canonical scopes…</p>
          ) : context.isError ? (
            <div role="alert" className="text-xs text-red-400 flex items-center gap-3 py-2">
              <span>{message(context.error)}</span>
              <Button size="sm" variant="secondary" onClick={() => context.refetch()}>Retry canonical scopes</Button>
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-3">{context.data.total} canonical scopes. Codes and assignments require documentary evidence; display labels are not identifiers.</p>
          )}
        </div>

        {!context.isPending && !context.isError && context.data && (
          <div className="space-y-4">
            <Pagination currentPage={scopePage} totalPages={Math.max(1, Math.ceil(context.data.total / 20))} onPageChange={setScopePage} />
            <details className="group rounded-2xl border border-white/5 bg-black/20 overflow-hidden transition-all duration-200">
              <summary className="p-4 cursor-pointer text-xs font-bold uppercase tracking-wider text-slate-300 hover:text-indigo-400 flex items-center justify-between">
                <span>Canonical scope registrations and bindings</span>
                <span className="text-slate-500 group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="p-4 border-t border-white/5 bg-slate-950/60 overflow-x-auto">
                <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap">{JSON.stringify(context.data, null, 2)}</pre>
              </div>
            </details>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/5">
          {/* Register Scope Card */}
          <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-4 bg-white/[0.01]">
            <div>
              <h4 className="text-xs uppercase font-extrabold tracking-wider text-amber-400">Register an evidenced canonical scope</h4>
              <p className="text-[11px] text-slate-400 mt-1">Use approved registry codes (uppercase letters/digits/_/-). No mapping from free-text master labels is inferred.</p>
            </div>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); register.mutate(); }}>
              {['jurisdiction_code', 'establishment_code', 'evidence_reference'].map(key => (
                <Input
                  key={key}
                  label={`Scope ${key === 'advisor_name' ? 'setup confirmed by' : key.replaceAll('_', ' ')}`}
                  required
                  value={scopeDraft[key]}
                  onChange={e => setScopeDraft(d => ({ ...d, [key]: e.target.value }))}
                />
              ))}
              <Button type="submit" variant="amber" disabled={busy}>Register canonical scope</Button>
            </form>
          </div>

          {/* Bind Scope Card */}
          <div className="glass-panel p-5 rounded-2xl border border-white/5 space-y-4 bg-white/[0.01]">
            <div>
              <h4 className="text-xs uppercase font-extrabold tracking-wider text-sky-400">Bind a published statutory revision explicitly</h4>
              <p className="text-[11px] text-slate-400 mt-1">Copy the verified published revision ID from the existing statutory master. Bindings are immutable; ambiguity and overlapping mappings are rejected.</p>
            </div>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); bind.mutate(); }}>
              <Input label="Published statutory revision ID" required value={binding.revision_id} onChange={e => setBinding(b => ({ ...b, revision_id: e.target.value }))} />
              <Select label="Binding canonical scope" required value={binding.statutory_scope_id} options={scopeOptions(binding.statutory_scope_id)} onChange={e => setBinding(b => ({ ...b, statutory_scope_id: e.target.value }))} />
              <Input label="Binding evidence reference" required value={binding.evidence_reference} onChange={e => setBinding(b => ({ ...b, evidence_reference: e.target.value }))} />
              <Button type="submit" variant="primary" disabled={busy}>Bind published revision</Button>
            </form>
          </div>
        </div>
      </div>
</section>;
}
