import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Table, TableHeader, TableBody, TableRow, TableCell, Pagination, Badge } from '../components/ui';
import {
  getSubcontractors,
  createSubcontractor,
  updateSubcontractor,
  updateSubcontractorStatus,
  getSubcontractWorks
} from '../api/subcontractMastersApi';

export default function SubcontractorMaster() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const canCreate = admin || user?.role === 'je';
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [active, setActive] = useState(admin ? '' : 'true');
  const [modal, setModal] = useState(null); // 'create' | 'edit' | null
  const [editingSubcontractor, setEditingSubcontractor] = useState(null);
  const [name, setName] = useState('');
  const [selectedWorkIds, setSelectedWorkIds] = useState([]);
  const [workSearch, setWorkSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['subcontractors', { page, search: debounced, is_active: active }],
    queryFn: async () => (await getSubcontractors({ page, limit: 10, search: debounced, is_active: active })).data
  });

  const { data: workData } = useQuery({
    queryKey: ['subcontractWorks', 'all-active'],
    queryFn: async () => (await getSubcontractWorks({ page: 1, limit: 1000, is_active: 'true' })).data
  });

  const rows = data?.subcontractors || [];
  const pagination = data?.pagination || { totalPages: 1, totalItems: 0 };
  const allWorks = workData?.subcontractWorks || [];

  const filteredWorks = useMemo(() => {
    if (!workSearch.trim()) return allWorks;
    const q = workSearch.toLowerCase();
    return allWorks.filter(w =>
      w.sub_head?.toLowerCase().includes(q) ||
      w.material_details?.toLowerCase().includes(q) ||
      w.unit?.toLowerCase().includes(q)
    );
  }, [allWorks, workSearch]);

  const openCreate = () => {
    setError('');
    setName('');
    setSelectedWorkIds([]);
    setWorkSearch('');
    setEditingSubcontractor(null);
    setModal('create');
  };

  const openEdit = (subcontractor) => {
    setError('');
    setName(subcontractor.subcontractor_name || '');
    const currentWorkIds = (subcontractor.capabilities || []).map(c => c.subcontract_work_id);
    setSelectedWorkIds(currentWorkIds);
    setWorkSearch('');
    setEditingSubcontractor(subcontractor);
    setModal('edit');
  };

  const toggleWorkSelection = (workId) => {
    setSelectedWorkIds(prev =>
      prev.includes(workId) ? prev.filter(id => id !== workId) : [...prev, workId]
    );
  };

  const selectAllFilteredWorks = () => {
    const idsToAdd = filteredWorks.map(w => w.id);
    setSelectedWorkIds(prev => Array.from(new Set([...prev, ...idsToAdd])));
  };

  const deselectAllFilteredWorks = () => {
    const idsToRemove = new Set(filteredWorks.map(w => w.id));
    setSelectedWorkIds(prev => prev.filter(id => !idsToRemove.has(id)));
  };

  const save = async event => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Subcontractor name is required.');
      return;
    }
    setError('');
    try {
      if (modal === 'create') {
        await createSubcontractor({
          subcontractor_name: name.trim(),
          work_ids: selectedWorkIds
        });
        setMessage('Subcontractor created successfully with assigned work types.');
      } else if (modal === 'edit' && editingSubcontractor) {
        await updateSubcontractor(editingSubcontractor.id, {
          subcontractor_name: name.trim(),
          work_ids: selectedWorkIds
        });
        setMessage('Subcontractor updated successfully.');
      }
      qc.invalidateQueries({ queryKey: ['subcontractors'] });
      setModal(null);
    } catch (e) {
      setError(e.response?.data?.message || 'Unable to save record.');
    }
  };

  const toggleStatus = async row => {
    try {
      await updateSubcontractorStatus(row.id, !row.is_active);
      qc.invalidateQueries({ queryKey: ['subcontractors'] });
    } catch (e) {
      setError(e.response?.data?.message || 'Unable to update status.');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-indigo-300 font-semibold uppercase">PROJECTS · MASTER DATA</p>
          <h1 className="text-2xl font-bold text-white tracking-tight">Subcontractor Master</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Global repository of verified contractors and the canonical work types they are qualified to perform.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openCreate} className="shrink-0">
            + Add Subcontractor
          </Button>
        )}
      </div>

      {message && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3.5 text-sm text-emerald-300 flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-emerald-400 hover:text-white text-xs">Dismiss</button>
        </div>
      )}
      {error && !modal && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3.5 text-sm text-rose-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-white text-xs">Dismiss</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by contractor name or work type..."
          />
        </div>
        {admin && (
          <select
            className="rounded-xl bg-slate-900 border border-white/10 px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            value={active}
            onChange={e => { setActive(e.target.value); setPage(1); }}
          >
            <option value="">All Statuses</option>
            <option value="true">Active Only</option>
            <option value="false">Inactive Only</option>
          </select>
        )}
      </div>

      <Table containerClassName="min-w-[900px]">
        <TableHeader>
          <TableRow hover={false}>
            <TableCell isHeader className="w-1/4">Subcontractor</TableCell>
            <TableCell isHeader className="w-1/2">Work Types</TableCell>
            <TableCell isHeader className="w-1/8 text-center">Status</TableCell>
            <TableCell isHeader className="w-1/8 text-right">Actions</TableCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-10 text-slate-400">Loading contractors...</TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center py-10 text-slate-400">
                No subcontractors found.
              </TableCell>
            </TableRow>
          ) : (
            rows.map(row => {
              const capabilities = row.capabilities || [];
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <div className="font-semibold text-white text-base">{row.subcontractor_name}</div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">ID: {row.id.slice(0, 8)}</div>
                  </TableCell>
                  <TableCell>
                    {capabilities.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 py-1">
                        {capabilities.map(cap => (
                          <span
                            key={cap.capability_id || cap.subcontract_work_id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-xs text-indigo-200"
                            title={`${cap.subcontract_work?.sub_head} · ${cap.subcontract_work?.material_details} (${cap.subcontract_work?.unit})`}
                          >
                            <span className="font-medium text-slate-300">{cap.subcontract_work?.sub_head}:</span>
                            <span className="text-white">{cap.subcontract_work?.material_details}</span>
                            <span className="text-[10px] text-indigo-400 font-mono">({cap.subcontract_work?.unit})</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-amber-400/80 text-xs italic bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/20">
                        No work types configured
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={row.is_active ? 'success' : 'slate'} className="text-xs">
                      {row.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2 items-center">
                      {canCreate && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openEdit(row)}
                          className="text-xs"
                        >
                          Edit
                        </Button>
                      )}
                      {admin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleStatus(row)}
                          className={`text-xs ${row.is_active ? 'text-rose-400 hover:text-rose-300' : 'text-emerald-400 hover:text-emerald-300'}`}
                        >
                          {row.is_active ? 'Deactivate' : 'Activate'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <Pagination currentPage={page} totalPages={pagination.totalPages} onPageChange={setPage} />

      {modal && (
        <Modal
          isOpen
          onClose={() => setModal(null)}
          title={modal === 'create' ? 'Add Subcontractor' : 'Edit Subcontractor & Work Types'}
          size="lg"
        >
          <form className="space-y-4" onSubmit={save}>
            <Input
              label="Subcontractor Name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter subcontractor business or individual legal name"
              required
            />

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Qualified Work Types ({selectedWorkIds.length} selected)
                </label>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={selectAllFilteredWorks}
                    className="text-indigo-400 hover:text-indigo-300 transition"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">|</span>
                  <button
                    type="button"
                    onClick={deselectAllFilteredWorks}
                    className="text-slate-400 hover:text-slate-300 transition"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="mb-2">
                <input
                  type="text"
                  placeholder="Filter available work types..."
                  value={workSearch}
                  onChange={e => setWorkSearch(e.target.value)}
                  className="w-full rounded-lg bg-slate-900/90 border border-white/10 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="border border-white/10 rounded-xl bg-slate-950/60 max-h-60 overflow-y-auto divide-y divide-white/5 p-1">
                {filteredWorks.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No matching work types found in Work Master.
                  </div>
                ) : (
                  filteredWorks.map(work => {
                    const isChecked = selectedWorkIds.includes(work.id);
                    return (
                      <label
                        key={work.id}
                        className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition select-none ${
                          isChecked ? 'bg-indigo-500/10 hover:bg-indigo-500/15' : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleWorkSelection(work.id)}
                          className="mt-0.5 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                        />
                        <div className="flex-1 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{work.material_details}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                              {work.unit}
                            </span>
                          </div>
                          <p className="text-[11px] text-indigo-300/80 mt-0.5 font-medium">
                            Sub Head: {work.sub_head}
                          </p>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                Work types determine which subcontract scopes this contractor can be selected for in Subcontract Estimates.
              </p>
            </div>

            {error && <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2.5 text-xs text-rose-300">{error}</div>}

            <div className="flex justify-end gap-2.5 pt-3 border-t border-white/10">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button type="submit">
                {modal === 'create' ? 'Save Subcontractor' : 'Update Subcontractor'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
