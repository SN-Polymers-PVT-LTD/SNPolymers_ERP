import { useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Input, Badge, Modal, Select,
  Table, TableHeader, TableBody, TableRow, TableCell, Pagination
} from '../components/ui';
import {
  getBeneficiaries, upsertBeneficiary, getIndianBanks, upsertIndianBank
} from '../api/acctRequisitionsApi';

const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// Shared by both tabs — react-query dedupes identical queryKeys, so this
// doesn't cause a second network round trip when both tabs have mounted.
const useIndianBanks = () => useQuery({
  queryKey: ['acctIndianBanks'],
  queryFn: async () => (await getIndianBanks()).data?.indianBanks ?? []
});

const emptyBeneficiaryForm = () => ({
  account_number: '',
  ifsc: '',
  beneficiary_name: '',
  beneficiary_bank_name: ''
});

const AddBeneficiaryModal = ({ bankOptions, onClose }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyBeneficiaryForm());
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const setField = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.account_number.trim()) return setError('Account number is required.');
    if (!ifscRegex.test(form.ifsc.trim())) return setError('IFSC must be 11-char in format AAAA0XXXXXX.');
    if (!form.beneficiary_name.trim()) return setError('Beneficiary name is required.');
    if (!form.beneficiary_bank_name) return setError('Beneficiary bank is required.');

    setSubmitting(true);
    try {
      await upsertBeneficiary({
        account_number: form.account_number.trim(),
        ifsc: form.ifsc.trim().toUpperCase(),
        beneficiary_name: form.beneficiary_name.trim(),
        beneficiary_bank_name: form.beneficiary_bank_name
      });
      queryClient.invalidateQueries({ queryKey: ['acctBeneficiaries'] });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save beneficiary.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Add Beneficiary"
      size="sm"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="primary" form="beneficiary-form" disabled={submitting} loading={submitting}>
            Add Beneficiary
          </Button>
        </div>
      }
    >
      <form id="beneficiary-form" onSubmit={handleSubmit} className="space-y-4 text-left">
        <Input label="Account Number" required value={form.account_number} onChange={(e) => setField('account_number', e.target.value)} />
        <Input label="IFSC" required value={form.ifsc} onChange={(e) => setField('ifsc', e.target.value.toUpperCase())} placeholder="AAAA0XXXXXX" />
        <Input label="Beneficiary Name" required value={form.beneficiary_name} onChange={(e) => setField('beneficiary_name', e.target.value)} />
        <Select
          label="Beneficiary Bank"
          value={form.beneficiary_bank_name}
          onChange={(e) => setField('beneficiary_bank_name', e.target.value)}
          options={[{ value: '', label: 'Select bank...' }, ...bankOptions]}
        />
        {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}
      </form>
    </Modal>
  );
};

const AddBankModal = ({ onClose }) => {
  const queryClient = useQueryClient();
  const [bankName, setBankName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const trimmed = bankName.trim();
    if (!trimmed) {
      setError('Bank name is required.');
      return;
    }
    setSubmitting(true);
    try {
      await upsertIndianBank({ bank_name: trimmed, is_active: true });
      queryClient.invalidateQueries({ queryKey: ['acctIndianBanks'] });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save bank.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Add Indian Bank"
      size="sm"
      footer={
        <div className="flex justify-end gap-3 w-full">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="primary" form="bank-form" disabled={submitting} loading={submitting}>
            Add Bank
          </Button>
        </div>
      }
    >
      <form id="bank-form" onSubmit={handleSubmit} className="space-y-4 text-left">
        <Input label="Bank Name" required value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
        {error && <p className="text-[10px] font-semibold text-red-400">{error}</p>}
      </form>
    </Modal>
  );
};

const BeneficiariesTab = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ['acctBeneficiaries', { page, search }],
    queryFn: async () => {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      return (await getBeneficiaries(params)).data;
    }
  });

  const { data: banks = [] } = useIndianBanks();
  const bankOptions = banks.filter(b => b.is_active).map(b => ({ value: b.bank_name, label: b.bank_name }));

  const beneficiaries = data?.beneficiaries || [];
  const totalPages = data?.pagination?.totalPages || 1;
  const totalItems = data?.pagination?.total || 0;
  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
        <Input
          type="text"
          placeholder="Search account number or name..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          size="sm"
          className="w-full sm:w-80"
        />
        <Button onClick={() => setShowAdd(true)}>+ Add Beneficiary</Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-4 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading beneficiaries...</div>
      ) : beneficiaries.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          No matching beneficiaries found.
        </div>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
          <Table containerClassName="min-w-[700px]">
            <TableHeader>
              <TableRow hover={false}>
                <TableCell isHeader>Account Number</TableCell>
                <TableCell isHeader>IFSC</TableCell>
                <TableCell isHeader>Beneficiary Name</TableCell>
                <TableCell isHeader>Bank</TableCell>
                <TableCell isHeader>Last Used</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {beneficiaries.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono">{b.account_number}</TableCell>
                  <TableCell className="font-mono">{b.ifsc}</TableCell>
                  <TableCell className="font-semibold text-slate-200">{b.beneficiary_name}</TableCell>
                  <TableCell>{b.beneficiary_bank_name}</TableCell>
                  <TableCell>{b.last_used_at ? new Date(b.last_used_at).toLocaleDateString('en-IN') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} maxVisible={5} showLabel={true} totalRecords={totalItems} />
        </div>
      )}

      {showAdd && <AddBeneficiaryModal bankOptions={bankOptions} onClose={() => setShowAdd(false)} />}
    </>
  );
};

