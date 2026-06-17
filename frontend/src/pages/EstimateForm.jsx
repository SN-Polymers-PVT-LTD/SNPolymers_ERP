import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import authApi from '../api/authApi';

const ESTIMATE_STATUS = {
  DRAFT: 'Draft',
  ZO_REVISION_REQUESTED: 'ZO Revision Requested',
  HO_REVISION_REQUESTED: 'HO Revision Requested'
};

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(num);
};

const EstimateForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isEditMode = !!id;

  // Header State
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState('');
  const [estimateNo, setEstimateNo] = useState('');
  const [zonalOfficeNo, setZonalOfficeNo] = useState('');
  const [jeRemarks, setJeRemarks] = useState('');
  
  // Project Info Metadata
  const [projectMeta, setProjectMeta] = useState({
    state: '',
    district: '',
    zone: '',
    department: '',
    siteDetails: '',
    workOrderValue: 0
  });

  // Items State
  const [items, setItems] = useState([]);
  const [purchaseOptions, setPurchaseOptions] = useState([]);
  const [mainHeads, setMainHeads] = useState(['Labour', 'Materials', 'Transport', 'Miscellaneous']);
  
  // Cascading dropdown caches
  const [subHeadsCache, setSubHeadsCache] = useState({}); // mainHead -> [subHeads]
  const [materialsCache, setMaterialsCache] = useState({}); // "mainHead|||subHead" -> [materials]

  // Status & Timing States
  const [estimateStatus, setEstimateStatus] = useState(ESTIMATE_STATUS.DRAFT);
  const [deadline, setDeadline] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState('');
  const [isExpired, setIsExpired] = useState(false);
  const timerRef = useRef(null);

  // Pagination for Items (avoids UI freezing with 500+ rows)
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;
  const totalPages = Math.max(Math.ceil(items.length / itemsPerPage), 1);

  // General States
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createdEstimateId, setCreatedEstimateId] = useState(null);

  useEffect(() => {
    initForm();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [id]);

  const initForm = async () => {
    setLoading(true);
    setError('');
    try {
      // 1. Fetch Purchase Options
      const purchaseRes = await authApi.get('/purchase-data');
      if (purchaseRes.data?.success) {
        setPurchaseOptions(purchaseRes.data.options.filter(o => o.is_active));
      }

      // Fetch dynamic material main heads
      const categoriesRes = await authApi.get('/materials/categories');
      if (categoriesRes.data?.success) {
        setMainHeads(categoriesRes.data.mainHeads || []);
      }

      if (isEditMode) {
        // 2. Edit Mode: Fetch Estimate Details
        const res = await authApi.get(`/estimates/${id}`);
        if (res.data?.success) {
          const { estimate, items: estItems } = res.data;
          setEstimateStatus(estimate.estimate_status);
          setSelectedWorkOrder(estimate.work_order_no);
          setEstimateNo(estimate.estimate_no);
          setZonalOfficeNo(estimate.zonal_office_no || '');
          setJeRemarks(estimate.je_remarks || '');
          
          if (estimate.projects_master) {
            setProjectMeta({
              state: estimate.projects_master.state,
              district: estimate.projects_master.district,
              zone: estimate.projects_master.zone,
              department: estimate.projects_master.department,
              siteDetails: estimate.projects_master.site_details,
              workOrderValue: estimate.projects_master.work_order_value
            });
          }

          const enrichedItems = await Promise.all((estItems || []).map(async (item) => {
            const subHeads = item.material_main_head ? await fetchSubHeads(item.material_main_head) : [];
            const mats = (item.material_main_head && item.material_sub_head) ? await fetchMaterials(item.material_main_head, item.material_sub_head) : [];
            return {
              ...item,
              subHeadsList: subHeads,
              matsList: mats
            };
          }));
          setItems(enrichedItems);

          if (estimate.active_revision_deadline) {
            setDeadline(new Date(estimate.active_revision_deadline));
            startCountdown(new Date(estimate.active_revision_deadline));
          }
        }
      } else {
        // 3. Create Mode: Fetch Projects for Selection
        const [projRes, estsRes] = await Promise.all([
          authApi.get('/projects'),
          authApi.get('/estimates?limit=100')
        ]);

        if (projRes.data?.success && estsRes.data?.success) {
          // Find work orders with active non-terminal estimates
          const blockedWorkOrders = estsRes.data.estimates
            .filter(e => !['Final Approved', 'Rejected by ZO', 'Rejected by HO'].includes(e.estimate_status))
            .map(e => e.work_order_no);

          // Filter work orders
          const eligibleProjects = projRes.data.projects.filter(p => 
            p.status !== 'Closed' && !blockedWorkOrders.includes(p.work_order_no)
          );
          setWorkOrders(eligibleProjects);
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to initialize estimate form.');
    } finally {
      setLoading(false);
    }
  };

  const startCountdown = (targetDate) => {
    if (timerRef.current) clearInterval(timerRef.current);

    const updateTimer = () => {
      const now = new Date();
      const diffMs = targetDate - now;

      if (diffMs <= 0) {
        setTimeRemaining('Revision Deadline Expired');
        setIsExpired(true);
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        const hrs = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);
        setTimeRemaining(`${hrs}h ${mins}m ${secs}s`);
      }
    };

    updateTimer();
    timerRef.current = setInterval(updateTimer, 1000);
  };

  const handleWorkOrderChange = async (workOrderNo) => {
    setSelectedWorkOrder(workOrderNo);
    setError('');
    if (!workOrderNo) {
      setEstimateNo('');
      setProjectMeta({
        state: '',
        district: '',
        zone: '',
        department: '',
        siteDetails: '',
        workOrderValue: 0
      });
      return;
    }

    const selectedProj = workOrders.find(p => p.work_order_no === workOrderNo);
    if (selectedProj) {
      setEstimateNo(selectedProj.estimate_no);
      setProjectMeta({
        state: selectedProj.state,
        district: selectedProj.district,
        zone: selectedProj.zone,
        department: selectedProj.department,
        siteDetails: selectedProj.site_details,
        workOrderValue: selectedProj.work_order_value
      });
    }
  };

  // Helper: dynamic fetch subheads for cascading selector
  const fetchSubHeads = async (mainHead) => {
    if (subHeadsCache[mainHead]) return subHeadsCache[mainHead];
    try {
      const res = await authApi.get(`/materials/subheads?main_head=${encodeURIComponent(mainHead)}`);
      if (res.data?.success) {
        const subs = Array.from(new Set(res.data.subHeads || []));
        setSubHeadsCache(prev => ({ ...prev, [mainHead]: subs }));
        return subs;
      }
    } catch (err) {
      console.error('Failed to fetch subheads:', err);
    }
    return [];
  };

  // Helper: dynamic fetch materials details for cascading selector
  const fetchMaterials = async (mainHead, subHead) => {
    const key = `${mainHead}|||${subHead}`;
    if (materialsCache[key]) return materialsCache[key];
    try {
      const res = await authApi.get(`/materials?main_head=${encodeURIComponent(mainHead)}&sub_head=${encodeURIComponent(subHead)}&limit=1000`);
      if (res.data?.success) {
        const mats = res.data.materials || [];
        setMaterialsCache(prev => ({ ...prev, [key]: mats }));
        return mats;
      }
    } catch (err) {
      console.error('Failed to fetch materials:', err);
    }
    return [];
  };

  const handleItemChange = async (index, field, value) => {
    const globalIndex = (currentPage - 1) * itemsPerPage + index;
    const updated = [...items];
    const item = { ...updated[globalIndex], [field]: value };

    if (field === 'material_main_head') {
      item.material_sub_head = '';
      item.material_details = '';
      item.unit = '';
      item.subHeadsList = await fetchSubHeads(value);
      item.matsList = [];
    } else if (field === 'material_sub_head') {
      item.material_details = '';
      item.unit = '';
      item.matsList = await fetchMaterials(item.material_main_head, value);
    } else if (field === 'material_details') {
      const matched = item.matsList?.find(m => m.Material_Details === value);
      item.unit = matched ? matched.M_Unit : '';
    }

    if (field === 'qty' || field === 'rate') {
      const q = field === 'qty' ? Number(value) || 0 : Number(item.qty) || 0;
      const r = field === 'rate' ? Number(value) || 0 : Number(item.rate) || 0;
      item.amount = Math.round(q * r * 100) / 100;
    }

    updated[globalIndex] = item;
    setItems(updated);
  };

  const handleAddItem = () => {
    if (isExpired) return;
    setItems([
      ...items,
      {
        item_id: '',
        material_main_head: '',
        material_sub_head: '',
        material_details: '',
        unit: '',
        qty: 0,
        rate: 0,
        amount: 0,
        rate_reference: '',
        source_of_purchase: '',
        subHeadsList: [],
        matsList: []
      }
    ]);
    // Navigate to the newly created item page
    const newTotalPages = Math.ceil((items.length + 1) / itemsPerPage);
    setCurrentPage(newTotalPages);
  };

  const handleRemoveItem = (index) => {
    if (isExpired) return;
    const globalIndex = (currentPage - 1) * itemsPerPage + index;
    const updated = items.filter((_, idx) => idx !== globalIndex);
    setItems(updated);
  };

  const handleSaveDraft = async () => {
    if (isExpired) return;
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      let currentId = id || createdEstimateId;
      if (!currentId) {
        // Create header first if in new mode
        const headerRes = await authApi.post('/estimates', {
          work_order_no: selectedWorkOrder,
          zonal_office_no: zonalOfficeNo,
          je_remarks: jeRemarks
        });
        if (headerRes.data?.success) {
          currentId = headerRes.data.estimate.estimate_id;
          setCreatedEstimateId(currentId);
        }
      } else if (isEditMode) {
        // Update header comments/zonal office no
        await authApi.put(`/estimates/${currentId}/items`, { items: [] }); // Stub items update or headers update trigger
      }

      // Save line items
      const saveRes = await authApi.put(`/estimates/${currentId}/items`, { items });
      if (saveRes.data?.success) {
        setSuccess('Estimate draft saved successfully.');
        setTimeout(() => navigate(`/estimates/${currentId}`), 1500);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save estimate draft.');
      // Refresh project list on 409 conflict
      if (err.response?.status === 409) {
        initForm();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (isExpired) return;
    if (!window.confirm('Submit this cost estimate for review? You will not be able to edit items unless a revision is requested.')) return;
    
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      let currentId = id || createdEstimateId;
      if (!currentId) {
        const headerRes = await authApi.post('/estimates', {
          work_order_no: selectedWorkOrder,
          zonal_office_no: zonalOfficeNo,
          je_remarks: jeRemarks
        });
        currentId = headerRes.data.estimate.estimate_id;
        setCreatedEstimateId(currentId);
      }

      // 1. Save current items draft
      await authApi.put(`/estimates/${currentId}/items`, { items });

      // 2. Submit estimate
      const submitRes = await authApi.post(`/estimates/${currentId}/submit`);
      if (submitRes.data?.success) {
        setSuccess('Estimate submitted successfully.');
        setTimeout(() => navigate(`/estimates/${currentId}`), 1500);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit estimate.');
    } finally {
      setSubmitting(false);
    }
  };

  const paginatedItems = items.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const calculateGrossTotal = () => {
    return items.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  };

  const isRevisionMode = estimateStatus === ESTIMATE_STATUS.ZO_REVISION_REQUESTED || estimateStatus === ESTIMATE_STATUS.HO_REVISION_REQUESTED;

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono">JE Console</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
              {isEditMode ? 'Modify Cost Estimate' : 'New Cost Estimate'}
            </h1>
            <p className="text-xs text-slate-400 font-medium mt-1.5">Compose estimate line items and select relevant materials.</p>
          </div>
          <Link
            to="/estimates"
            className="bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-200"
          >
            Cancel & Back
          </Link>
        </div>

        {/* Overdue alert / Countdown Timer */}
        {isRevisionMode && deadline && (
          <div className={`p-4 rounded-2xl mb-6 border text-xs font-bold flex justify-between items-center ${
            isExpired ? 'bg-red-950/20 border-red-500/30 text-red-400' : 'bg-amber-950/20 border-amber-500/30 text-amber-400'
          }`}>
            <span>Revision stage: {estimateStatus}</span>
            <span className="font-mono">Time Remaining: {timeRemaining}</span>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl text-xs text-red-300 mb-6">
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 bg-emerald-950/20 border border-emerald-900/30 rounded-2xl text-xs text-emerald-300 mb-6">
            {success}
          </div>
        )}

        {/* Header Form */}
        <div className="glass-panel p-6 rounded-3xl mb-8 border border-white/5 space-y-6">
          <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400 mb-4">Estimate Header</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Work Order Number
              </label>
              {isEditMode ? (
                <input
                  type="text"
                  value={selectedWorkOrder}
                  readOnly
                  className="w-full glass-input cursor-not-allowed opacity-75 focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-400 text-sm font-semibold"
                />
              ) : (
                <select
                  value={selectedWorkOrder}
                  onChange={(e) => handleWorkOrderChange(e.target.value)}
                  className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold"
                  disabled={isExpired || submitting}
                  required
                >
                  <option value="">Select Work Order</option>
                  {workOrders.map((p) => (
                    <option key={p.work_order_no} value={p.work_order_no} className="bg-slate-900 text-slate-100">
                      {p.work_order_no} ({p.zone})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Estimate Number (Auto)
              </label>
              <input
                type="text"
                value={estimateNo}
                readOnly
                className="w-full glass-input cursor-not-allowed opacity-75 focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-400 text-sm font-semibold"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Zonal Office Number
              </label>
              <input
                type="text"
                placeholder="e.g. ZO-05"
                value={zonalOfficeNo}
                onChange={(e) => setZonalOfficeNo(e.target.value)}
                className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3 text-slate-100 text-sm font-semibold"
                disabled={isEditMode || isExpired || submitting}
                required
              />
            </div>
          </div>

          {/* Project Metadata Preview */}
          {selectedWorkOrder && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-[11px] text-slate-400">
              <div>
                <span className="font-semibold block text-slate-500 uppercase text-[9px] tracking-wider mb-1">State / District</span>
                <span className="text-slate-200">{projectMeta.state} / {projectMeta.district}</span>
              </div>
              <div>
                <span className="font-semibold block text-slate-500 uppercase text-[9px] tracking-wider mb-1">Area Code / Department</span>
                <span className="text-slate-200">{projectMeta.zone} / {projectMeta.department}</span>
              </div>
              <div className="col-span-2">
                <span className="font-semibold block text-slate-500 uppercase text-[9px] tracking-wider mb-1">Site Details</span>
                <span className="text-slate-200 truncate block">{projectMeta.siteDetails}</span>
              </div>
              <div>
                <span className="font-semibold block text-slate-500 uppercase text-[9px] tracking-wider mb-1">Work Order Value</span>
                <span className="text-slate-200 font-mono font-bold">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(projectMeta.workOrderValue)}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              JE Remarks / Special Instructions
            </label>
            <textarea
              rows={2}
              value={jeRemarks}
              onChange={(e) => setJeRemarks(e.target.value)}
              placeholder="Enter context, rate assumptions, or instructions..."
              className="w-full glass-input focus:ring-0 outline-none rounded-xl p-4 text-slate-100 text-sm font-semibold"
              disabled={isExpired || submitting}
            />
          </div>
        </div>

        {/* Cost Estimates Items Editor */}
        <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
          <div className="flex justify-between items-center p-6 bg-white/[0.01] border-b border-white/5">
            <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-400">Estimate Items</h3>
            <button
              type="button"
              onClick={handleAddItem}
              className="bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50"
              disabled={isExpired || submitting}
            >
              Add Item
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1200px]">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-400 font-mono">
                  <th className="py-4 px-6 w-48">Main Category</th>
                  <th className="py-4 px-6 w-48">Sub Head</th>
                  <th className="py-4 px-6">Material Details</th>
                  <th className="py-4 px-6 w-24">Unit</th>
                  <th className="py-4 px-6 w-24">Qty</th>
                  <th className="py-4 px-6 w-28">Rate (₹)</th>
                  <th className="py-4 px-6 w-36">Rate Reference</th>
                  <th className="py-4 px-6 w-40">Source of Purchase</th>
                  <th className="py-4 px-6 w-32">Amount</th>
                  <th className="py-4 px-6 w-16 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs text-slate-300">
                {paginatedItems.map((item, idx) => {
                  const globalIdx = (currentPage - 1) * itemsPerPage + idx;
                  const isLocked = isRevisionMode && (
                    (estimateStatus === ESTIMATE_STATUS.ZO_REVISION_REQUESTED && item.zo_office_approve === 'Approve') ||
                    (estimateStatus === ESTIMATE_STATUS.HO_REVISION_REQUESTED && item.ho_office_approve === 'Approve')
                  );
                  const isRejected = isRevisionMode && (
                    (estimateStatus === ESTIMATE_STATUS.ZO_REVISION_REQUESTED && item.zo_office_approve === 'Not Approve') ||
                    (estimateStatus === ESTIMATE_STATUS.HO_REVISION_REQUESTED && item.ho_office_approve === 'Not Approve')
                  );

                  return (
                    <tr key={globalIdx} className={`hover:bg-white/[0.01] transition-colors duration-200 ${
                      isRejected ? 'border-l-4 border-l-amber-500 bg-amber-500/[0.01]' : ''
                    } ${isLocked ? 'opacity-60 bg-white/[0.01] pointer-events-none' : ''}`}>
                      <td className="py-3 px-4">
                        <select
                          value={item.material_main_head}
                          onChange={(e) => handleItemChange(idx, 'material_main_head', e.target.value)}
                          className="w-full glass-input p-2 rounded-lg text-xs"
                          disabled={isExpired || submitting || isLocked}
                        >
                          <option value="">Select Main Head</option>
                          {mainHeads.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={item.material_sub_head}
                          onChange={(e) => handleItemChange(idx, 'material_sub_head', e.target.value)}
                          className="w-full glass-input p-2 rounded-lg text-xs"
                          disabled={isExpired || submitting || isLocked || !item.material_main_head}
                        >
                          <option value="">Select Sub Head</option>
                          {item.subHeadsList?.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={item.material_details}
                          onChange={(e) => handleItemChange(idx, 'material_details', e.target.value)}
                          className="w-full glass-input p-2 rounded-lg text-xs"
                          disabled={isExpired || submitting || isLocked || !item.material_sub_head}
                        >
                          <option value="">Select Details</option>
                          {item.matsList?.map((m, mIdx) => (
                            <option key={`${m.id || m.Material_Details}-${mIdx}`} value={m.Material_Details}>
                              {m.Material_Details}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <input
                          type="text"
                          value={item.unit}
                          readOnly
                          className="w-full glass-input p-2 rounded-lg text-xs text-center font-bold text-slate-400 cursor-not-allowed"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.qty || ''}
                          onChange={(e) => handleItemChange(idx, 'qty', e.target.value)}
                          className="w-full glass-input p-2 rounded-lg text-xs font-semibold text-center"
                          disabled={isExpired || submitting || isLocked}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <input
                          type="number"
                          min="0.01"
                          step="any"
                          value={item.rate || ''}
                          onChange={(e) => handleItemChange(idx, 'rate', e.target.value)}
                          className="w-full glass-input p-2 rounded-lg text-xs font-semibold text-center"
                          disabled={isExpired || submitting || isLocked}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <input
                          type="text"
                          placeholder="e.g. CSR 2026"
                          value={item.rate_reference || ''}
                          onChange={(e) => handleItemChange(idx, 'rate_reference', e.target.value)}
                          className="w-full glass-input p-2 rounded-lg text-xs"
                          disabled={isExpired || submitting || isLocked}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={item.source_of_purchase || ''}
                          onChange={(e) => handleItemChange(idx, 'source_of_purchase', e.target.value)}
                          className="w-full glass-input p-2 rounded-lg text-xs"
                          disabled={isExpired || submitting || isLocked}
                        >
                          <option value="">Select Source</option>
                          {purchaseOptions.map(o => <option key={o.id} value={o.name}>{o.name}</option>)}
                        </select>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-200">
                        {formatINR(item.amount)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-red-400 hover:text-red-300 p-1.5 hover:bg-white/5 rounded-lg transition"
                          disabled={isExpired || submitting || isLocked}
                          title="Remove item"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Summary Footer */}
          <div className="flex justify-between items-center p-6 bg-white/[0.01] border-t border-white/5 text-xs">
            <span className="text-slate-400 font-bold uppercase tracking-widest font-mono">Gross Estimate Total</span>
            <span className="font-mono text-xl font-extrabold text-amber-500">{formatINR(calculateGrossTotal())}</span>
          </div>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="mt-4 flex justify-between items-center text-xs text-slate-400">
            <span>Showing items {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, items.length)} of {items.length}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-slate-300 disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-slate-300 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Submit Actions */}
        <div className="mt-8 flex justify-end gap-4">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 px-6 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50"
            disabled={isExpired || submitting || items.length === 0}
          >
            Save as Draft
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="bg-white hover:bg-slate-100 text-slate-950 px-6 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition disabled:opacity-50 shadow-lg"
            disabled={isExpired || submitting || items.length === 0}
          >
            {submitting ? 'Submitting...' : 'Submit Estimate'}
          </button>
        </div>
      </main>
    </div>
  );
};

export default EstimateForm;
