import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { Button, Input, TextArea, Select, Checkbox, Badge, Modal, Table, TableHeader, TableBody, TableRow, TableCell } from '../components/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMaterials,
  getMaterialCategories,
  createMaterial,
  updateMaterial,
  updateMaterialStatus
} from '../api/materialsApi';
import { exportMaterialsToExcel } from '../utils/exportHelpers';

const MaterialMaster = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const queryClient = useQueryClient();

  // Core Messaging & Modal / Form States
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

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
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);


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
  const displayErrorMsg = errorMsg || (queryError ? 'Failed to load Material Master items. Please try again.' : '');

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

  const handleExportExcel = async () => {
    setExportLoading(true);
    setErrorMsg('');
    try {
      const params = {
        page: 1,
        limit: 1000,
        search: debouncedSearch,
        main_head: mainHeadFilter,
        sub_head: subHeadFilter,
        is_active: activeFilter,
        sortBy,
        sortOrder
      };
      const res = await getMaterials(params);
      const itemsToExport = res.data?.materials || [];
      exportMaterialsToExcel(itemsToExport);
    } catch (err) {
      console.error('Failed to export materials:', err);
      setErrorMsg('Failed to export materials. Please try again.');
    } finally {
      setExportLoading(false);
    }
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
    <>
        
        {/* Module Header */}
        <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Inventory Registry</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Material Master</h1>
            <p className="text-xs text-slate-400 font-medium mt-1">Centralised catalog of construction resources, aggregates, components, and tools.</p>
          </div>
          {isAdmin && (
            <Button
              onClick={openCreateModal}
              variant="amber"
            >
              + Create Material
            </Button>
          )}
        </div>

        {/* Global Notifications */}
        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-xl animate-fade-in">
            {successMsg}
          </div>
        )}
        {displayErrorMsg && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold rounded-xl animate-fade-in">
            {displayErrorMsg}
          </div>
        )}

        {/* Search and Filters Bar */}
        <div className="glass-panel p-4 rounded-2xl mb-6 space-y-4">
          <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3">
            <div className="flex-grow relative">
              <Input
                type="text"
                placeholder="Search by Main Head, Sub Head or Material Details..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                size="sm"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-200 text-xs"
                >
                  Clear
                </button>
              )}
            </div>
            <Button
              type="submit"
              variant="secondary"
              size="sm"
            >
              Search
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleExportExcel}
              disabled={exportLoading}
              className="border border-white/10 text-slate-300 hover:text-white flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {exportLoading ? 'Exporting...' : 'Export Excel'}
            </Button>
          </form>

          {/* Filtering Dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            <Select
              label="Main Head"
              value={mainHeadFilter}
              onChange={(e) => { setMainHeadFilter(e.target.value); setPage(1); }}
              size="sm"
            >
              <option value="">All Categories</option>
              {categories.mainHeads.map((mh) => (
                <option key={mh} value={mh}>{mh}</option>
              ))}
            </Select>

            <Select
              label="Sub Head"
              value={subHeadFilter}
              onChange={(e) => { setSubHeadFilter(e.target.value); setPage(1); }}
              size="sm"
            >
              <option value="">All Sub categories</option>
              {categories.subHeads.map((sh) => (
                <option key={sh} value={sh}>{sh}</option>
              ))}
            </Select>

            {isAdmin && (
              <Select
                label="Operational Status"
                value={activeFilter}
                onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }}
                size="sm"
              >
                <option value="">All Statuses</option>
                <option value="true">Active Materials Only</option>
                <option value="false">Inactive Materials Only</option>
              </Select>
            )}

            <div className="flex items-end">
              <Button
                onClick={handleClearFilters}
                variant="ghost"
                size="sm"
                className="w-full border border-dashed border-white/10 text-slate-400 hover:text-slate-200"
              >
                Reset All Filters
              </Button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="glass-panel rounded-2xl overflow-hidden mb-6">
          <Table>
            <TableHeader className="bg-white/5 text-slate-400">
              <TableRow hover={false} className="text-[10px] select-none">
                <TableCell
                  isHeader={true}
                  onClick={() => handleSort('Material_Main_Head')}
                  className="cursor-pointer hover:text-slate-200 transition-colors"
                >
                  Main Head {sortBy === 'Material_Main_Head' && (sortOrder === 'asc' ? '▲' : '▼')}
                </TableCell>
                <TableCell
                  isHeader={true}
                  onClick={() => handleSort('Material_Sub_Head')}
                  className="cursor-pointer hover:text-slate-200 transition-colors"
                >
                  Sub Head {sortBy === 'Material_Sub_Head' && (sortOrder === 'asc' ? '▲' : '▼')}
                </TableCell>
                <TableCell
                  isHeader={true}
                  onClick={() => handleSort('Material_Details')}
                  className="cursor-pointer hover:text-slate-200 transition-colors"
                >
                  Material Description {sortBy === 'Material_Details' && (sortOrder === 'asc' ? '▲' : '▼')}
                </TableCell>
                <TableCell isHeader={true}>Unit</TableCell>
                {isAdmin && <TableCell isHeader={true} align="center">Status</TableCell>}
                {isAdmin && <TableCell isHeader={true} align="right">Actions</TableCell>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow hover={false}>
                  <TableCell colSpan={isAdmin ? 6 : 4} align="center" className="p-10 text-slate-500 font-medium">
                    <div className="flex justify-center items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                      Loading material registry logs...
                    </div>
                  </TableCell>
                </TableRow>
              ) : materials.length === 0 ? (
                <TableRow hover={false}>
                  <TableCell colSpan={isAdmin ? 6 : 4} align="center" className="p-10 text-slate-500 font-semibold">
                    No materials found matching criteria.
                  </TableCell>
                </TableRow>
              ) : (
                materials.map((material) => (
                  <TableRow
                    key={material.id}
                    className={!material.is_active ? 'opacity-50' : ''}
                  >
                    <TableCell className="font-semibold text-slate-200 max-w-[180px] truncate">{material.Material_Main_Head}</TableCell>
                    <TableCell className="text-slate-300 max-w-[180px] truncate">{material.Material_Sub_Head}</TableCell>
                    <TableCell className="text-slate-100 font-medium max-w-sm whitespace-pre-wrap">{material.Material_Details}</TableCell>
                    <TableCell className="font-mono text-slate-400">{material.M_Unit}</TableCell>
                    {isAdmin && (
                      <TableCell align="center">
                        <button
                          onClick={() => handleToggleStatus(material.id, material.is_active)}
                          className="focus:outline-none"
                        >
                          <Badge
                            variant={material.is_active ? 'emerald' : 'red'}
                            showDot={true}
                          >
                            {material.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </button>
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell align="right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            onClick={() => openEditModal(material)}
                            variant="secondary"
                            size="xs"
                          >
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination Footer */}
          <div className="p-4 bg-white/5 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs select-none">
            <span className="text-slate-400 font-medium">
              Showing <span className="font-extrabold text-slate-200">{materials.length}</span> of <span className="font-extrabold text-slate-200">{totalItems}</span> items
            </span>
            <div className="flex gap-1.5 items-center">
              <Button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                size="xs"
                variant="secondary"
              >
                Prev
              </Button>
              
              <div className="flex items-center gap-1.5 px-3 py-1">
                <span className="text-slate-400">Page</span>
                <span className="font-mono font-bold text-amber-500">{page}</span>
                <span className="text-slate-400">of</span>
                <span className="font-mono font-bold text-slate-300">{totalPages}</span>
              </div>

              <Button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                size="xs"
                variant="secondary"
              >
                Next
              </Button>
            </div>
          </div>
        </div>

      {/* Create / Edit Modal Dialog */}
      {isModalOpen && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={modalMode === 'create' ? 'Create Material Record' : 'Edit Material Record'}
          subtitle={modalMode === 'create' ? 'Add New Catalog Entry' : 'Modify Catalog Entry'}
          size="md"
          footer={
            <div className="flex justify-end gap-3 w-full">
              <Button
                variant="secondary"
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="amber"
                form="material-form"
              >
                {modalMode === 'create' ? 'Create Record' : 'Save Changes'}
              </Button>
            </div>
          }
        >
          <form id="material-form" onSubmit={handleFormSubmit} className="space-y-4 text-left">
            <Input
              label="Main Head (Category)"
              type="text"
              name="Material_Main_Head"
              value={formData.Material_Main_Head}
              onChange={handleFormChange}
              placeholder="e.g. Raw Materials"
              required
              size="sm"
            />

            <Input
              label="Sub Head (Sub category)"
              type="text"
              name="Material_Sub_Head"
              value={formData.Material_Sub_Head}
              onChange={handleFormChange}
              placeholder="e.g. Cement (OPC/PPC)"
              required
              size="sm"
            />

            <TextArea
              label="Material Description / Details"
              name="Material_Details"
              value={formData.Material_Details}
              onChange={handleFormChange}
              placeholder="Enter detailed description of the material size, grade, brand info..."
              rows={3}
              required
              size="sm"
            />

            <Input
              label="Unit of Measurement"
              type="text"
              name="M_Unit"
              value={formData.M_Unit}
              onChange={handleFormChange}
              placeholder="e.g. Bag, Cum / CFT, Kg"
              required
              size="sm"
            />

            <Checkbox
              label="Available for Operations (Active status)"
              id="is_active"
              name="is_active"
              checked={formData.is_active}
              onChange={handleFormChange}
            />
          </form>
        </Modal>
      )}
    </>
  );
};

export default MaterialMaster;
