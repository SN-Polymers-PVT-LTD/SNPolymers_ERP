const { supabase } = require('../db/supabase');

/**
 * Live-computed catalog version — no master_data_versions table exists (it
 * never shipped in any migration; the version was always silently falling
 * back to a hardcoded 1, which meant the frontend's localStorage catalog
 * cache never invalidated on new/edited Material Master or Purchase Data
 * rows). Instead of introducing a table that every future write path would
 * have to remember to bump, derive the version from each table's own
 * row count + latest timestamp — it changes automatically on any insert,
 * update, or delete, for every current and future write path, with no
 * separate bookkeeping to keep in sync.
 *
 * material_master has a BEFORE UPDATE trigger (trg_material_master_edited_at)
 * that always sets edited_at on modification, so "latest write" per table is
 * max(latest edited_at, latest created_at) — the two are queried separately
 * since edited_at is nullable and Postgres GREATEST isn't expressible via
 * the Supabase JS query builder.
 */
async function computeMasterDataVersion() {
  const [
    matCountRes,
    matByCreatedRes,
    matByEditedRes,
    purCountRes,
    purByCreatedRes
  ] = await Promise.all([
    supabase.from('material_master').select('id', { count: 'exact', head: true }),
    supabase.from('material_master').select('created_at').order('created_at', { ascending: false }).limit(1),
    supabase.from('material_master').select('edited_at').not('edited_at', 'is', null).order('edited_at', { ascending: false }).limit(1),
    supabase.from('purchase_data').select('id', { count: 'exact', head: true }),
    supabase.from('purchase_data').select('created_at').order('created_at', { ascending: false }).limit(1)
  ]);

  const toMs = (dateStr) => (dateStr ? new Date(dateStr).getTime() : 0);

  const matLatestMs = Math.max(
    toMs(matByCreatedRes.data?.[0]?.created_at),
    toMs(matByEditedRes.data?.[0]?.edited_at)
  );
  const purLatestMs = toMs(purByCreatedRes.data?.[0]?.created_at);

  return (matCountRes.count || 0) + matLatestMs + (purCountRes.count || 0) + purLatestMs;
}

/**
 * GET /api/v1/auth/master-data/version
 * Fetches the current master data catalog version.
 */
async function getMasterDataVersion(req, res) {
  try {
    const version = await computeMasterDataVersion();
    return res.status(200).json({ success: true, version });
  } catch (error) {
    console.error(`getMasterDataVersion failed: ${error.message}`);
    // Safe fallback: forces a refetch on every load rather than risk a stale cache.
    return res.status(200).json({ success: true, version: Date.now() });
  }
}

/**
 * GET /api/v1/auth/master-data/catalog
 * Fetches version, material hierarchy, and purchase sources.
 */
async function getMasterDataCatalog(req, res) {
  try {
    // 1. Compute version (see computeMasterDataVersion — live-derived, no separate table to keep in sync)
    let version;
    try {
      version = await computeMasterDataVersion();
    } catch (verErr) {
      console.warn(`computeMasterDataVersion failed: ${verErr.message}. Falling back to a time-based version.`);
      version = Date.now();
    }

    // 2. Fetch Active Materials
    const { data: materials, error: matErr } = await supabase
      .from('material_master')
      .select('id, Material_Main_Head, Material_Sub_Head, Material_Details, M_Unit')
      .eq('is_active', true);
    
    if (matErr) throw matErr;

    // 3. Fetch Active Purchase Sources
    const { data: purchaseSources, error: purErr } = await supabase
      .from('purchase_data')
      .select('id, name')
      .eq('is_active', true);
    
    if (purErr) throw purErr;

    // 4. Construct hierarchical structure
    // Group by Main Head -> Sub Head -> Material details
    const categoryMap = {};

    (materials || []).forEach(mat => {
      const mainHead = mat.Material_Main_Head;
      const subHead = mat.Material_Sub_Head;

      if (!categoryMap[mainHead]) {
        categoryMap[mainHead] = {
          name: mainHead,
          subHeadsMap: {}
        };
      }

      if (!categoryMap[mainHead].subHeadsMap[subHead]) {
        categoryMap[mainHead].subHeadsMap[subHead] = {
          name: subHead,
          materials: []
        };
      }

      categoryMap[mainHead].subHeadsMap[subHead].materials.push({
        id: mat.id,
        name: mat.Material_Details,
        unit: mat.M_Unit
      });
    });

    const categories = Object.values(categoryMap).map(cat => {
      const subHeads = Object.values(cat.subHeadsMap).map(sub => ({
        name: sub.name,
        materials: sub.materials
      }));
      return {
        name: cat.name,
        subHeads
      };
    });

    return res.status(200).json({
      success: true,
      version,
      categories,
      purchaseSources
    });

  } catch (error) {
    console.error(`getMasterDataCatalog failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve master data catalog.' });
  }
}

module.exports = {
  getMasterDataVersion,
  getMasterDataCatalog
};
