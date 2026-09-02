import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Select, Badge, SkeletonTable, Pagination, Table, TableHeader, TableBody, TableRow, TableCell } from '../ui';
import { getLineItems, getAccountSubTitles, getBankBalances } from '../../api/acctRequisitionsApi';
import { exportRequisitionDetailsToExcel } from '../../utils/exportHelpers';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const formatDate = (dateStr) => (dateStr ? new Date(dateStr).toLocaleDateString('en-IN') : '—');

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'Pending HO Review', label: 'Pending HO Review' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Partially Approved', label: 'Partially Approved' },
  { value: 'Credit Approved', label: 'Credit Approved' },
  { value: 'On Hold', label: 'On Hold' },
  { value: 'Returned for Correction', label: 'Returned for Correction' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Pending Review', label: 'Pending Review' }
];

const getStatusBadgeVariant = (status) => {
  switch (status) {
    case 'Approved':
    case 'Partially Approved':
      return 'emerald';
    case 'On Hold':
      return 'amber';
    case 'Returned for Correction':
      return 'blue';
    case 'Rejected':
      return 'red';
    case 'Credit Approved':
      return 'blue';
    default:
      return 'slate';
  }
};

// Shared "Requisition Details" filter/search view — line items flattened
// across sheets, filterable by Account Sub-title / Beneficiary A/c No. /
// Debit Bank Account / date range, with an "export everything matching" to
// Excel. Mounted as a tab on both AcctRequisitions.jsx (accounts) and
// AcctHoQueue.jsx (ho) — role only changes which sheet detail route a row
// click lands on, since both sides read the same /line-items endpoint.
const RequisitionDetailsPanel = ({ sheetDetailBasePath }) => {
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [accountSubTitle, setAccountSubTitle] = useState('');
  const [beneficiaryAcNo, setBeneficiaryAcNo] = useState('');
  const [debitBankAcType, setDebitBankAcType] = useState('');
  const [requisitionStatus, setRequisitionStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const filters = { accountSubTitle, beneficiaryAcNo, debitBankAcType, requisitionStatus, dateFrom, dateTo };
  const hasFilters = accountSubTitle || beneficiaryAcNo || debitBankAcType || requisitionStatus || dateFrom || dateTo;

  const buildParams = () => {
    const params = {};
    if (accountSubTitle) params.account_sub_title = accountSubTitle;
    if (beneficiaryAcNo) params.beneficiary_ac_no = beneficiaryAcNo;
    if (debitBankAcType) params.debit_bank_ac_type = debitBankAcType;
    if (requisitionStatus) params.requisition_status = requisitionStatus;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  };

  const { data: subTitlesData } = useQuery({
    queryKey: ['acctSubTitlesForFilter'],
    queryFn: async () => (await getAccountSubTitles()).data?.accountSubTitles ?? [],
    staleTime: 60 * 1000
  });

  const { data: bankBalancesData } = useQuery({
    queryKey: ['acctBankBalancesForFilter'],
    queryFn: async () => (await getBankBalances()).data?.bankBalances ?? [],
    staleTime: 60 * 1000
  });

  const subTitleOptions = (subTitlesData || []).filter(t => t.is_active).map(t => ({ value: t.title, label: t.title }));
  const bankOptions = (bankBalancesData || []).map(b => ({ value: b.bank_name, label: b.bank_name }));

  const { data, isLoading: loading, error: queryError } = useQuery({
    queryKey: ['acctLineItems', { page, ...filters }],
    queryFn: async () => {
      const params = { ...buildParams(), page, limit };
      const res = await getLineItems(params);
      return res.data;
    },
    staleTime: 15 * 1000
  });

  const items = data?.items || [];
  const totalPages = data?.pagination?.totalPages || 1;
  const totalItems = data?.pagination?.total || 0;
  const displayError = queryError?.response?.data?.message || queryError?.message || '';

  const resetFilters = () => {
    setAccountSubTitle('');
    setBeneficiaryAcNo('');
    setDebitBankAcType('');
    setRequisitionStatus('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleExport = async () => {
    setExportError('');
    setExporting(true);
    try {
      const res = await getLineItems({ ...buildParams(), export: true });
      await exportRequisitionDetailsToExcel(res.data?.items || []);
    } catch (err) {
      setExportError(err.response?.data?.message || 'Failed to export requisition details.');
    } finally {
      setExporting(false);
    }
  };

  const handleRowClick = (item) => {
    navigate(`${sheetDetailBasePath}/${item.sheet_id}`);
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 flex-grow overflow-hidden min-h-0">
      {/* Left Column: Filters */}
      <div className="w-full md:w-64 flex flex-col gap-4 shrink-0">
        <div className="glass-panel p-4 rounded-2xl border border-white/5 flex flex-col gap-5">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Account Sub-title</span>
            <Select
              value={accountSubTitle}
              onChange={(e) => { setAccountSubTitle(e.target.value); setPage(1); }}
              options={[{ value: '', label: 'All sub-titles' }, ...subTitleOptions]}
              size="sm"
            />
          </div>

          <div className="pt-4 border-t border-white/5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Beneficiary A/c No.</span>
            <Input
              type="text"
              placeholder="Enter account number..."
              value={beneficiaryAcNo}
              onChange={(e) => { setBeneficiaryAcNo(e.target.value); setPage(1); }}
              size="sm"
            />
          </div>

          <div className="pt-4 border-t border-white/5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Debit Bank Account</span>
            <Select
              value={debitBankAcType}
              onChange={(e) => { setDebitBankAcType(e.target.value); setPage(1); }}
              options={[{ value: '', label: 'All accounts' }, ...bankOptions]}
              size="sm"
            />
          </div>

          <div className="pt-4 border-t border-white/5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Status</span>
            <Select
              value={requisitionStatus}
              onChange={(e) => { setRequisitionStatus(e.target.value); setPage(1); }}
              options={STATUS_OPTIONS}
              size="sm"
            />
          </div>

          <div className="pt-4 border-t border-white/5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-2">Date Range</span>
            <div className="space-y-2">
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                size="sm"
              />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                size="sm"
              />
            </div>
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="w-full">
              Reset Filters
            </Button>
          )}

          <div className="pt-4 border-t border-white/5">
            <Button variant="glass" size="sm" onClick={handleExport} loading={exporting} className="w-full">
              Export to Excel
            </Button>
            {exportError && <p className="text-[10px] text-red-400 mt-2">{exportError}</p>}
          </div>
        </div>
      </div>

      {/* Right Column: Results */}
      <div className="flex-grow flex flex-col min-h-0 bg-white/[0.01] border border-white/5 rounded-3xl p-6 relative overflow-hidden">
        <div className="flex justify-between items-center mb-6 shrink-0 z-10">
          <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Requisition Details</h3>
          <span className="text-[10px] font-bold text-slate-500 font-mono">Found {totalItems} results</span>
        </div>

        {displayError && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-4 flex items-center gap-2.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {displayError}
          </div>
        )}

        <div className="flex-grow overflow-y-auto no-scrollbar min-h-0 pr-1 mb-4 z-10">
          {loading ? (
            <SkeletonTable rows={8} cols={7} />
          ) : items.length === 0 ? (
            <div className="text-center py-20 text-slate-500 text-xs uppercase font-extrabold tracking-widest border border-dashed border-white/5 rounded-2xl">
              No matching requisition details found.
            </div>
          ) : (
            <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
              <Table containerClassName="min-w-[900px]">
                <TableHeader>
                  <TableRow hover={false}>
                    <TableCell isHeader className="whitespace-nowrap">Req. No.</TableCell>
                    <TableCell isHeader>Date</TableCell>
                    <TableCell isHeader>Account Sub-title</TableCell>
                    <TableCell isHeader>Beneficiary A/c No.</TableCell>
                    <TableCell isHeader>Debit Bank Account</TableCell>
                    <TableCell isHeader align="right">Req. Amount</TableCell>
                    <TableCell isHeader align="right">Approved Amount</TableCell>
                    <TableCell isHeader>Status</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id} onClick={() => handleRowClick(item)} interactive>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm font-black text-amber-500 font-mono tracking-wide">{item.sheet_number || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{formatDate(item.created_at)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-slate-300 font-medium">{item.account_sub_title_text || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-slate-400 font-mono">{item.beneficiary_ac_no || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-slate-400">{item.debit_bank_ac_type || '—'}</span>
                      </TableCell>
                      <TableCell align="right">
                        <span className="text-sm font-black text-slate-200 font-mono">{formatINR(item.req_amount)}</span>
                      </TableCell>
                      <TableCell align="right">
                        {['Approved', 'Partially Approved'].includes(item.requisition_status) && item.ho_pass_amount != null ? (
                          <span className="text-sm font-black text-emerald-400 font-mono">{formatINR(item.ho_pass_amount)}</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(item.requisition_status)} showDot={false}>{item.requisition_status || '—'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          maxVisible={5}
          showLabel={true}
          totalRecords={totalItems}
          className="rounded-2xl z-10"
        />
      </div>
    </div>
  );
};

export default RequisitionDetailsPanel;
