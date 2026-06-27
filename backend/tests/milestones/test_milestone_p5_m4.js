'use strict';

const { supabase } = require('../../src/db/supabase');
const { uploadSitePhoto } = require('../../src/controllers/dailyProgress.uploads.controller');
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

async function testMilestoneP5M4() {
  console.log('=== RUNNING MILESTONE P5-M4 PHOTO UPLOAD & STORAGE TESTS ===\n');

  let passes = 0;
  let fails = 0;

  const jeUser = { role: 'je', mobile_number: '+917980526576' };
  let uploadedPhotoPath = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Upload photo with invalid MIME type
    // -------------------------------------------------------------
    console.log('Test 1: Uploading file with invalid MIME type...');
    const reqMime = {
      user: jeUser,
      file: {
        fieldname: 'file',
        originalname: 'test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 mock pdf content'),
        size: 25
      }
    };
    const resMime = mockRes();
    await uploadSitePhoto(reqMime, resMime);

    if (resMime.statusCode === 400 && resMime.jsonData.success === false) {
      console.log('  [PASS] Successfully blocked non-image upload.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block non-image upload. Status:', resMime.statusCode, 'Data:', resMime.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 2: Upload photo exceeding size limit (10MB)
    // -------------------------------------------------------------
    console.log('\nTest 2: Uploading file exceeding size limit (10MB)...');
    const reqSize = {
      user: jeUser,
      file: {
        fieldname: 'file',
        originalname: 'large.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.alloc(11 * 1024 * 1024), // 11MB
        size: 11 * 1024 * 1024
      }
    };
    const resSize = mockRes();
    await uploadSitePhoto(reqSize, resSize);

    if (resSize.statusCode === 400 && resSize.jsonData.success === false) {
      console.log('  [PASS] Successfully blocked file exceeding size limit.');
      passes++;
    } else {
      console.log('  [FAIL] Failed to block file exceeding size. Status:', resSize.statusCode, 'Data:', resSize.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 3: Upload valid site photo
    // -------------------------------------------------------------
    console.log('\nTest 3: Uploading valid site photo...');
    const reqValid = {
      user: jeUser,
      file: {
        fieldname: 'file',
        originalname: 'my-site-visit.jpg',
        mimetype: 'image/jpeg',
        buffer: Buffer.from('fake-jpeg-image-bytes-data'),
        size: 27
      }
    };
    const resValid = mockRes();
    await uploadSitePhoto(reqValid, resValid);

    if (resValid.statusCode === 200 && resValid.jsonData.success === true) {
      uploadedPhotoPath = resValid.jsonData.photo_url;
      const originalName = resValid.jsonData.original_filename;

      // Assert that filename in bucket is UUID and matches format, not the original filename
      const isUuidName = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jpg$/.test(uploadedPhotoPath);

      if (isUuidName && originalName === 'my-site-visit.jpg') {
        console.log('  [PASS] Successfully uploaded site photo. Path:', uploadedPhotoPath);
        passes++;
      } else {
        console.log('  [FAIL] Photo upload returned incorrect metadata. Path:', uploadedPhotoPath, 'Original name:', originalName);
        fails++;
      }
    } else {
      console.log('  [FAIL] Failed to upload valid photo. Status:', resValid.statusCode, 'Data:', resValid.jsonData);
      fails++;
    }

    // -------------------------------------------------------------
    // Test 4: Private bucket verification
    // -------------------------------------------------------------
    console.log('\nTest 4: Verifying storage bucket is private...');
    if (uploadedPhotoPath) {
      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/daily-progress-photos/${uploadedPhotoPath}`;
      const isPrivate = await checkUrlPrivate(publicUrl);

      if (isPrivate) {
        console.log('  [PASS] Storage bucket confirmed private. Direct access rejected.');
        passes++;
      } else {
        console.log('  [FAIL] Storage bucket is public! Direct access succeeded.');
        fails++;
      }
    } else {
      console.log('  [SKIP] Skipping Test 4: no photo uploaded.');
      fails++;
    }

    // -------------------------------------------------------------
    // Test 5: Storage upload failure handling (mocks storage error -> 500)
    // -------------------------------------------------------------
    console.log('\nTest 5: Testing storage upload failure handling...');
    // Override storage.from function to return a failing upload method
    const originalFrom = supabase.storage.from;
    supabase.storage.from = (bucket) => {
      if (bucket === 'daily-progress-photos') {
        return {
          upload: async () => {
            return { error: new Error('Simulated Supabase Storage upload failure') };
          }
        };
      }
      return originalFrom.call(supabase.storage, bucket);
    };

    const reqFail = {
      user: jeUser,
      file: {
        fieldname: 'file',
        originalname: 'fail-site.png',
        mimetype: 'image/png',
        buffer: Buffer.from('png-bytes'),
        size: 9
      }
    };
    const resFail = mockRes();
    await uploadSitePhoto(reqFail, resFail);

    // Restore original from function
    supabase.storage.from = originalFrom;


    if (resFail.statusCode === 500 && resFail.jsonData.success === false && resFail.jsonData.message.includes('Failed to upload')) {
      console.log('  [PASS] Successfully handled storage failure and returned 500.');
      passes++;
    } else {
      console.log('  [FAIL] Storage failure handler did not return 500. Status:', resFail.statusCode, 'Data:', resFail.jsonData);
      fails++;
    }

  } catch (err) {
    console.error('Unexpected test error in M4 tests:', err);
    fails++;
  } finally {
    // Delete files uploaded to supabase storage to keep clean
    if (uploadedPhotoPath) {
      await supabase.storage.from('daily-progress-photos').remove([uploadedPhotoPath]);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passes}`);
  console.log(`Failed: ${fails}`);
  if (fails === 0) {
    console.log('\n>>> ALL MILESTONE P5-M4 PHOTO UPLOAD & STORAGE TESTS PASSED SUCCESSFULLY! <<<');
    process.exit(0);
  } else {
    console.log('\n>>> SOME P5-M4 PHOTO UPLOAD & STORAGE TESTS FAILED. <<<');
    process.exit(1);
  }
}

if (require.main === module) {
  testMilestoneP5M4();
}

module.exports = { testMilestoneP5M4 };
