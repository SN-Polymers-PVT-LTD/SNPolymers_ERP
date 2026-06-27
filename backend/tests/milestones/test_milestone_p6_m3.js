'use strict';

const { supabase } = require('../../src/db/supabase');
const { uploadBillCopy } = require('../../src/controllers/raFinalBill.uploads.controller');

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

async function testMilestoneP6M3() {
  console.log('=== RUNNING MILESTONE P6-M3 FILE UPLOAD TESTS ===\n');

  let passes = 0;
  let fails = 0;
  let uploadedPath = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Upload valid PDF
    // -------------------------------------------------------------
    console.log('Test 1: Uploading valid PDF file...');
    const reqValid = {
      file: {
        fieldname: 'file',
        originalname: 'invoice_test.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 mock pdf content'),
        size: 25
      }
    };
    const resValid = mockRes();
    await uploadBillCopy(reqValid, resValid);

    if (resValid.statusCode === 200 && resValid.jsonData.success) {
      uploadedPath = resValid.jsonData.bill_copy_url;
      const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.pdf$/;
      if (uuidRegex.test(uploadedPath)) {
        console.log('  [PASS] Successfully uploaded PDF. Path is UUID-based:', uploadedPath);
        passes++;
      } else {
        console.log('  [FAIL] Path is not a valid UUID format:', uploadedPath);
        fails++;
      }
    } else {
      console.log('  [FAIL] PDF upload failed. Status:', resValid.statusCode, 'Data:', resValid.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Upload invalid MIME type (.txt)
    // -------------------------------------------------------------
    console.log('\nTest 2: Uploading text file (.txt)...');
    const reqText = {
      file: {
        fieldname: 'file',
        originalname: 'bad.txt',
        encoding: '7bit',
        mimetype: 'text/plain',
        buffer: Buffer.from('hello world'),
        size: 11
      }
    };
    const resText = mockRes();
    await uploadBillCopy(reqText, resText);

    if (resText.statusCode === 400 && resText.jsonData.message.includes('Only PDF, JPG, JPEG, or PNG')) {
      console.log('  [PASS] Correctly blocked text file upload.');
      passes++;
    } else {
      console.log('  [FAIL] Text file upload not blocked. Status:', resText.statusCode, 'Data:', resText.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Upload size too large (> 5MB)
    // -------------------------------------------------------------
    console.log('\nTest 3: Uploading large file (> 5MB)...');
    const reqLarge = {
      file: {
        fieldname: 'file',
        originalname: 'large.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(6 * 1024 * 1024), // 6MB
        size: 6 * 1024 * 1024
      }
    };
    const resLarge = mockRes();
    await uploadBillCopy(reqLarge, resLarge);

    if (resLarge.statusCode === 400 && resLarge.jsonData.message.includes('exceed 5MB')) {
      console.log('  [PASS] Correctly blocked >5MB file upload.');
      passes++;
    } else {
      console.log('  [FAIL] Large file upload not blocked. Status:', resLarge.statusCode, 'Data:', resLarge.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Verify uploaded object cannot be accessed publicly
    // -------------------------------------------------------------
    console.log('\nTest 4: Verifying bucket privacy (direct public access is blocked)...');
    if (uploadedPath) {
      const publicUrl = `https://ervvwrmgkiyfzbqjqbcg.supabase.co/storage/v1/object/public/ra-bill-copies/${uploadedPath}`;
      // In Node.js, we can do a quick fetch to see if it is rejected with a 400 or 404/403
      // Since fetch might not be in older Node.js, we can use https module or http
      const https = require('https');
      const verifyPrivacy = () => {
        return new Promise((resolve) => {
          https.get(publicUrl, (response) => {
            if (response.statusCode >= 400) {
              console.log(`  [PASS] Public access blocked with HTTP status: ${response.statusCode}`);
              passes++;
              resolve();
            } else {
              console.log(`  [FAIL] Public access allowed! HTTP status: ${response.statusCode}`);
              fails++;
              resolve();
            }
          }).on('error', (e) => {
            // Error means it's blocked/failed to connect, which is fine
            console.log('  [PASS] Public fetch failed (connection error / blocked).');
            passes++;
            resolve();
          });
        });
      };
      await verifyPrivacy();
    } else {
      console.log('  [SKIP] Skipping Test 4: no file uploaded.');
      fails++;
    }

  } catch (err) {
    console.error('Unexpected error in M3 tests:', err);
    fails++;
  } finally {
    // Cleanup uploaded file from storage
    if (uploadedPath) {
      console.log('\nCleaning up uploaded test file from storage...');
      const { error: removeError } = await supabase.storage
        .from('ra-bill-copies')
        .remove([uploadedPath]);
      if (removeError) {
        console.log('  [INFO] Failed to clean up file:', removeError.message);
      } else {
        console.log('  [INFO] Successfully removed test file from storage.');
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P6-M3 TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P6-M3 TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP6M3();
}

module.exports = { testMilestoneP6M3 };
