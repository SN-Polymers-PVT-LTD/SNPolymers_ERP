import { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Badge, Modal } from '../components/ui';
import { getAccountSubTitles, upsertAccountSubTitle } from '../api/acctRequisitionsApi';

// title is immutable once created (upsert key), so this modal only ever adds
// new sub-titles — toggling is_active on an existing one is handled inline
// by the list's Deactivate/Reactivate button, not through this form.
const AddSubTitleModal = ({ onClose }) => {
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
      await upsertAccountSubTitle({ title: trimmed, is_active: true });
      queryClient.invalidateQueries({ queryKey: ['acctAccountSubTitles'] });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save account sub-title.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Add Account Sub-title"
      size="sm"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="primary" form="sub-title-form" disabled={submitting} loading={submitting}>
            Add Sub-title
          </Button>
        </div>
      }
    >
      <form id="sub-title-form" onSubmit={handleSubmit} className="space-y-4 text-left">
        <Input
          label="Title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Site Maintenance"
        />
        {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}
      </form>
    </Modal>
  );
};

const AcctSubTitles = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState('');

  const { data: subTitles = [], isLoading, error: queryError } = useQuery({
    queryKey: ['acctAccountSubTitles'],
    queryFn: async () => (await getAccountSubTitles()).data?.accountSubTitles ?? [],
    enabled: isAccountsUser
  });

  const displayError = error || queryError?.response?.data?.message || queryError?.message || '';

  const toggleActive = async (subTitle) => {
    setError('');
    try {
      await upsertAccountSubTitle({ title: subTitle.title, is_active: !subTitle.is_active });
      queryClient.invalidateQueries({ queryKey: ['acctAccountSubTitles'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update account sub-title.');
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
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Account Sub-titles</h1>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Reference list used in the requisition line-item "Account Sub-title" dropdown.
          </p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>+ Add Sub-title</Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading sub-titles...</div>
      ) : subTitles.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          No account sub-titles set up yet. Use "+ Add Sub-title" to create one.
        </div>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 divide-y divide-white/5 overflow-hidden">
          {subTitles.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.01] transition-colors duration-200">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-100">{s.title}</span>
                <Badge variant={s.is_active ? 'emerald' : 'slate'} showDot={false}>
                  {s.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <Button variant="glass" size="sm" onClick={() => toggleActive(s)}>
                {s.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {showAddModal && <AddSubTitleModal onClose={() => setShowAddModal(false)} />}
    </>
  );
};

export default AcctSubTitles;
