const {
  getMaterials,
  getMaterialById,
  createMaterial,
  updateMaterial,
  updateMaterialStatus
} = require('../../src/controllers/materials.controller');
const { supabase } = require('../../src/db/supabase');

// Mock response object helper
function mockRes() {
  const res = {
    statusCode: 200,
    jsonData: null,
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.jsonData = data;
      return this;
    }
  };
  return res;
}

async function testPhase2a() {
  console.log('=== RUNNING PHASE 2A MATERIAL MASTER BACKEND TESTS ===\n');

  let passes = 0;
  let fails = 0;

  let testMaterialId = null;

  try {
    // 1. Test GET /api/materials for Non-Admin (should only see active) + verify pagination metadata
    console.log('1. Testing getMaterials for Project Manager / Staff (Non-Admin) and verifying pagination...');
    const req1 = {
      user: { role: 'project_manager', mobile_number: '+919999999999' },
      query: { page: 1, limit: 5 }
    };
    const res1 = mockRes();
    await getMaterials(req1, res1);

    if (
      res1.statusCode === 200 &&
      res1.jsonData.success &&
      res1.jsonData.materials.length > 0 &&
      res1.jsonData.pagination.page === 1 &&
      res1.jsonData.pagination.limit === 5 &&
      res1.jsonData.pagination.totalItems !== undefined &&
      res1.jsonData.pagination.totalPages !== undefined
    ) {
      console.log(`  [PASS] Successfully retrieved ${res1.jsonData.materials.length} active materials.`);
      console.log(`         Page: ${res1.jsonData.pagination.page}, Limit: ${res1.jsonData.pagination.limit}, Total Items: ${res1.jsonData.pagination.totalItems}`);
      passes++;
    } else {
      console.log(`  [FAIL] Failed to retrieve materials or pagination metadata was incorrect. Status: ${res1.statusCode}`, res1.jsonData);
      fails++;
    }

    // 2. Test createMaterial for Admin
    console.log('\n2. Testing createMaterial for Admin...');
    const req2 = {
      user: { role: 'admin', mobile_number: '+918276071523' },
      body: {
        Material_Main_Head: 'Test Main Head',
        Material_Sub_Head: 'Test Sub Head',
        Material_Details: 'Test Details Description',
        M_Unit: 'Nos',
        is_active: true
      }
    };
    const res2 = mockRes();
    await createMaterial(req2, res2);

    if (res2.statusCode === 201 && res2.jsonData.success) {
      testMaterialId = res2.jsonData.material.id;
      console.log(`  [PASS] Created material successfully. ID: ${testMaterialId}`);
      passes++;
    } else {
      console.log(`  [FAIL] Failed to create material. Status: ${res2.statusCode}`, res2.jsonData);
      fails++;
    }

    // 3. Test createMaterial validation for Admin (missing fields)
    console.log('\n3. Testing createMaterial validation (missing fields)...');
    const req3 = {
      user: { role: 'admin', mobile_number: '+918276071523' },
      body: {
        Material_Main_Head: 'Test Main Head' // Missing other fields
      }
    };
    const res3 = mockRes();
    await createMaterial(req3, res3);

    if (res3.statusCode === 400 && !res3.jsonData.success) {
      console.log('  [PASS] Successfully rejected missing fields.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 400, got: ${res3.statusCode}`);
      fails++;
    }

    // 4. Test RBAC: createMaterial for Non-Admin (should fail)
    console.log('\n4. Testing createMaterial for Project Manager (Should fail)...');
    const req4 = {
      user: { role: 'project_manager', mobile_number: '+919999999999' },
      body: {
        Material_Main_Head: 'Test Main Head',
        Material_Sub_Head: 'Test Sub Head',
        Material_Details: 'Test Details',
        M_Unit: 'Nos'
      }
    };
    const res4 = mockRes();
    await createMaterial(req4, res4);

    if (res4.statusCode === 403 && !res4.jsonData.success) {
      console.log('  [PASS] Correctly blocked non-admin user.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 403, got: ${res4.statusCode}`);
      fails++;
    }

    // 5. Test Invalid UUID formats
    console.log('\n5. Testing GET /materials/not-a-uuid (Invalid UUID check)...');
    const req5a = {
      user: { role: 'project_manager', mobile_number: '+919999999999' },
      params: { id: 'not-a-uuid' }
    };
    const res5a = mockRes();
    await getMaterialById(req5a, res5a);

    if (res5a.statusCode === 400 && !res5a.jsonData.success && res5a.jsonData.message.includes('UUID')) {
      console.log('  [PASS] Correctly returned 400 Bad Request for malformed UUID.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 400 with UUID error message, got: ${res5a.statusCode}`, res5a.jsonData);
      fails++;
    }

    // 6. Test Material Not Found (Random valid UUID format)
    console.log('\n6. Testing GET /materials/{non-existent-uuid} (Material Not Found)...');
    const req6a = {
      user: { role: 'project_manager', mobile_number: '+919999999999' },
      params: { id: '00000000-0000-0000-0000-000000000000' }
    };
    const res6a = mockRes();
    await getMaterialById(req6a, res6a);

    if (res6a.statusCode === 404 && !res6a.jsonData.success) {
      console.log('  [PASS] Correctly returned 404 for nonexistent UUID.');
      passes++;
    } else {
      console.log(`  [FAIL] Expected 404, got: ${res6a.statusCode}`);
      fails++;
    }

    if (testMaterialId) {
      // 7. Test getMaterialById
      console.log('\n7. Testing getMaterialById...');
      const req7 = {
        user: { role: 'project_manager', mobile_number: '+919999999999' },
        params: { id: testMaterialId }
      };
      const res7 = mockRes();
      await getMaterialById(req7, res7);

      if (res7.statusCode === 200 && res7.jsonData.success && res7.jsonData.material.Material_Details === 'Test Details Description') {
        console.log('  [PASS] Successfully retrieved material by ID.');
        passes++;
      } else {
        console.log(`  [FAIL] Failed to retrieve by ID. Status: ${res7.statusCode}`);
        fails++;
      }

      // 8. Test updateMaterial for Admin & verify edited_by
      console.log('\n8. Testing updateMaterial and checking if edited_by metadata is correctly stored...');
      const req8 = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: testMaterialId },
        body: {
          Material_Main_Head: 'Updated Main Head',
          Material_Sub_Head: 'Updated Sub Head',
          Material_Details: 'Updated Details Description',
          M_Unit: 'Kg',
          is_active: true
        }
      };
      const res8 = mockRes();
      await updateMaterial(req8, res8);

      if (res8.statusCode === 200 && res8.jsonData.success) {
        // Query DB directly to confirm updated fields and edited_by metadata
        const { data: dbRecord, error: dbErr } = await supabase
          .from('material_master')
          .select('edited_by, M_Unit')
          .eq('id', testMaterialId)
          .single();

        if (!dbErr && dbRecord && dbRecord.edited_by === '+918276071523' && dbRecord.M_Unit === 'Kg') {
          console.log('  [PASS] Verified update was successful and edited_by was set correctly in database.');
          passes++;
        } else {
          console.log('  [FAIL] Direct database verification failed:', dbRecord, dbErr);
          fails++;
        }
      } else {
        console.log(`  [FAIL] Failed to update material. Status: ${res8.statusCode}`);
        fails++;
      }

      // 9. Test updateMaterialStatus for Admin (deactivate/disable)
      console.log('\n9. Testing updateMaterialStatus for Admin (deactivate)...');
      const req9 = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: testMaterialId },
        body: { is_active: false }
      };
      const res9 = mockRes();
      await updateMaterialStatus(req9, res9);

      if (res9.statusCode === 200 && res9.jsonData.success && res9.jsonData.material.is_active === false) {
        console.log('  [PASS] Successfully disabled/deactivated material.');
        passes++;
      } else {
        console.log(`  [FAIL] Failed to update status. Status: ${res9.statusCode}`);
        fails++;
      }

      // 10. Test Non-Admin cannot see inactive material
      console.log('\n10. Testing Non-Admin cannot retrieve inactive material by ID...');
      const req10 = {
        user: { role: 'project_manager', mobile_number: '+919999999999' },
        params: { id: testMaterialId }
      };
      const res10 = mockRes();
      await getMaterialById(req10, res10);

      if (res10.statusCode === 403 && !res10.jsonData.success) {
        console.log('  [PASS] Correctly blocked non-admin from reading inactive material.');
        passes++;
      } else {
        console.log(`  [FAIL] Expected 403, got status: ${res10.statusCode}`);
        fails++;
      }

      // 11. Test Admin CAN read inactive material
      console.log('\n11. Testing Admin CAN retrieve inactive material by ID...');
      const req11 = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: testMaterialId }
      };
      const res11 = mockRes();
      await getMaterialById(req11, res11);

      if (res11.statusCode === 200 && res11.jsonData.success && res11.jsonData.material.is_active === false) {
        console.log('  [PASS] Admin successfully retrieved inactive material by ID.');
        passes++;
      } else {
        console.log(`  [FAIL] Admin was blocked or retrieval failed. Status: ${res11.statusCode}`);
        fails++;
      }

      // 12. Test search filter
      console.log('\n12. Testing search query parameter on getMaterials...');
      const req12 = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        query: { search: 'Updated Details Description' }
      };
      const res12 = mockRes();
      await getMaterials(req12, res12);

      if (res12.statusCode === 200 && res12.jsonData.materials.length === 1 && res12.jsonData.materials[0].id === testMaterialId) {
        console.log('  [PASS] Successfully searched and found the target material.');
        passes++;
      } else {
        console.log(`  [FAIL] Search failed. Count: ${res12.jsonData?.materials?.length}`);
        fails++;
      }

      // 13. Verify audit logs & verify actual audit payload changes
      console.log('\n13. Testing Audit Log records and validating payload contents...');
      const { data: auditLogs, error: auditErr } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', testMaterialId)
        .order('timestamp', { ascending: true });

      if (auditErr) {
        console.log('  [FAIL] Error fetching audit logs:', auditErr);
        fails++;
      } else {
        const actions = auditLogs.map(l => l.action);
        console.log('      Found audit actions:', actions);
        
        const hasCreate = actions.includes('CREATE');
        const hasEdit = actions.includes('EDIT');
        const hasStatusChange = actions.includes('STATUS_CHANGE');

        // Verify CREATE payload
        const createRecord = auditLogs.find(l => l.action === 'CREATE');
        const isCreateValid = createRecord && createRecord.new_value && createRecord.new_value.Material_Details === 'Test Details Description';

        // Verify EDIT payload
        const editRecord = auditLogs.find(l => l.action === 'EDIT');
        const isEditValid = editRecord &&
          editRecord.old_value && editRecord.old_value.M_Unit === 'Nos' &&
          editRecord.new_value && editRecord.new_value.M_Unit === 'Kg' &&
          editRecord.new_value.Material_Details === 'Updated Details Description';

        // Verify STATUS_CHANGE payload
        const statusRecord = auditLogs.find(l => l.action === 'STATUS_CHANGE');
        const isStatusValid = statusRecord &&
          statusRecord.old_value && statusRecord.old_value.is_active === true &&
          statusRecord.new_value && statusRecord.new_value.is_active === false;

        if (hasCreate && hasEdit && hasStatusChange && isCreateValid && isEditValid && isStatusValid) {
          console.log('  [PASS] Verified CREATE, EDIT, and STATUS_CHANGE audit records AND verified all payload changes in database.');
          passes++;
        } else {
          console.log('  [FAIL] Audit log payload mismatch:', {
            hasCreate, hasEdit, hasStatusChange,
            isCreateValid, isEditValid, isStatusValid
          });
          fails++;
        }
      }

      // Clean up test material
      console.log('\nCleaning up test material...');
      await supabase.from('material_master').delete().eq('id', testMaterialId);
      console.log('Test material cleaned up.');
    }

  } catch (err) {
    console.error('Unexpected error during test execution:', err);
    fails++;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}/${passes + fails}`);
  console.log(`Failed: ${fails}/${passes + fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MATERIAL MASTER BACKEND TESTS PASSED SUCCESSFULLY! <<<');
  } else {
    console.log('\n>>> SOME TESTS FAILED. CHECK SYSTEM INTEGRITY. <<<');
  }
}

testPhase2a();