const BanksTab = () => {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');

  const { data: banks = [], isLoading, error: queryError } = useIndianBanks();

  const displayError = error || queryError?.response?.data?.message || queryError?.message || '';

  const toggleActive = async (bank) => {
    setError('');
    try {
      await upsertIndianBank({ bank_name: bank.bank_name, is_active: !bank.is_active });
      queryClient.invalidateQueries({ queryKey: ['acctIndianBanks'] });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update bank.');
    }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button onClick={() => setShowAdd(true)}>+ Add Bank</Button>
      </div>

      {displayError && (
        <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-4 flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          {displayError}
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading banks...</div>
      ) : banks.length === 0 ? (
        <div className="glass-panel rounded-3xl p-8 text-center text-slate-500 text-xs font-bold uppercase tracking-wider">
          No banks set up yet. Use "+ Add Bank" to create one.
        </div>
      ) : (
        <div className="glass-panel rounded-3xl border border-white/5 divide-y divide-white/5 overflow-hidden">
          {banks.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-4 p-4 hover:bg-white/[0.01] transition-colors duration-200">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-100">{b.bank_name}</span>
                <Badge variant={b.is_active ? 'emerald' : 'slate'} showDot={false}>
                  {b.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <Button variant="glass" size="sm" onClick={() => toggleActive(b)}>
                {b.is_active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddBankModal onClose={() => setShowAdd(false)} />}
    </>
  );
};

const AcctBeneficiaryMaster = () => {
  const { user } = useAuth();
  const isAccountsUser = user?.role === 'accounts' || user?.role === 'admin';
  const [activeTab, setActiveTab] = useState('beneficiaries'); // 'beneficiaries' | 'banks'

  if (!isAccountsUser) {
    return <div className="p-8 text-center text-slate-400 text-sm">Access denied.</div>;
  }

  return (
    <>
      <div className="mb-6 pb-6 border-b border-white/5">
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">
          Accounts Department · Master Data
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Beneficiary &amp; Bank Master</h1>
        <p className="text-xs text-slate-400 font-medium mt-1.5">
          Reference beneficiaries and the recognized Indian bank list used to validate requisition payouts.
        </p>
      </div>

      <div className="flex gap-6 mb-6 border-b border-white/5">
        <button
          onClick={() => setActiveTab('beneficiaries')}
          className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
            activeTab === 'beneficiaries' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Beneficiaries
        </button>
        <button
          onClick={() => setActiveTab('banks')}
          className={`pb-3 text-xs font-extrabold uppercase tracking-wider border-b-2 transition-all duration-200 ${
            activeTab === 'banks' ? 'border-amber-500 text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Indian Banks
        </button>
      </div>

      {activeTab === 'beneficiaries' ? <BeneficiariesTab /> : <BanksTab />}
    </>
  );
};

export default AcctBeneficiaryMaster;
