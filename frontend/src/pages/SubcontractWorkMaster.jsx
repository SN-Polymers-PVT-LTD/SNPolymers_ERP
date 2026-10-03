import { useEffect, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../components/ui';
import { getSubcontractWorks, createSubcontractWork, updateSubcontractWork, updateSubcontractWorkStatus } from '../api/subcontractMastersApi';

const SubcontractWorkMaster = () => {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const canCreate = admin || user?.role === 'je';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(admin ? '' : 'true');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ sub_head: '', material_details: '', unit: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1); }, 400); return () => clearTimeout(t); }, [search]);
  const { data, isLoading } = useQuery({
    queryKey: ['subcontractWorks', { page, search: debounced, is_active: active }],
    queryFn: async () => (await getSubcontractWorks({ page, limit: 10, search: debounced, is_active: active })).data
  });
  const works = data?.subcontractWorks || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, totalItems: 0 };
  const close = () => setModal(null);
  const save = async (event) => {
    event.preventDefault(); setError(''); setMessage('');
    try {
      if (modal.mode === 'create') await createSubcontractWork(form);
      else await updateSubcontractWork(modal.id, form);
      queryClient.invalidateQueries({ queryKey: ['subcontractWorks'] }); setMessage('Subcontract work saved.'); close();
    } catch (e) { setError(e.response?.data?.message || 'Unable to save subcontract work.'); }
  };
  const toggle = async (row) => { try { await updateSubcontractWorkStatus(row.id, !row.is_active); queryClient.invalidateQueries({ queryKey: ['subcontractWorks'] }); } catch (e) { setError(e.response?.data?.message || 'Unable to update status.'); } };
  return <div className="p-4 sm:p-6 space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3"><div><p className="text-xs tracking-widest text-indigo-300">PROJECTS · MASTER DATA</p><h1 className="text-2xl font-bold text-white">Subcontract Work Master</h1><p className="text-sm text-slate-400">Reusable subcontract work definitions used across Work Orders.</p></div>{canCreate && <Button onClick={() => { setForm({ sub_head: '', material_details: '', unit: '' }); setModal({ mode: 'create' }); }}>+ Add Work</Button>}</div>
    {message && <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</div>}{error && <div className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
    <div className="flex flex-col sm:flex-row gap-3"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search work..." />{admin && <select className="rounded-lg bg-slate-900 border border-white/10 px-3 text-sm text-white" value={active} onChange={e => { setActive(e.target.value); setPage(1); }}><option value="">All status</option><option value="true">Active</option><option value="false">Inactive</option></select>}</div>
    <div className="overflow-x-auto rounded-xl border border-white/10"><table className="min-w-full text-sm"><thead className="bg-white/5 text-left text-slate-400"><tr><th className="p-3">Sub Head</th><th className="p-3">Work Details</th><th className="p-3">Unit</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead><tbody>{isLoading ? <tr><td className="p-5 text-slate-400" colSpan="5">Loading...</td></tr> : works.map(row => <tr className="border-t border-white/5" key={row.id}><td className="p-3 text-white">{row.sub_head}</td><td className="p-3 text-slate-300">{row.material_details}</td><td className="p-3 text-slate-300">{row.unit}</td><td className="p-3"><span className={row.is_active ? 'text-emerald-300' : 'text-slate-500'}>{row.is_active ? 'Active' : 'Inactive'}</span></td><td className="p-3">{admin && <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { setForm({ sub_head: row.sub_head, material_details: row.material_details, unit: row.unit }); setModal({ mode: 'edit', id: row.id }); }}>Edit</Button><Button size="sm" variant="ghost" onClick={() => toggle(row)}>{row.is_active ? 'Deactivate' : 'Activate'}</Button></div>}</td></tr>)}</tbody></table></div>
    <div className="flex items-center justify-between text-sm text-slate-400"><span>{pagination.totalItems} records</span><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span className="px-2 py-2">{page} / {pagination.totalPages}</span><Button size="sm" variant="secondary" disabled={page >= pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button></div></div>
    {modal && <Modal isOpen onClose={close} title={modal.mode === 'create' ? 'Add Subcontract Work' : 'Edit Subcontract Work'}><form className="space-y-4" onSubmit={save}><Input label="Sub Head" value={form.sub_head} onChange={e => setForm({ ...form, sub_head: e.target.value })} required /><Input label="Work Details" value={form.material_details} onChange={e => setForm({ ...form, material_details: e.target.value })} required /><Input label="Unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} required /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit">Save</Button></div></form></Modal>}
  </div>;
};
export default SubcontractWorkMaster;
