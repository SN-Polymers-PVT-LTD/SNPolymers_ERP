import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import {
  getReturnRequests,
  createReturnRequest,
  acceptReturnRequest,
  rejectReturnRequest,
  modifyReturnRequest,
  actionOnReturnRequest
} from '../api/fundReturnsApi';
import { getZonalBalances } from '../api/zoBalancesApi';
import { getProjects } from '../api/projectsApi';
import { getEligibleZOs } from '../api/userMappingsApi';

const ExcessFundReturns = () => {
  const { user } = useAuth();
  const isZo = user?.role === 'zo';

  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dropdown list options (Admin/HO only)
  const [eligibleZOs, setEligibleZOs] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [zoBalance, setZoBalance] = useState(0.00); // Current ZO available balance (for ZO actions)

  // Request Return Modal (Admin/HO only)
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedZO, setSelectedZO] = useState('');
  const [selectedWO, setSelectedWO] = useState('');
  const [requestAmount, setRequestAmount] = useState('');
  const [remarksHo, setRemarksHo] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestError, setRequestError] = useState('');

  // ZO Action Drawer/Modal (ZO only)
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [showActionModal, setShowActionModal] = useState(false);
  const [remarksZo, setRemarksZo] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);
  const [actionError, setActionError] = useState('');

  // HO Action Modal (review modifications/rejections)
  const [showHoActionModal, setShowHoActionModal] = useState(false);
  const [hoActionTarget, setHoActionTarget] = useState(null); // return request object
  const [hoSelectedAction, setHoSelectedAction] = useState('Cancel'); // 'Cancel' | 'Reissue'
  const [hoActionRemarks, setHoActionRemarks] = useState('');
  const [submittingHoAction, setSubmittingHoAction] = useState(false);
  const [hoActionError, setHoActionError] = useState('');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'Requested', 'Completed', 'Awaiting HO Review', 'Rejected', 'Cancelled'

  const fetchReturns = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await getReturnRequests();
      if (response.data?.success) {
        setReturns(response.data.returns || []);
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || 'Failed to fetch excess fund returns.');
    } finally {
      setLoading(false);
    }
  };

  const fetchDropdownAndBalanceData = async () => {
    try {
      if (isZo) {
        // Fetch own ZO balance for available limit check
        const balRes = await getZonalBalances();
        if (balRes.data?.success) {
          const balData = balRes.data.balances || balRes.data.balance;
          const ownBalObj = Array.isArray(balData) ? balData[0] : balData;
          setZoBalance(ownBalObj ? Number(ownBalObj.available_balance) : 0.00);
        }
      } else {
        // Fetch eligible ZOs and projects to assign
        const [zoRes, projRes] = await Promise.all([getEligibleZOs(), getProjects()]);
        if (zoRes.data?.success) setEligibleZOs(zoRes.data.zos || []);
        if (projRes.data?.success) setAllProjects(projRes.data.projects || []);
      }
    } catch (err) {
      console.error('Failed to load return options:', err);
    }
  };

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchReturns();
      fetchDropdownAndBalanceData();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter projects owned by selected ZO in Request Modal
  const filteredProjectsForSelect = allProjects.filter(p => p.zo_user_id === selectedZO && p.status !== 'Closed');

  const handleOpenRequestModal = () => {
    setRequestError('');
    setSelectedZO('');
    setSelectedWO('');
    setRequestAmount('');
    setRemarksHo('');
    setShowRequestModal(true);
  };

  const handleCreateRequest = async (e) => {
    e.preventDefault();
    setRequestError('');
    setSuccess('');

    const amountNum = parseFloat(requestAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setRequestError('Requested return amount must be greater than 0.00.');
      return;
    }

    setSubmittingRequest(true);
    try {
      const response = await createReturnRequest({
        zo_user_id: selectedZO,
        work_order_no: selectedWO,
        requested_amount: amountNum,
        remarks_ho: remarksHo
      });

      if (response.data?.success) {
        setSuccess('Excess fund return request successfully sent to Zonal Office.');
        setShowRequestModal(false);
        fetchReturns();
      }
    } catch (err) {
      console.error(err);
      setRequestError(err.response?.data?.message || 'Failed to create return request.');
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleOpenActionModal = (ret) => {
    setActionError('');
    setRemarksZo('');
    setSelectedReturn(ret);
    setShowActionModal(true);
  };

  // Action: Accept Return
  const handleAcceptReturn = async () => {
    if (!selectedReturn) return;
    setActionError('');
    setSuccess('');
    setSubmittingAction(true);

    try {
      // Optimistic concurrency check: send current record's updated_at
      const response = await acceptReturnRequest(selectedReturn.id, selectedReturn.updated_at);
      if (response.data?.success) {
        setSuccess('Fund return accepted. Balance updated and logged in ledger.');
        setShowActionModal(false);
        fetchReturns();
        fetchDropdownAndBalanceData(); // Refresh available ZO balance
      }
    } catch (err) {
      console.error(err);
      if (err.response?.status === 409) {
        setActionError(
          'This return request has been modified by the Head Office. Please close this modal and refresh the page to load the updated details.'
        );
      } else {
        setActionError(err.response?.data?.message || 'Failed to accept return request.');
      }
    } finally {
      setSubmittingAction(false);
    }
  };

  // Action: Reject or Modify Return
  const handleRejectOrModify = async (actionType) => {
    if (!selectedReturn) return;
    setActionError('');
    setSuccess('');

    if (!remarksZo.trim()) {
      setActionError('Remarks are mandatory when rejecting or requesting modifications.');
      return;
    }

    setSubmittingAction(true);
    try {
      let response;
      if (actionType === 'REJECT') {
        response = await rejectReturnRequest(selectedReturn.id, remarksZo);
      } else {
        response = await modifyReturnRequest(selectedReturn.id, remarksZo);
      }

      if (response.data?.success) {
        setSuccess(`Return request successfully ${actionType === 'REJECT' ? 'rejected' : 'sent for modification'}.`);
        setShowActionModal(false);
        fetchReturns();
      }
    } catch (err) {
      console.error(err);
      setActionError(err.response?.data?.message || `Failed to process request.`);
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleOpenHoActionModal = (ret) => {
    setHoActionError('');
    setHoSelectedAction('Cancel');
    setHoActionRemarks('');
    setHoActionTarget(ret);
    setShowHoActionModal(true);
  };

  const handleHoActionSubmit = async (e) => {
    e.preventDefault();
    setHoActionError('');
    setSuccess('');

    if (!hoActionTarget) return;

    setSubmittingHoAction(true);
    try {
      const response = await actionOnReturnRequest(hoActionTarget.id, hoSelectedAction, hoActionRemarks);
      if (response.data?.success) {
        setSuccess(`Return request successfully actioned (${hoSelectedAction}).`);
        setShowHoActionModal(false);
        fetchReturns();
      }
    } catch (err) {
      console.error(err);
      setHoActionError(err.response?.data?.message || 'Failed to action return request.');
    } finally {
      setSubmittingHoAction(false);
    }
  };

  const filteredReturns = returns.filter(r => {
    const matchesSearch =
      r.work_order_no?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.zo_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.zo_user_id?.includes(searchQuery);

    const matchesStatus =
      statusFilter === 'all' || r.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <div className="flex-grow flex flex-col min-w-0 overflow-hidden">
        <TopNavbar />
        <main className="flex-grow p-6 md:p-10 overflow-y-auto no-scrollbar max-w-7xl mx-auto w-full relative z-10">
        
        {/* Header Section */}
        <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Government Division</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Excess Fund Returns</h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5 font-semibold">
              {isZo 
                ? `Return unused funds back to HO. Your available balance: ₹${zoBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                : 'Oversee and initiate return requests of excess funds from Zonal Offices.'}
            </p>
          </div>

          {!isZo && (
            <button
              onClick={handleOpenRequestModal}
              className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all duration-300 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Request Fund Return
            </button>
          )}
        </div>

        {/* Alerts */}
        {success && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium flex items-center justify-between">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} className="text-emerald-400/70 hover:text-emerald-400">&times;</button>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400/70 hover:text-red-400">&times;</button>
          </div>
        )}

        {/* Filter Controls */}
        <div className="glass-panel p-4 rounded-2xl mb-6 flex flex-col md:flex-row gap-4 items-center justify-between shadow-lg">
          <div className="relative w-full md:w-80">
            <input
              type="text"
              placeholder="Search by Work Order, Zonal Office..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 transition-all"
            />
          </div>

          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            {['all', 'Requested', 'Completed', 'Awaiting HO Review', 'Rejected', 'Cancelled'].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all border ${
                  statusFilter === status
                    ? 'bg-white text-black border-white'
                    : 'bg-white/5 text-slate-400 border-white/5 hover:bg-white/10 hover:text-slate-200'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Return Requests Table */}
        <div className="glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 text-[9px] uppercase font-bold tracking-widest text-slate-400 bg-white/2">
                  <th className="px-6 py-4">Work Order</th>
                  {!isZo && <th className="px-6 py-4">Zonal Office</th>
                  }<th className="px-6 py-4 text-right">Requested Amount</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Remarks Log</th>
                  <th className="px-6 py-4">Timestamps</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs font-medium text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan={isZo ? 6 : 7} className="px-6 py-12 text-center text-slate-500">
                      <span className="inline-block animate-spin rounded-full h-5 w-5 border-t-2 border-amber-500 mr-2" />
                      Loading return requests...
                    </td>
                  </tr>
                ) : filteredReturns.length === 0 ? (
                  <tr>
                    <td colSpan={isZo ? 6 : 7} className="px-6 py-12 text-center text-slate-500">
                      No excess fund return requests found.
                    </td>
                  </tr>
                ) : (
                  filteredReturns.map((ret) => {
                    const statusColors = {
                      Requested: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
                      Completed: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
                      'Awaiting HO Review': 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
                      Rejected: 'bg-red-500/10 text-red-400 border border-red-500/20',
                      Cancelled: 'bg-neutral-500/10 text-slate-400 border border-white/5'
                    };

                    return (
                      <tr key={ret.id} className="hover:bg-white/2 transition-colors">
                        <td className="px-6 py-4 font-semibold text-slate-100">
                          {ret.work_order_no}
                        </td>
                        {!isZo && (
                          <td className="px-6 py-4 font-semibold text-slate-200">
                            {ret.zo_name || ret.zo_user_id}
                          </td>
                        )}
                        <td className="px-6 py-4 text-right text-slate-200 font-extrabold">
                          ₹{Number(ret.requested_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${statusColors[ret.status] || ''}`}>
                            {ret.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 space-y-1">
                          {ret.remarks_ho && (
                            <div className="text-[10px] text-slate-400">
                              <span className="font-bold text-slate-500 uppercase mr-1">HO:</span>
                              {ret.remarks_ho}
                            </div>
                          )}
                          {ret.remarks_zo && (
                            <div className="text-[10px] text-slate-400">
                              <span className="font-bold text-amber-500/80 uppercase mr-1">ZO:</span>
                              {ret.remarks_zo}
                            </div>
                          )}
                          {!ret.remarks_ho && !ret.remarks_zo && (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-[10px] text-slate-500 font-normal">
                          <div>Req: {new Date(ret.created_at).toLocaleString()}</div>
                          <div>Upd: {new Date(ret.updated_at).toLocaleString()}</div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          {isZo && ret.status === 'Requested' && (
                            <button
                              onClick={() => handleOpenActionModal(ret)}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 transition"
                            >
                              Evaluate
                            </button>
                          )}

                          {!isZo && ['Awaiting HO Review', 'Rejected'].includes(ret.status) && (
                            <button
                              onClick={() => handleOpenHoActionModal(ret)}
                              className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase border border-white/10 text-slate-200 hover:bg-white/5 transition"
                            >
                              Action
                            </button>
                          )}
                          
                          {/* Fallback display for actions */}
                          {(!isZo && ret.status === 'Requested') && (
                            <span className="text-slate-500 text-[10px]">Awaiting ZO</span>
                          )}
                          {(ret.status === 'Completed' || ret.status === 'Cancelled') && (
                            <span className="text-slate-600 text-[10px]">Resolved</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      </div>

      {/* Request Return Modal (Admin/HO only) */}
      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-all duration-300">
          <div className="glass-panel w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/2">
              <h2 className="text-lg font-bold tracking-tight text-slate-100">Request Excess Fund Return</h2>
              <button onClick={() => setShowRequestModal(false)} className="text-slate-400 hover:text-slate-200 text-lg">&times;</button>
            </div>

            <form onSubmit={handleCreateRequest} className="p-6 space-y-5">
              {requestError && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                  {requestError}
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">Select Target Zonal Office</label>
                <select
                  value={selectedZO}
                  onChange={(e) => {
                    setSelectedZO(e.target.value);
                    setSelectedWO('');
                  }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                  required
                >
                  <option value="" className="bg-neutral-900 text-slate-500">Select a ZO...</option>
                  {eligibleZOs.map((zo) => (
                    <option key={zo.mobile_number} value={zo.mobile_number} className="bg-neutral-900 text-slate-100">
                      {zo.display_name} ({zo.mobile_number})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">Select Work Order (Owned by ZO)</label>
                <select
                  value={selectedWO}
                  onChange={(e) => setSelectedWO(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                  disabled={!selectedZO}
                  required
                >
                  <option value="" className="bg-neutral-900 text-slate-500">Select a Work Order...</option>
                  {filteredProjectsForSelect.map((p) => (
                    <option key={p.work_order_no} value={p.work_order_no} className="bg-neutral-900 text-slate-100">
                      {p.work_order_no} (Estimate bound)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">Requested Return Amount (INR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={requestAmount}
                  onChange={(e) => setRequestAmount(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">Head Office Remarks / Instruction</label>
                <textarea
                  rows="3"
                  placeholder="Provide instructions on returning excess funds..."
                  value={remarksHo}
                  onChange={(e) => setRemarksHo(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-300 hover:bg-white/5 transition"
                  disabled={submittingRequest}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 transition"
                  disabled={submittingRequest || !selectedWO}
                >
                  {submittingRequest ? 'Submitting...' : 'Request Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ZO Action Modal (ZO only) */}
      {showActionModal && selectedReturn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-all duration-300">
          <div className="glass-panel w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/2">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-slate-100">Evaluate Return Request</h2>
                <div className="text-[10px] text-slate-400 mt-0.5">WO: {selectedReturn.work_order_no}</div>
              </div>
              <button onClick={() => setShowActionModal(false)} className="text-slate-400 hover:text-slate-200 text-lg">&times;</button>
            </div>

            <div className="p-6 space-y-6">
              {actionError && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold leading-relaxed">
                  {actionError}
                </div>
              )}

              {/* Info Metrics */}
              <div className="grid grid-cols-2 gap-4">
                <div className="glass-panel p-4 rounded-xl bg-white/2 border border-white/5">
                  <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Requested Amount</span>
                  <div className="text-lg font-black text-slate-100 mt-1">
                    ₹{Number(selectedReturn.requested_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <div className="glass-panel p-4 rounded-xl bg-white/2 border border-white/5">
                  <span className="text-[9px] uppercase font-bold tracking-widest text-slate-500">Your Available Balance</span>
                  <div className={`text-lg font-black mt-1 ${zoBalance >= selectedReturn.requested_amount ? 'text-emerald-400' : 'text-red-400'}`}>
                    ₹{zoBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {zoBalance < selectedReturn.requested_amount && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[10px] font-medium leading-normal">
                  *Acceptance is blocked. The requested return amount exceeds your available credit balance. You must request modification or reject this request.
                </div>
              )}

              {selectedReturn.remarks_ho && (
                <div className="space-y-1 bg-white/2 border border-white/5 p-4 rounded-xl">
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500">HO Remarks / Instructions:</div>
                  <p className="text-xs text-slate-300 font-normal leading-relaxed">{selectedReturn.remarks_ho}</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  Zonal Office Remarks (Mandatory for Reject / Modify)
                </label>
                <textarea
                  rows="3"
                  placeholder="Provide details if rejecting or requesting modification..."
                  value={remarksZo}
                  onChange={(e) => setRemarksZo(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div className="flex flex-wrap gap-2 justify-between pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowActionModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-300 hover:bg-white/5 transition mr-auto"
                  disabled={submittingAction}
                >
                  Cancel
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleRejectOrModify('REJECT')}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase bg-red-950/20 border border-red-900/30 text-red-400 hover:bg-red-950/30 transition"
                    disabled={submittingAction || !remarksZo.trim()}
                  >
                    Reject
                  </button>

                  <button
                    type="button"
                    onClick={() => handleRejectOrModify('MODIFY')}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-200 hover:bg-white/5 transition"
                    disabled={submittingAction || !remarksZo.trim()}
                  >
                    Modify
                  </button>

                  <button
                    type="button"
                    onClick={handleAcceptReturn}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    disabled={submittingAction || zoBalance < selectedReturn.requested_amount}
                  >
                    {submittingAction ? 'Processing...' : 'Accept Return'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HO Action Modal (review modifications/rejections) */}
      {showHoActionModal && hoActionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm transition-all duration-300">
          <div className="glass-panel w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-white/10 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/2">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-slate-100">Action Return Request</h2>
                <div className="text-[10px] text-slate-400 mt-0.5">Status: {hoActionTarget.status}</div>
              </div>
              <button onClick={() => setShowHoActionModal(false)} className="text-slate-400 hover:text-slate-200 text-lg">&times;</button>
            </div>

            <form onSubmit={handleHoActionSubmit} className="p-6 space-y-5">
              {hoActionError && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                  {hoActionError}
                </div>
              )}

              <div className="p-4 rounded-xl bg-white/2 border border-white/5 space-y-2 text-xs">
                <div>
                  <span className="text-slate-500 uppercase font-bold text-[10px] block">Target Zone</span>
                  <span className="text-slate-200 font-semibold">{hoActionTarget.zo_name} ({hoActionTarget.zo_user_id})</span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase font-bold text-[10px] block">Requested Amount</span>
                  <span className="text-slate-200 font-bold">₹{Number(hoActionTarget.requested_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                {hoActionTarget.remarks_zo && (
                  <div>
                    <span className="text-amber-500 uppercase font-bold text-[10px] block">ZO Remarks / Response</span>
                    <p className="text-slate-300 bg-black/30 p-2 rounded border border-white/5 leading-relaxed mt-1 font-normal">{hoActionTarget.remarks_zo}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">Select Resolution Action</label>
                <select
                  value={hoSelectedAction}
                  onChange={(e) => setHoSelectedAction(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50"
                  required
                >
                  <option value="Cancel" className="bg-neutral-900 text-slate-100">Cancel Request (Delete/Archive)</option>
                  <option value="Reissue" className="bg-neutral-900 text-slate-100">Reissue (Reset Status to 'Requested')</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] uppercase font-bold tracking-widest text-slate-400">Resolution Remarks</label>
                <textarea
                  rows="3"
                  placeholder="Provide reason for cancellation or reissue details..."
                  value={hoActionRemarks}
                  onChange={(e) => setHoActionRemarks(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/50"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowHoActionModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold uppercase border border-white/10 text-slate-300 hover:bg-white/5 transition"
                  disabled={submittingHoAction}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl text-xs font-bold uppercase bg-amber-500 text-black hover:bg-amber-400 transition"
                  disabled={submittingHoAction}
                >
                  {submittingHoAction ? 'Processing...' : 'Confirm Action'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExcessFundReturns;
