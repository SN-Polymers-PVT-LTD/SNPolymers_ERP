import React, { useState, useEffect } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableCell, Button, SkeletonTable, Pagination, Badge } from '../ui';

export const EstimatedBillTable = ({
  data = [],
  isLoading = false,
  onViewLedgerClick
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [sortConfig, setSortConfig] = useState({ key: '', direction: 'desc' });
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [data, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key.includes('amount') || key.includes('value') || key.includes('billed') || key.includes('remaining') || key === 'surety_pct' || key === 'entry_count' ? 'desc' : 'asc' };
    });
  };

  const sortedData = React.useMemo(() => {
    if (!data || data.length === 0) return [];
    if (!sortConfig.key) return data;

    return [...data].sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (sortConfig.key === 'updated_by_name') {
        aVal = a.updated_by_name || a.updated_by || '';
        bVal = b.updated_by_name || b.updated_by || '';
      }

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();

      if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  if (isLoading) {
    return <SkeletonTable rows={6} cols={10} />;
  }

  const totalPages = Math.ceil((sortedData?.length || 0) / itemsPerPage);
  const currentData = (sortedData || []).slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(val || 0);
  };

  const getSuretyBadgeVariant = (surety) => {
    const s = Number(surety) || 0;
    if (s >= 75) return 'emerald';
    if (s >= 50) return 'amber';
    return 'red';
  };

  const renderSortIcon = (columnKey) => {
    const isActive = sortConfig.key === columnKey;
    return (
      <span className={`ml-1 transition-colors ${isActive ? 'text-amber-400 font-bold' : 'text-slate-600 group-hover:text-slate-400'}`}>
        {isActive ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    );
  };

  if (!data || data.length === 0) {
    return (
      <div className="glass-panel p-12 text-center rounded-2xl border border-white/10 my-4">
        <svg className="w-12 h-12 text-slate-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm font-extrabold text-slate-300 uppercase tracking-wider">No Estimated Bills Recorded</p>
        <p className="text-xs text-slate-400 mt-1">Select an unmapped Work Order or click "+ New Estimate" to add a record.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-white/10">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-white/10 bg-white/5">
            <TableCell isHeader onClick={() => handleSort('work_order_no')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Work Order {renderSortIcon('work_order_no')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('zone')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Zone {renderSortIcon('zone')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('department')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Department {renderSortIcon('department')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('work_order_value')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              WO Value {renderSortIcon('work_order_value')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('total_billed')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Total RA Billed {renderSortIcon('total_billed')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('remaining_value')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Remaining Capacity {renderSortIcon('remaining_value')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('estimated_bill_amount')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Estimated Amount {renderSortIcon('estimated_bill_amount')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('surety_pct')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Wtd. Surety % {renderSortIcon('surety_pct')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('entry_count')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200 text-center">
              Entries {renderSortIcon('entry_count')}
            </TableCell>
            <TableCell isHeader onClick={() => handleSort('updated_by_name')} className="text-xs font-bold uppercase tracking-wider text-slate-400 cursor-pointer select-none group hover:text-slate-200">
              Updated By {renderSortIcon('updated_by_name')}
            </TableCell>
            <TableCell isHeader className="text-xs font-bold uppercase tracking-wider text-slate-400 text-right">
              Ledger
            </TableCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {currentData.map((row) => (
            <TableRow key={row.work_order_no} className="hover:bg-white/5 transition-colors border-b border-white/5">
              <TableCell className="font-mono text-xs font-bold text-amber-400">
                {row.work_order_no}
              </TableCell>
              <TableCell className="text-xs text-slate-300">
                {row.zone || '—'}
              </TableCell>
              <TableCell className="text-xs text-slate-300">
                {row.department || '—'}
              </TableCell>
              <TableCell className="font-mono text-xs font-bold text-slate-200 tabular-nums">
                {formatCurrency(row.work_order_value)}
              </TableCell>
              <TableCell className="font-mono text-xs font-bold text-rose-400 tabular-nums">
                {formatCurrency(row.total_billed)}
              </TableCell>
              <TableCell className="font-mono text-xs font-bold text-emerald-400 tabular-nums">
                {formatCurrency(row.remaining_value)}
              </TableCell>
              <TableCell className="font-mono text-xs font-extrabold text-slate-100 tabular-nums">
                {formatCurrency(row.estimated_bill_amount)}
              </TableCell>
              <TableCell>
                <Badge variant={getSuretyBadgeVariant(row.surety_pct)} showDot={false}>
                  {row.surety_pct}%
                </Badge>
              </TableCell>
              <TableCell className="text-center text-xs font-bold text-slate-200 font-mono">
                {row.entry_count || 1}
              </TableCell>
              <TableCell className="text-xs text-slate-400">
                {row.updated_by_name || row.updated_by || '—'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  onClick={() => onViewLedgerClick(row.work_order_no)}
                  className="text-xs font-extrabold text-amber-400 hover:text-amber-300 p-1.5"
                >
                  View Ledger →
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="p-4 border-t border-white/5">
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          maxVisible={5}
          showLabel={true}
          totalRecords={data.length}
        />
      </div>
    </div>
  );
};

export default EstimatedBillTable;
