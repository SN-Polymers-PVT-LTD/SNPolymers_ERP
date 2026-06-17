const { supabase } = require('../db/supabase');

/**
 * GET /api/materials (and mounted at /api/v1/auth/materials)
 * Fetches all materials with pagination, search, and filtering
 */
async function getMaterials(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit || 50), 1000);
    const offset = (page - 1) * limit;

    const { search, main_head, sub_head, is_active } = req.query;

    const isAdmin = req.user && req.user.role === 'admin';

    let query = supabase
      .from('material_master')
      .select('*', { count: 'exact' });

    // Apply role-based visibility: Non-admins can only see active materials
    if (!isAdmin) {
      query = query.eq('is_active', true);
    } else {
      // Admins can optionally filter by is_active status
      if (is_active !== undefined && is_active !== '') {
        const activeBool = is_active === 'true' || is_active === true;
        query = query.eq('is_active', activeBool);
      }
    }

    // Filters
    if (main_head) {
      query = query.eq('Material_Main_Head', main_head);
    }
    if (sub_head) {
      query = query.eq('Material_Sub_Head', sub_head);
    }

    // Search (case-insensitive search on Material_Main_Head, Material_Sub_Head, Material_Details)
    if (search && search.trim() !== '') {
      const searchPattern = `%${search.trim()}%`;
      query = query.or(
        `Material_Main_Head.ilike.${searchPattern},Material_Sub_Head.ilike.${searchPattern},Material_Details.ilike.${searchPattern}`
      );
    }

    // Sorting - default to Material_Details ascending
    const sortBy = req.query.sortBy || 'Material_Details';
    const sortOrder = req.query.sortOrder || 'asc';
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });

    // Range for pagination
    query = query.range(offset, offset + limit - 1);

    const { data: materials, count, error } = await query;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      materials,
      pagination: {
        totalItems: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error(`getMaterials failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve materials.' });
  }
}

/**
 * GET /api/materials/:id
 * Fetches a single material record by ID
 */
async function getMaterialById(req, res) {
  const { id } = req.params;

  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data: material, error } = await supabase
      .from('material_master')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found.' });
    }

    // Check permissions: Non-admins cannot view inactive materials
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin && !material.is_active) {
      return res.status(403).json({ success: false, message: 'Access denied. Inactive material.' });
    }

    return res.status(200).json({ success: true, material });
  } catch (error) {
    console.error(`getMaterialById failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve material details.' });
  }
}

/**
 * POST /api/materials
 * Creates a new material record (Admin only)
 */
async function createMaterial(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }

  const {
    Material_Main_Head,
    Material_Sub_Head,
    Material_Details,
    M_Unit,
    is_active
  } = req.body;

  // Validation
  if (!Material_Main_Head || !Material_Sub_Head || !Material_Details || !M_Unit) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required (Material_Main_Head, Material_Sub_Head, Material_Details, M_Unit).'
    });
  }

  const activeBool = is_active !== undefined ? (is_active === 'true' || is_active === true) : true;

  try {
    const { data, error } = await supabase
      .from('material_master')
      .insert([
        {
          Material_Main_Head,
          Material_Sub_Head,
          Material_Details,
          M_Unit,
          is_active: activeBool,
          created_by: req.user.mobile_number,
          edited_by: req.user.mobile_number
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      material: data,
      message: 'Material created successfully.'
    });
  } catch (error) {
    console.error(`createMaterial failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create material.' });
  }
}

/**
 * PUT /api/materials/:id
 * Updates a material record (Admin only)
 */
async function updateMaterial(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }

  const { id } = req.params;

  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  const {
    Material_Main_Head,
    Material_Sub_Head,
    Material_Details,
    M_Unit,
    is_active
  } = req.body;

  // Validation
  if (!Material_Main_Head || !Material_Sub_Head || !Material_Details || !M_Unit) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required (Material_Main_Head, Material_Sub_Head, Material_Details, M_Unit).'
    });
  }

  try {
    // 1. Fetch current material to verify existence
    const { data: current, error: fetchErr } = await supabase
      .from('material_master')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current) {
      return res.status(404).json({ success: false, message: 'Material not found.' });
    }

    const activeBool = is_active !== undefined ? (is_active === 'true' || is_active === true) : current.is_active;

    // 2. Perform update
    const { data: updated, error } = await supabase
      .from('material_master')
      .update({
        Material_Main_Head,
        Material_Sub_Head,
        Material_Details,
        M_Unit,
        is_active: activeBool,
        edited_by: req.user.mobile_number
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      material: updated,
      message: 'Material updated successfully.'
    });
  } catch (error) {
    console.error(`updateMaterial failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update material.' });
  }
}

/**
 * PATCH /api/materials/:id/status
 * Disables or changes status of a material record (Admin only)
 */
async function updateMaterialStatus(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }

  const { id } = req.params;

  const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  const { is_active } = req.body;

  // Default to false (deactivate) if not provided, to respect the "disable" design
  const activeBool = is_active !== undefined ? (is_active === 'true' || is_active === true) : false;

  try {
    // 1. Fetch current material to verify existence
    const { data: current, error: fetchErr } = await supabase
      .from('material_master')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current) {
      return res.status(404).json({ success: false, message: 'Material not found.' });
    }

    // 2. Perform update
    const { data: updated, error } = await supabase
      .from('material_master')
      .update({
        is_active: activeBool,
        edited_by: req.user.mobile_number
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      material: updated,
      message: `Material status updated to ${activeBool ? 'Active' : 'Inactive'}.`
    });
  } catch (error) {
    console.error(`updateMaterialStatus failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update material status.' });
  }
}

async function getSubHeadsByMainHead(req, res) {
  try {
    const { main_head } = req.query;
    if (!main_head) {
      return res.status(400).json({ success: false, message: 'main_head query param required.' });
    }
    const isAdmin = req.user && req.user.role === 'admin';
    let query = supabase.from('material_master').select('Material_Sub_Head').limit(1000);
    if (!isAdmin) {
      query = query.eq('is_active', true);
    }
    query = query.eq('Material_Main_Head', main_head);
    const { data, error } = await query;
    if (error) throw error;
    const subHeads = [...new Set(data.map(item => item.Material_Sub_Head).filter(Boolean))].sort();
    return res.status(200).json({ success: true, subHeads });
  } catch (error) {
    console.error(`getSubHeadsByMainHead failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve sub heads.' });
  }
}

async function getMaterialCategories(req, res) {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    let query = supabase.from('material_master').select('Material_Main_Head, Material_Sub_Head');
    
    if (!isAdmin) {
      query = query.eq('is_active', true);
    }
    
    const { data, error } = await query;
    if (error) throw error;

    const mainHeads = [...new Set(data.map(item => item.Material_Main_Head).filter(Boolean))].sort();
    const subHeads = [...new Set(data.map(item => item.Material_Sub_Head).filter(Boolean))].sort();

    return res.status(200).json({ success: true, mainHeads, subHeads });
  } catch (error) {
    console.error(`getMaterialCategories failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve categories.' });
  }
}

module.exports = {
  getMaterials,
  getMaterialById,
  createMaterial,
  updateMaterial,
  updateMaterialStatus,
  getMaterialCategories,
  getSubHeadsByMainHead
};
