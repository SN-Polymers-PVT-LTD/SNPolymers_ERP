import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import TopNavbar from '../components/TopNavbar';
import Modal from '../components/ui/Modal';
import BackgroundShapes from '../components/BackgroundShapes';
import { getProjectsHealth } from '../api/analyticsApi';

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

const DigitalTwinHub = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');

  // Fetch all projects health stats mapped to user visibility
  const { data: projectRes, isLoading, isError } = useQuery({
    queryKey: ['projectsHealthList'],
    queryFn: async () => {
      const res = await getProjectsHealth();
      return res.data;
    },
    staleTime: 120 * 1000
  });

  const projects = projectRes?.data || [];

  // Extract unique zones for filtering
  const uniqueZones = [...new Set(projects.map(p => p.zone).filter(Boolean))];

  // Filtering logic
  const filteredProjects = projects.filter(p => {
    const matchesSearch = 
      (p.work_order_no || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.site_details || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.district || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = !statusFilter || p.health_status === statusFilter;
    const matchesZone = !zoneFilter || p.zone === zoneFilter;

    return matchesSearch && matchesStatus && matchesZone;
  });

  const [page, setPage] = useState(1);
  const CARDS_PER_PAGE = 6;
  const totalPages = Math.ceil(filteredProjects.length / CARDS_PER_PAGE);
  const paginatedProjects = filteredProjects.slice((page - 1) * CARDS_PER_PAGE, page * CARDS_PER_PAGE);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, zoneFilter]);

  const [pinnedProjects, setPinnedProjects] = useState([]);
  const [showPinLimitModal, setShowPinLimitModal] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('pinnedProjects');
      if (stored) {
        setPinnedProjects(JSON.parse(stored));
      } else {
        const defaults = ['WO-OVR-8F0DDDAB', 'WO-OVR-A6313AA6', 'WO-OVR-FBE2B471'];
        localStorage.setItem('pinnedProjects', JSON.stringify(defaults));
        setPinnedProjects(defaults);
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const togglePin = (e, workOrderNo) => {
    e.stopPropagation();
    let pinned = [...pinnedProjects];
    if (pinned.includes(workOrderNo)) {
      pinned = pinned.filter(wo => wo !== workOrderNo);
      setPinnedProjects(pinned);
      localStorage.setItem('pinnedProjects', JSON.stringify(pinned));
      window.dispatchEvent(new Event('pinned-projects-updated'));
    } else {
      if (pinned.length >= 3) {
        setShowPinLimitModal(true);
      } else {
        pinned.push(workOrderNo);
        setPinnedProjects(pinned);
        localStorage.setItem('pinnedProjects', JSON.stringify(pinned));
        window.dispatchEvent(new Event('pinned-projects-updated'));
      }
    }
  };

  return (
    <>
        
          {/* Header Row */}
          <div className="mb-10 pb-6 border-b border-white/5">
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Regional Portfolios</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Project Digital Twin Hub</h1>
            <p className="text-xs text-slate-400 mt-1.5">Select a regional construction work order to launch its complete 5-panel digital twin simulation.</p>
          </div>

          {/* Search Filters Row */}
          <div className="glass-panel p-6 rounded-3xl mb-8 flex flex-col md:flex-row gap-6">
            {/* Search Input */}
            <div className="flex-grow flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Search Project / WO</label>
              <input
                type="text"
                placeholder="Search by work order no, site, district..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="glass-input w-full px-4 py-2.5 text-xs"
              />
            </div>

            {/* Health Status Filter */}
            <div className="w-full md:w-48 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Health Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="glass-input w-full px-4 py-2.5 text-xs"
              >
                <option value="">All Health Statuses</option>
                <option value="Healthy">🟢 Healthy</option>
                <option value="Warning">🟡 Warning</option>
                <option value="Critical">🔴 Critical</option>
              </select>
            </div>

            {/* Zone Filter */}
            <div className="w-full md:w-48 flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Zonal Region</label>
              <select
                value={zoneFilter}
                onChange={(e) => setZoneFilter(e.target.value)}
                className="glass-input w-full px-4 py-2.5 text-xs"
              >
                <option value="">All Zones</option>
                {uniqueZones.map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Projects Twin Grid */}
          {isError ? (
            <div className="glass-panel p-8 rounded-3xl border border-rose-500/10 bg-rose-950/5 flex flex-col items-center justify-center text-center">
              <h2 className="text-base font-bold uppercase tracking-widest text-slate-200">Error Loading Projects</h2>
              <p className="text-xs text-slate-500 mt-2">Failed to connect to analytics services. Verify database mappings.</p>
            </div>
          ) : isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3, 4, 5, 6].map(idx => (
                <div key={idx} className="glass-panel p-6 rounded-3xl animate-pulse h-48 bg-white/[0.02]" />
              ))}
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="glass-panel p-16 rounded-3xl text-center flex flex-col items-center justify-center border border-white/5 bg-slate-900/10">
              <span className="text-slate-500 text-xs uppercase tracking-widest font-bold">No projects matching query</span>
              <p className="text-[11px] text-slate-600 mt-2">Adjust search terms or reset filters above.</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {paginatedProjects.map((proj) => {
                  const score = Number(proj.health_score || 0);
                  const healthColor = 
                    proj.health_status === 'Healthy' ? 'border-emerald-500/20 bg-emerald-950/5 text-emerald-400' :
                    proj.health_status === 'Warning' ? 'border-amber-500/20 bg-amber-950/5 text-amber-400' :
                    'border-rose-500/20 bg-rose-950/5 text-rose-400';

                  return (
                    <div
                      key={proj.work_order_no}
                      onClick={() => navigate(`/projects/${proj.work_order_no}/digital-twin`)}
                      className="glass-panel p-6 rounded-3xl relative overflow-hidden transition-all duration-300 hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.02] cursor-pointer flex flex-col justify-between min-h-[220px]"
                    >
                      <div>
                        {/* Top row */}
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex items-start gap-3 truncate flex-grow">
                            {/* Pin Icon button on top left */}
                            <button
                              onClick={(e) => togglePin(e, proj.work_order_no)}
                              className={`p-1 rounded-lg transition-all duration-300 hover:scale-110 shrink-0 ${
                                pinnedProjects.includes(proj.work_order_no)
                                  ? 'text-sky-400'
                                  : 'text-slate-500 hover:text-slate-300'
                              }`}
                              title={pinnedProjects.includes(proj.work_order_no) ? "Unpin Project" : "Pin Project"}
                            >
                              {pinnedProjects.includes(proj.work_order_no) ? (
                                <svg className="w-5 h-5 fill-current transform rotate-[30deg]" viewBox="0 0 24 24">
                                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                                </svg>
                              ) : (
                                <svg className="w-5 h-5 fill-none stroke-current stroke-2 transform rotate-[30deg]" viewBox="0 0 24 24">
                                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                                </svg>
                              )}
                            </button>
                            <div className="truncate">
                              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest block">Work Order</span>
                              <span className="text-xs font-black text-slate-200 uppercase font-mono mt-0.5 block truncate">{proj.work_order_no}</span>
                            </div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider shrink-0 ${healthColor}`}>
                            {proj.health_status} ({Math.round(score)}%)
                          </span>
                        </div>

                        {/* Site Details */}
                        <div className="my-4">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 block truncate">{proj.site_details || 'Site Project'}</span>
                          <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block mt-1">{proj.zone} • {proj.district}, {proj.state}</span>
                        </div>
                      </div>

                      {/* Progress Bar & Value */}
                      <div className="space-y-3 pt-3 border-t border-white/5">
                        <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-widest text-slate-500">
                          <span>Physical Progress</span>
                          <span className="text-slate-300">{proj.physical_progress || 0}%</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-indigo-500 rounded-full transition-all duration-1000"
                            style={{ width: `${proj.physical_progress || 0}%` }}
                          />
                        </div>

                        <div className="flex justify-between items-center text-[9px] font-bold uppercase tracking-widest text-slate-500 pt-1">
                          <span>Work Order Value</span>
                          <span className="text-slate-300 font-black">{formatINR(proj.work_order_value)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex justify-between items-center bg-white/[0.01] border border-white/5 rounded-2xl p-4 mt-6">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                    Page {page} of {totalPages} <span className="text-slate-600">({filteredProjects.length} projects total)</span>
                  </span>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(prev => Math.max(1, prev - 1))}
                      disabled={page === 1}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                        page === 1 
                          ? 'border-transparent text-slate-600 cursor-not-allowed' 
                          : 'border-white/10 hover:bg-white/5 text-slate-300'
                      }`}
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                      disabled={page === totalPages}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
                        page === totalPages 
                          ? 'border-transparent text-slate-600 cursor-not-allowed' 
                          : 'border-white/10 hover:bg-white/5 text-slate-300'
                      }`}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

      <Modal
        isOpen={showPinLimitModal}
        onClose={() => setShowPinLimitModal(false)}
        title="Pin Limit Reached"
        subtitle="Pinned Projects Profile"
        size="sm"
      >
        <p className="text-xs text-slate-400 leading-relaxed mb-6">
          You can only pin up to <span className="font-extrabold text-sky-400">3 projects</span> to the sidebar. To pin this project, please unpin one of the following first:
        </p>

        <div className="space-y-2 mb-6">
          {pinnedProjects.map((wo) => (
            <div
              key={wo}
              className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5"
            >
              <span className="text-xs font-mono font-semibold text-slate-300">{wo}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const updated = pinnedProjects.filter(item => item !== wo);
                  setPinnedProjects(updated);
                  localStorage.setItem('pinnedProjects', JSON.stringify(updated));
                  window.dispatchEvent(new Event('pinned-projects-updated'));
                }}
                className="text-[10px] font-bold uppercase tracking-wider text-rose-400 hover:text-rose-300 transition-colors"
              >
                Unpin
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => setShowPinLimitModal(false)}
          className="w-full bg-white hover:bg-slate-100 text-slate-950 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 shadow-md"
        >
          Close
        </button>
      </Modal>
    </>
  );
};

export default DigitalTwinHub;
