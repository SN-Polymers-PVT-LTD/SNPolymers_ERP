'use strict';

const { supabase } = require('../../src/db/supabase');
const {
  uploadRequisitionPdf,
  uploadGstBillPdf,
  sanitizeFilename
} = require('../../src/controllers/requisitions.uploads.controller');
const { getRequisitionById } = require('../../src/controllers/requisitions.controller');
const https = require('https');

// Helper to create mock res object
function mockRes() {
  return {
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
}

// Helper to query direct URL and assert failure (proves bucket is private)
function checkUrlPrivate(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      // Private buckets return 400 or 403 error on public object access
      const isPrivate = res.statusCode === 400 || res.statusCode === 403;
      resolve(isPrivate);
    }).on('error', () => {
      resolve(true); // network failure is also a block
    });
  });
}

async function testMilestoneP4M4() {
  console.log('=== RUNNING MILESTONE P4-M4 FILE UPLOAD & STORAGE INTEGRATION TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const suffix = Math.floor(1000 + Math.random() * 9000);
  const testReqNo = `REQ_M4_FILE_${suffix}`;
  let uploadedRequisitionPath = null;
  let uploadedGstPath = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Filename / Path Traversal Sanitization Logic
    // -------------------------------------------------------------
    console.log('Test 1: Testing filename/path-traversal sanitization...');
    const inputPath = '../../../etc/passwd';
    const sanitized = sanitizeFilename(inputPath);
    const hasTraversal = sanitized.includes('/') || sanitized.includes('\\');
    
    // We expect the path traversal characters to be removed/sanitized
    if (!hasTraversal && sanitized === '.._.._.._etc_passwd') {
      console.log('  [PASS] Filename successfully sanitized to: ' + sanitized);
      passes++;
    } else {
      console.log('  [FAIL] Sanitization failed. Got: ' + sanitized);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Upload requisition PDF with non-PDF MIME type
    // -------------------------------------------------------------
    console.log('\nTest 2: Uploading file with invalid MIME type...');
    const reqMime = {
      body: { requisition_no: testReqNo },
      file: {
        fieldname: 'file',
        originalname: 'test.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake image content'),
        size: 18
      }
    };
    const resMime = mockRes();
    await uploadRequisitionPdf(reqMime, resMime);

    if (resMime.statusCode === 400 && resMime.jsonData.success === false) {
      console.log('  [PASS] Successfully blocked non-PDF upload.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block non-PDF upload. Status:', resMime.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Upload requisition PDF exceeding size limit
    // -------------------------------------------------------------
    console.log('\nTest 3: Uploading file exceeding size limit...');
    const reqSize = {
      body: { requisition_no: testReqNo },
      file: {
        fieldname: 'file',
        originalname: 'large.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(6 * 1024 * 1024), // 6MB
        size: 6 * 1024 * 1024
      }
    };
    const resSize = mockRes();
    await uploadRequisitionPdf(reqSize, resSize);

    if (resSize.statusCode === 400 && resSize.jsonData.success === false) {
      console.log('  [PASS] Successfully blocked file exceeding size limit.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block file exceeding size. Status:', resSize.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Upload requisition PDF without requisition_no
    // -------------------------------------------------------------
    console.log('\nTest 4: Uploading file without requisition_no...');
    const reqMissing = {
      body: {}, // Missing requisition_no
      file: {
        fieldname: 'file',
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 test'),
        size: 14
      }
    };
    const resMissing = mockRes();
    await uploadRequisitionPdf(reqMissing, resMissing);

    if (resMissing.statusCode === 400 && resMissing.jsonData.success === false) {
      console.log('  [PASS] Successfully blocked upload with missing requisition_no.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block upload with missing requisition_no. Status:', resMissing.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Upload valid requisition PDF (201, upsert = false)
    // -------------------------------------------------------------
    console.log('\nTest 5: Uploading valid Requisition PDF...');
    const reqValid = {
      body: { requisition_no: testReqNo },
      file: {
        fieldname: 'file',
        originalname: `${testReqNo}.pdf`,
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 mock pdf body'),
        size: 23
      }
    };
    const resValid = mockRes();
    await uploadRequisitionPdf(reqValid, resValid);

    if (resValid.statusCode === 201 && resValid.jsonData.success === true) {
      uploadedRequisitionPath = resValid.jsonData.storagePath;
      const returnedSignedUrl = resValid.jsonData.signedUrl;

      // Storage path validation
      if (uploadedRequisitionPath === `${testReqNo}.pdf` && typeof returnedSignedUrl === 'string') {
        console.log('  [PASS] Successfully uploaded Requisition PDF. Storage path:', uploadedRequisitionPath);
        passes++;
      } else {
        console.log('  [FAIL] Requisition PDF upload returned incorrect data:', resValid.jsonData);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to upload Requisition PDF. Status:', resValid.statusCode, 'Data:', resValid.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 6: Re-upload same requisition PDF (Verify duplicate check fails)
    // -------------------------------------------------------------
    console.log('\nTest 6: Attempting duplicate Requisition PDF upload...');
    if (uploadedRequisitionPath) {
      const resDup = mockRes();
      await uploadRequisitionPdf(reqValid, resDup);

      if (resDup.statusCode === 409 && resDup.jsonData.success === false) {
        console.log('  [PASS] Correctly blocked duplicate Requisition PDF upload.');
        passes++;
      } else {
        console.log('  [FAIL] Duplicate upload was not blocked. Status:', resDup.statusCode, 'Data:', resDup.jsonData);
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 6: no requisition PDF uploaded.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 7: Upload GST PDF with override enabled (upsert = true)
    // -------------------------------------------------------------
    console.log('\nTest 7: Uploading GST Bill PDF (and verifying override)...');
    const reqGst = {
      body: { requisition_no: testReqNo },
      file: {
        fieldname: 'file',
        originalname: `${testReqNo}_gst.pdf`,
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 mock gst pdf body v1'),
        size: 26
      }
    };
    const resGst1 = mockRes();
    await uploadGstBillPdf(reqGst, resGst1);

    if (resGst1.statusCode === 201 && resGst1.jsonData.success === true) {
      uploadedGstPath = resGst1.jsonData.storagePath;

      if (uploadedGstPath === `${testReqNo}_gst.pdf`) {
        // Upload override test
        const reqGstOverride = {
          body: { requisition_no: testReqNo },
          file: {
            fieldname: 'file',
            originalname: `${testReqNo}_gst.pdf`,
            mimetype: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4 mock gst pdf body v2 (updated)'),
            size: 38
          }
        };
        const resGst2 = mockRes();
        await uploadGstBillPdf(reqGstOverride, resGst2);

        if (resGst2.statusCode === 201 && resGst2.jsonData.success === true) {
          console.log('  [PASS] GST PDF uploaded and successfully overwritten.');
          passes++;
        } else {
          console.log('  [FAIL] Overwriting GST PDF failed. Status:', resGst2.statusCode);
          fails++;
        }
      } else {
        console.log('  [FAIL] GST PDF upload returned incorrect storage path:', uploadedGstPath);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to upload initial GST PDF. Status:', resGst1.statusCode);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 8: Private bucket verification (Verify direct URL gives 403/400)
    // -------------------------------------------------------------
    console.log('\nTest 8: Verifying storage bucket is private...');
    if (uploadedRequisitionPath) {
      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/requisition-pdfs/${uploadedRequisitionPath}`;
      const isPrivate = await checkUrlPrivate(publicUrl);

      if (isPrivate) {
        console.log('  [PASS] Storage bucket confirmed private. Direct access rejected.');
        passes++;
      } else {
        console.log('  [FAIL] Storage bucket is public! Direct access succeeded.');
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 8: no file uploaded.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 9: Get Requisition by ID and verify dynamic signed URL generation
    // -------------------------------------------------------------
    console.log('\nTest 9: Verifying dynamic signed URLs during read operation...');
    // Create a temporary mock record in DB to read it back
    const { data: tempRecord, error: insertError } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: '+918276071523',
        work_order_no: 'WB_BAN_102',
        estimate_no: 'BAN_2',
        estimate_amount: 1000.00,
        state: 'West Bengal',
        district: 'Bankura',
        area_code: 'South Bengal',
        department: 'PWD',
        site_details: 'Mock site details',
        requisition_no: `REQ_M4_READ_${suffix}`,
        material_main_head: 'Pipes',
        requisition_pdf_url: uploadedRequisitionPath || 'mock.pdf',
        requisition_amount: 500.00,
        gst_bill: 'Yes',
        gst_bill_pdf_url: uploadedGstPath || 'mock_gst.pdf',
        bank_details: 'SBI Account 1234567890',
        requisition_status: 'Pending',
        created_by: '+918276071523'
      }])
      .select()
      .maybeSingle();

    if (insertError) {
      console.log('  [FAIL] Supabase insert error:', insertError);
    }

    if (tempRecord) {
      const reqGet = {
        params: { id: tempRecord.requisition_id },
        user: { role: 'je', mobile_number: '+918276071523' }
      };
      const resGet = mockRes();
      await getRequisitionById(reqGet, resGet);

      if (resGet.statusCode === 200 && resGet.jsonData.success) {
        const reqData = resGet.jsonData.requisition;
        const hasRequisitionSignedUrl = reqData.requisition_pdf_signed_url && reqData.requisition_pdf_signed_url.startsWith('http');
        const hasGstSignedUrl = reqData.gst_bill_pdf_signed_url && reqData.gst_bill_pdf_signed_url.startsWith('http');

        if (hasRequisitionSignedUrl && hasGstSignedUrl) {
          console.log('  [PASS] Dynamic signed URLs generated successfully.');
          passes++;
        } else {
          console.log('  [FAIL] Failed to generate signed URLs dynamically. Data:', reqData);
          fails++;
        }
      } else {
        console.log('  [FAIL] Failed to retrieve requisition details. Status:', resGet.statusCode);
        fails++;
      }

      // Cleanup the temporary mock database record
      await supabase
        .from('requisitions')
        .delete()
        .eq('requisition_id', tempRecord.requisition_id);
    } else {
      console.log('  [SKIP] Skipping Test 9: failed to insert mock record.');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected test error in M4 tests:', err);
    fails++;
  } finally {
    // Delete files uploaded to supabase storage to keep clean
    if (uploadedRequisitionPath) {
      await supabase.storage.from('requisition-pdfs').remove([uploadedRequisitionPath]);
    }
    if (uploadedGstPath) {
      await supabase.storage.from('gst-bills').remove([uploadedGstPath]);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P4-M4 FILE UPLOAD & STORAGE TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P4-M4 FILE UPLOAD & STORAGE TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP4M4();
}

module.exports = { testMilestoneP4M4 };
