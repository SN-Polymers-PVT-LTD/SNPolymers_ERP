const { supabase } = require('../db/supabase');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * GET /api/v1/auth/purchase-data
 * Fetches all purchase options. Admins see all; non-admins see active only.
 * Returns options sorted case-insensitively.
 */
async function getPurchaseOptions(req, res) {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    let query = supabase.from('purchase_data').select('*');

    if (!isAdmin) {
      query = query.eq('is_active', true);
    }

    const { data: options, error } = await query;

    if (error) throw error;

    // Case-insensitive alphabetical sorting in memory
    const sortedOptions = (options || []).sort((a, b) =>
      (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())
    );

    return res.status(200).json({
      success: true,
      purchaseOptions: sortedOptions
    });
  } catch (error) {
    console.error(`getPurchaseOptions failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve purchase options.' });
  }
}

/**
 * POST /api/v1/auth/purchase-data
 * Creates a new purchase option (Admin only).
 * Trims name input and rejects empty values.
 */
async function createPurchaseOption(req, res) {
  const name = req.body.name?.trim();

  if (!name || name.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Purchase option name is required and cannot be blank.'
    });
  }

  try {
    const { data, error } = await supabase
      .from('purchase_data')
      .insert([
        {
          name,
          created_by: req.user.mobile_number
        }
      ])
      .select()
      .single();

    if (error) {
      // Postgres unique constraint violation
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'This purchase option already exists.'
        });
      }
      throw error;
    }

    return res.status(201).json({
      success: true,
      purchaseOption: data,
      message: 'Purchase option created successfully.'
    });
  } catch (error) {
    console.error(`createPurchaseOption failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create purchase option.' });
  }
}

/**
 * PUT /api/v1/auth/purchase-data/:id
 * Updates name of a purchase option (Admin only).
 * Trims input and rejects empty values.
 */
async function updatePurchaseOption(req, res) {
  const { id } = req.params;
  const name = req.body.name?.trim();

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  if (!name || name.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Purchase option name is required and cannot be blank.'
    });
  }

  try {
    const { data, error } = await supabase
      .from('purchase_data')
      .update({ name })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'This purchase option already exists.'
        });
      }
      throw error;
    }

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'Purchase option not found.'
      });
    }

    return res.status(200).json({
      success: true,
      purchaseOption: data,
      message: 'Purchase option updated successfully.'
    });
  } catch (error) {
    console.error(`updatePurchaseOption failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update purchase option.' });
  }
}

/**
 * PATCH /api/v1/auth/purchase-data/:id/status
 * Toggles status (is_active) of a purchase option atomically (Admin only).
 */
async function togglePurchaseOptionStatus(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data, error } = await supabase.rpc('toggle_purchase_option_status', { p_id: id });

    if (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'Purchase option not found.'
        });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      purchaseOption: data,
      message: `Purchase option status updated to ${data.is_active ? 'Active' : 'Inactive'}.`
    });
  } catch (error) {
    console.error(`togglePurchaseOptionStatus failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to toggle purchase option status.' });
  }
}

module.exports = {
  getPurchaseOptions,
  createPurchaseOption,
  updatePurchaseOption,
  togglePurchaseOptionStatus
};
