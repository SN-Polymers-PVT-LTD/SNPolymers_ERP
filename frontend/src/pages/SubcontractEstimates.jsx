import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSubcontractEstimates } from '../api/subcontractEstimatesApi';
import { Badge, Button, Pagination, Select, Table, TableBody, TableCell, TableHeader, TableRow } from '../components/ui';
import { useAuth } from '../components/AuthContext';

const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'Under ZO Review', label: 'Under ZO Review' },
  { value: 'ZO Revision Requested', label: 'ZO Revision Requested' },
  { value: 'ZO Approved', label: 'ZO Approved' },
  { value: 'Under HO Review', label: 'Under HO Review' },
  { value: 'HO Revision Requested', label: 'HO Revision Requested' },
  { value: 'Final Approved', label: 'Final Approved' },
  { value: 'Estimate Reopened', label: 'Estimate Reopened' },
  { value: 'Rejected by ZO', label: 'Rejected by ZO' },
  { value: 'Rejected by HO', label: 'Rejected by HO' }
];

const badgeVariant = status => {
  if (status === 'Final Approved') return 'emerald';
  if (status === 'Estimate Reopened' || status.includes('Revision')) return 'amber';
  if (status.includes('Review') || status === 'Submitted') return 'blue';
  if (status.startsWith('Rejected')) return 'red';
  return 'slate';
};

const getAction = (estimate, role) => {
  const status = estimate.estimate_status;
  if (['je', 'admin'].includes(role) && ['Draft', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'].includes(status)) {
    return { label: status === 'Draft' ? 'Edit' : 'Revise', path: `/subcontract-estimates/${estimate.subcontract_estimate_id}/edit` };
  }
  if ((role === 'zo' && ['Submitted', 'Under ZO Review'].includes(status)) || (role === 'ho' && ['ZO Approved', 'Under HO Review'].includes(status)) || (role === 'admin' && ['Submitted', 'Under ZO Review', 'ZO Approved', 'Under HO Review'].includes(status))) {
    return { label: 'Review', path: `/subcontract-estimates/${estimate.subcontract_estimate_id}` };
  }
  return { label: 'View', path: `/subcontract-estimates/${estimate.subcontract_estimate_id}` };
};

const SubcontractEstimates = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState({ estimates: [], pagination: {} });
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    getSubcontractEstimates({ page, limit: 20, ...(status ? { status } : {}) })
      .then(response => setData(response.data))
      .catch(e => setError(e.response?.data?.message || 'Failed to load subcontract estimates.'))
      .finally(() => setLoading(false));
  }, [page, status]);

  const canCreate = ['je', 'admin'].includes(user?.role);
  return <div className="space-y-6">
    <div className="flex flex-col gap-3 border-b border-white/5 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><span className="text-[10px] uppercase tracking-widest text-amber-500">Projects Module</span><h1 className="text-3xl font-extrabold text-slate-100">Subcontract Estimates</h1><p className="mt-1 text-xs text-slate-400">Work Order-specific subcontract scope and approval workflow.</p></div>
      {canCreate && <Button onClick={() => navigate('/subcontract-estimates/new')}>+ New Estimate</Button>}
    </div>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center"><Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} options={statusOptions} /><span className="text-xs text-slate-500">Showing {data.pagination.totalItems || 0} estimate(s)</span></div>
    {error && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>}
    <Table containerClassName="min-w-[900px]"><TableHeader><TableRow hover={false}><TableCell isHeader>Work Order</TableCell><TableCell isHeader>Status</TableCell><TableCell isHeader>Revision</TableCell><TableCell isHeader>Total</TableCell><TableCell isHeader>Updated</TableCell><TableCell isHeader>Action</TableCell></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={6}>Loading estimates…</TableCell></TableRow> : data.estimates.map(estimate => { const action = getAction(estimate, user?.role); return <TableRow key={estimate.subcontract_estimate_id}><TableCell className="font-mono text-slate-200">{estimate.work_order_no}</TableCell><TableCell><Badge variant={badgeVariant(estimate.estimate_status)}>{estimate.estimate_status}</Badge></TableCell><TableCell>{estimate.estimate_revision}</TableCell><TableCell>₹{Number(estimate.estimate_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</TableCell><TableCell>{estimate.updated_at ? new Date(estimate.updated_at).toLocaleDateString('en-IN') : '—'}</TableCell><TableCell><Button size="sm" variant="secondary" onClick={() => navigate(action.path)}>{action.label}</Button></TableCell></TableRow>; })}{!loading && !data.estimates.length && <TableRow><TableCell colSpan={6}>No subcontract estimates match this filter.</TableCell></TableRow>}</TableBody></Table>
    <Pagination currentPage={page} totalPages={data.pagination.totalPages || 1} totalRecords={data.pagination.totalItems || 0} showLabel onPageChange={setPage} />
  </div>;
};

export default SubcontractEstimates;
