import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import BackgroundShapes from '../components/BackgroundShapes';
import Sidebar, { MobileHeader } from '../components/Sidebar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMaterials,
  getMaterialCategories,
  createMaterial,
  updateMaterial,
  updateMaterialStatus
} from '../api/materialsApi';

const MaterialMaster = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();

  // Core Messaging & Modal / Form States
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Filtering & Pagination States
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [mainHeadFilter, setMainHeadFilter] = useState('');
  const [subHeadFilter, setSubHeadFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState(isAdmin ? 'true' : ''); // Admins see active by default, non-admins only see active (forced by backend)
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [sortBy, setSortBy] = useState('Material_Details');
  const [sortOrder, setSortOrder] = useState('asc');

  // Modal / Form States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' | 'edit'
  const [currentMaterialId, setCurrentMaterialId] = useState(null);
  
  const [formData, setFormData] = useState({
    Material_Main_Head: '',
    Material_Sub_Head: '',
    Material_Details: '',
    M_Unit: '',
    is_active: true
  });

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  // Reset page when search or filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, mainHeadFilter, subHeadFilter, activeFilter]);

  // Fetch unique categories for filtering dropdowns using React Query
  const { data: categoriesData } = useQuery({
    queryKey: ['materialCategories'],
    queryFn: async () => {
      const res = await getMaterialCategories();
      return res.data;
    },
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000,    // 60 minutes
  });

  const categories = {
    mainHeads: Array.from(new Set(categoriesData?.mainHeads || [])),
    subHeads: Array.from(new Set(categoriesData?.subHeads || []))
  };

  // Fetch main material records using React Query
  const {
    data: materialsData,
    isLoading: loading,
    error: queryError
  } = useQuery({
    queryKey: [
      'materials',
      {
        page,
        limit,
        search: debouncedSearch,
        main_head: mainHeadFilter,
        sub_head: subHeadFilter,
        is_active: activeFilter,
        sortBy,
        sortOrder
      }
    ],
    queryFn: async () => {
      const params = {
        page,
        limit,
        search: debouncedSearch,
        main_head: mainHeadFilter,
        sub_head: subHeadFilter,
        is_active: activeFilter,
        sortBy,
        sortOrder
      };
      const res = await getMaterials(params);
      return res.data;
    },
    staleTime: 5 * 60 * 1000,  // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes
  });

  const materials = materialsData?.materials || [];
  const totalItems = materialsData?.pagination?.totalItems || 0;
  const totalPages = materialsData?.pagination?.totalPages || 1;

  // Sync query error with error state
  useEffect(() => {
    if (queryError) {
      setErrorMsg('Failed to load Material Master items. Please try again.');
    } else {
      setErrorMsg('');
    }
  }, [queryError]);

  // Prefetch the next page of results
  useEffect(() => {
    if (page < totalPages) {
      const nextPage = page + 1;
      queryClient.prefetchQuery({
        queryKey: [
          'materials',
          {
            page: nextPage,
            limit,
            search: debouncedSearch,
            main_head: mainHeadFilter,
            sub_head: subHeadFilter,
            is_active: activeFilter,
            sortBy,
            sortOrder
          }
        ],
        queryFn: async () => {
          const params = {
            page: nextPage,
            limit,
            search: debouncedSearch,
            main_head: mainHeadFilter,
            sub_head: subHeadFilter,
            is_active: activeFilter,
            sortBy,
            sortOrder
          };
          const res = await getMaterials(params);
          return res.data;
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
      });
    }
  }, [page, totalPages, limit, debouncedSearch, mainHeadFilter, subHeadFilter, activeFilter, sortBy, sortOrder, queryClient]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    setDebouncedSearch(search);
  };

  const handleClearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setMainHeadFilter('');
    setSubHeadFilter('');
    setActiveFilter(isAdmin ? 'true' : '');
    setPage(1);
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  // Form handlers
  const openCreateModal = () => {
    setModalMode('create');
    setFormData({
      Material_Main_Head: '',
      Material_Sub_Head: '',
      Material_Details: '',
      M_Unit: '',
      is_active: true
    });
    setErrorMsg('');
    setSuccessMsg('');
    setIsModalOpen(true);
  };

  const openEditModal = (material) => {
    setModalMode('edit');
    setCurrentMaterialId(material.id);
    setFormData({
      Material_Main_Head: material.Material_Main_Head,
      Material_Sub_Head: material.Material_Sub_Head,
      Material_Details: material.Material_Details,
      M_Unit: material.M_Unit,
      is_active: material.is_active
    });
    setErrorMsg('');
    setSuccessMsg('');
    setIsModalOpen(true);
  };

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!formData.Material_Main_Head || !formData.Material_Sub_Head || !formData.Material_Details || !formData.M_Unit) {
      setErrorMsg('Please populate all fields correctly.');
      return;
    }

    try {
      if (modalMode === 'create') {
        const res = await createMaterial(formData);
        if (res.data?.success) {
          setSuccessMsg('Material created successfully!');
          setTimeout(() => setIsModalOpen(false), 1200);
          queryClient.invalidateQueries({ queryKey: ['materials'] });
          queryClient.invalidateQueries({ queryKey: ['materialCategories'] });
        }
      } else {
        const res = await updateMaterial(currentMaterialId, formData);
        if (res.data?.success) {
          setSuccessMsg('Material updated successfully!');
          setTimeout(() => setIsModalOpen(false), 1200);
          queryClient.invalidateQueries({ queryKey: ['materials'] });
          queryClient.invalidateQueries({ queryKey: ['materialCategories'] });
        }
      }
    } catch (err) {
      console.error('Failed to save material:', err);
      setErrorMsg(err.response?.data?.message || 'Server error occurred while saving.');
    }
  };

  const handleToggleStatus = async (id, currentStatus) => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const targetStatus = !currentStatus;
      const res = await updateMaterialStatus(id, targetStatus);
      if (res.data?.success) {
        setSuccessMsg(`Material status updated to ${targetStatus ? 'Active' : 'Inactive'}.`);
        queryClient.invalidateQueries({ queryKey: ['materials'] });
        queryClient.invalidateQueries({ queryKey: ['materialCategories'] });
        setTimeout(() => setSuccessMsg(''), 3000);
      }
    } catch (err) {
      console.error('Failed to toggle material status:', err);
      setErrorMsg('Failed to change status. Please check your admin privileges.');
    }
  };

  return (
    <div className="h-screen bg-black text-slate-100 flex flex-col md:flex-row font-sans relative overflow-hidden">
      <BackgroundShapes />
      <Sidebar />
      <MobileHeader />

      <main className="flex-grow p-4 md:p-8 overflow-y-auto max-w-7xl mx-auto w-full relative z-10">
        
        {/* Module Header */}
        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Inventory Registry</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Material Master</h1>
            <p className="text-xs text-slate-400 font-medium mt-1">Centralised catalog of construction resources, aggregates, components, and tools.</p>
          </div>
          {isAdmin && (
            <button
              onClick={openCreateModal}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold uppercase tracking-wider text-xs rounded-xl shadow-lg shadow-amber-500/10 transition-all duration-200"
            >
              + Create Material
            </button>
          )}
        </div>

        {/* Global Notifications */}
        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-xl animate-fade-in">
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl animate-fade-in">
            {errorMsg}
          </div>
        )}

        {/* Search and Filters Bar */}
        <div className="glass-panel p-4 rounded-2xl mb-6 space-y-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3">
            <div className="flex-grow relative">
              <input
                type="text"
                placeholder="Search by Main Head, Sub Head or Material Details..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3.5 top-3 text-slate-400 hover:text-slate-200 text-xs"
                >
                  Clear
                </button>
              )}
            </div>
            <button
              type="submit"
              className="px-6 py-2.5 bg-white/5 border border-white/10 text-slate-200 font-bold uppercase text-xs rounded-xl hover:bg-white/10 active:scale-98 transition-all duration-200"
            >
              Search
            </button>
          </form>

          {/* Filtering Dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Main Head</label>
              <select
                value={mainHeadFilter}
                onChange={(e) => { setMainHeadFilter(e.target.value); setPage(1); }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 focus:bg-slate-900 transition-colors"
              >
                <option value="">All Categories</option>
                {categories.mainHeads.map((mh) => (
                  <option key={mh} value={mh}>{mh}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Sub Head</label>
              <select
                value={subHeadFilter}
                onChange={(e) => { setSubHeadFilter(e.target.value); setPage(1); }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 focus:bg-slate-900 transition-colors"
              >
                <option value="">All Sub categories</option>
                {categories.subHeads.map((sh) => (
                  <option key={sh} value={sh}>{sh}</option>
                ))}
              </select>
            </div>

            {isAdmin && (
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Operational Status</label>
                <select
                  value={activeFilter}
                  onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500 focus:bg-slate-900 transition-colors"
                >
                  <option value="">All Statuses</option>
                  <option value="true">Active Materials Only</option>
                  <option value="false">Inactive Materials Only</option>
                </select>
              </div>
            )}

            <div className="flex items-end">
              <button
                onClick={handleClearFilters}
                className="w-full px-4 py-2 border border-dashed border-white/10 text-slate-400 hover:text-slate-200 font-semibold text-xs rounded-xl hover:bg-white/5 transition-all duration-200"
              >
                Reset All Filters
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="glass-panel rounded-2xl overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/5 text-slate-400 text-[10px] font-bold uppercase tracking-wider select-none">
                  <th
                    onClick={() => handleSort('Material_Main_Head')}
                    className="p-4 cursor-pointer hover:text-slate-200 transition-colors"
                  >
                    Main Head {sortBy === 'Material_Main_Head' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    onClick={() => handleSort('Material_Sub_Head')}
                    className="p-4 cursor-pointer hover:text-slate-200 transition-colors"
                  >
                    Sub Head {sortBy === 'Material_Sub_Head' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    onClick={() => handleSort('Material_Details')}
                    className="p-4 cursor-pointer hover:text-slate-200 transition-colors"
                  >
                    Material Description {sortBy === 'Material_Details' && (sortOrder === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="p-4">Unit</th>
                  {isAdmin && <th className="p-4 text-center">Status</th>}
                  {isAdmin && <th className="p-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-xs">
                {loading ? (
                  <tr>
                    <td colSpan={isAdmin ? 6 : 4} className="p-10 text-center text-slate-500 font-medium">
                      <div className="flex justify-center items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                        Loading material registry logs...
                      </div>
                    </td>
                  </tr>
                ) : materials.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 6 : 4} className="p-10 text-center text-slate-500 font-semibold">
                      No materials found matching criteria.
                    </td>
                  </tr>
                ) : (
                  materials.map((material) => (
                    <tr
                      key={material.id}
                      className={`hover:bg-white/5 transition-colors ${!material.is_active ? 'opacity-50' : ''}`}
                    >
                      <td className="p-4 font-semibold text-slate-200 max-w-[180px] truncate">{material.Material_Main_Head}</td>
                      <td className="p-4 text-slate-300 max-w-[180px] truncate">{material.Material_Sub_Head}</td>
                      <td className="p-4 text-slate-100 font-medium max-w-sm whitespace-pre-wrap">{material.Material_Details}</td>
                      <td className="p-4 font-mono text-slate-400">{material.M_Unit}</td>
                      {isAdmin && (
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleToggleStatus(material.id, material.is_active)}
                            className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider border ${
                              material.is_active
                                ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-400'
                                : 'bg-red-950/20 border-red-900/30 text-red-400'
                            }`}
                          >
                            {material.is_active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                      )}
                      {isAdmin && (
                        <td className="p-4 text-right">
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => openEditModal(material)}
                              className="px-2.5 py-1.5 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 font-bold uppercase text-[9px] rounded-lg tracking-wider transition-all duration-200"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="p-4 bg-white/5 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs select-none">
            <span className="text-slate-400 font-medium">
              Showing <span className="font-extrabold text-slate-200">{materials.length}</span> of <span className="font-extrabold text-slate-200">{totalItems}</span> items
            </span>
            <div className="flex gap-1.5 items-center">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold uppercase text-slate-300 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
              >
                Prev
              </button>
              
              <div className="flex items-center gap-1.5 px-3 py-1">
                <span className="text-slate-400">Page</span>
                <span className="font-mono font-bold text-amber-500">{page}</span>
                <span className="text-slate-400">of</span>
                <span className="font-mono font-bold text-slate-300">{totalPages}</span>
              </div>

              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold uppercase text-slate-300 disabled:opacity-30 disabled:pointer-events-none hover:bg-white/10 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Create / Edit Modal Dialog */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel w-full max-w-lg rounded-3xl p-6 md:p-8 relative glow-border-active shadow-2xl">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-200 text-lg transition-colors p-1"
            >
              ✕
            </button>

            <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
              {modalMode === 'create' ? 'Create Material Record' : 'Edit Material Record'}
            </span>
            <h2 className="text-xl font-extrabold text-slate-100 mt-1 mb-6">
              {modalMode === 'create' ? 'Add New Catalog Entry' : 'Modify Catalog Entry'}
            </h2>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Main Head (Category) <span className="text-amber-500">*</span>
                </label>
                <input
                  type="text"
                  name="Material_Main_Head"
                  value={formData.Material_Main_Head}
                  onChange={handleFormChange}
                  placeholder="e.g. Raw Materials"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Sub Head (Sub category) <span className="text-amber-500">*</span>
                </label>
                <input
                  type="text"
                  name="Material_Sub_Head"
                  value={formData.Material_Sub_Head}
                  onChange={handleFormChange}
                  placeholder="e.g. Cement (OPC/PPC)"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Material Description / Details <span className="text-amber-500">*</span>
                </label>
                <textarea
                  name="Material_Details"
                  value={formData.Material_Details}
                  onChange={handleFormChange}
                  placeholder="Enter detailed description of the material size, grade, brand info..."
                  rows="3"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Unit of Measurement <span className="text-amber-500">*</span>
                </label>
                <input
                  type="text"
                  name="M_Unit"
                  value={formData.M_Unit}
                  onChange={handleFormChange}
                  placeholder="e.g. Bag, Cum / CFT, Kg"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <input
                  type="checkbox"
                  id="is_active"
                  name="is_active"
                  checked={formData.is_active}
                  onChange={handleFormChange}
                  className="h-4 w-4 bg-white/5 border border-white/10 rounded focus:ring-0 accent-amber-500"
                />
                <label htmlFor="is_active" className="text-xs text-slate-300 font-bold cursor-pointer select-none">
                  Available for Operations (Active status)
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-6 border-t border-white/5 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 bg-white/5 border border-white/10 text-slate-300 font-bold text-xs uppercase rounded-xl hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-extrabold text-xs uppercase rounded-xl shadow-lg transition-all duration-200"
                >
                  {modalMode === 'create' ? 'Create Record' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialMaster;
