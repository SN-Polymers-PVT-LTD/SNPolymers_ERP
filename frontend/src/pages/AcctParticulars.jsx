import { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Badge, Modal } from '../components/ui';
import { getParticulars, upsertParticular } from '../api/acctRequisitionsApi';

// title is immutable once created (upsert key), so this modal only ever adds
// new particulars — toggling is_active on an existing one is handled inline
// by the list's Deactivate/Reactivate button, not through this form.
const AddParticularModal = ({ onClose }) => {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    try {
      await upsertParticular({ title: trimmed, is_active: true });
      queryClient.invalidateQueries({ queryKey: ['acctParticulars'] });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save particular.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Add Particular"
      size="sm"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="primary" form="particular-form" disabled={submitting} loading={submitting}>
            Add Particular
          </Button>
        </div>
      }
    >
      <form id="particular-form" onSubmit={handleSubmit} className="space-y-4 text-left">
        <Input
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. AMC Charges"
        />
        {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}
      </form>
    </Modal>
  );
};

const AcctParticulars = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState('');

  const { data: particulars = [], isLoading, error: queryError } = useQuery({
    queryKey: ['acctParticulars'],
    queryFn: async () => (await getParticulars()).data?.particulars ?? [],
    enabled: isAccountsUser
  });

  const displayError = error || queryError?.response?.data?.message || queryError?.message || '';

  const toggleActive = async (particular) => {
    setError('');
    try {
      await upsertParticular({ title: particular.title, is_active: !particular.is_active });
      queryClient.invalidateQueries({ queryKey: ['acctParticulars'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update particular.');
    }
  };

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="mb-8 pb-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
            Accounts Department · Master Data
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Particulars</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Reference list used in the requisition line-item "Particulars" dropdown.
          </p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>+ Add Particular</Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading particulars...</div>
      ) : particulars.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          No particulars set up yet. Use "+ Add Particular" to create one.
        </div>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 divide-y divide-white/5 overflow-hidden">
          {particulars.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.01] transition-colors duration-200">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-100">{p.title}</span>
                <Badge variant={p.is_active ? 'emerald' : 'slate'} showDot={false}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <Button variant="glass" size="sm" onClick={() => toggleActive(p)}>
                {p.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {showAddModal && <AddParticularModal onClose={() => setShowAddModal(false)} />}
    </>
  );
};

export default AcctParticulars;
