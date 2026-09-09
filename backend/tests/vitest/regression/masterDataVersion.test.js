import { describe, test, expect, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const { getMasterDataVersion, getMasterDataCatalog } = require('../../../src/controllers/masterData.controller');

// masterData.controller.js's version used to read from a "master_data_versions"
// table that was never actually created by any migration — every call silently
// fell back to a hardcoded version 1, so the frontend's localStorage catalog
// cache (EstimateForm.jsx) never invalidated on new/edited Material Master
// rows. The fix computes the version live from material_master/purchase_data's
// own row count + latest timestamp, so it changes automatically on any write.
describe('Master Data catalog version — live-computed, changes on write', () => {
  let suffix;
  let insertedId;

  afterAll(async () => {
    if (insertedId) {
      await supabase.from('material_master').delete().eq('id', insertedId);
    }
  });

  test('version bumps after inserting a new material row', async () => {
    suffix = crypto.randomUUID().substring(0, 8);

    const req1 = { query: {} };
    const res1 = mockRes();
    await getMasterDataVersion(req1, res1);
    expect(res1.statusCode).toBe(200);
    const versionBefore = res1.jsonData.version;
    expect(typeof versionBefore).toBe('number');

    const { data: inserted, error } = await supabase
      .from('material_master')
      .insert({
        Material_Main_Head: 'Sub Contractor',
        Material_Sub_Head: `Test Sub Head ${suffix}`,
        Material_Details: `Test Subcontractor ${suffix}`,
        M_Unit: 'Lot',
        is_active: true
      })
      .select()
      .single();
    if (error) throw error;
    insertedId = inserted.id;

    const req2 = { query: {} };
    const res2 = mockRes();
    await getMasterDataVersion(req2, res2);
    const versionAfter = res2.jsonData.version;

    expect(versionAfter).not.toBe(versionBefore);
  });

  test('version bumps again after editing that row (edited_at trigger)', async () => {
    const reqBefore = { query: {} };
    const resBefore = mockRes();
    await getMasterDataVersion(reqBefore, resBefore);
    const versionBefore = resBefore.jsonData.version;

    // Ensure the UPDATE lands in a distinct millisecond from the prior INSERT.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const { error } = await supabase
      .from('material_master')
      .update({ M_Unit: 'Nos' })
      .eq('id', insertedId);
    if (error) throw error;

    const reqAfter = { query: {} };
    const resAfter = mockRes();
    await getMasterDataVersion(reqAfter, resAfter);
    const versionAfter = resAfter.jsonData.version;

    expect(versionAfter).not.toBe(versionBefore);
  });

  test('getMasterDataCatalog returns the same version and includes the new active material', async () => {
    const req = { query: {} };
    const res = mockRes();
    await getMasterDataCatalog(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.success).toBe(true);
    expect(typeof res.jsonData.version).toBe('number');

    const subContractorCategory = res.jsonData.categories.find(c => c.name === 'Sub Contractor');
    expect(subContractorCategory).toBeDefined();
    const subHead = subContractorCategory.subHeads.find(sh => sh.name === `Test Sub Head ${suffix}`);
    expect(subHead).toBeDefined();
    expect(subHead.materials.some(m => m.name === `Test Subcontractor ${suffix}`)).toBe(true);
  });
});
