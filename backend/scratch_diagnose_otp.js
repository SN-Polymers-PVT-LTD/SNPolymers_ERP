const { supabase } = require('./src/db/supabase');
const { generateOtp, hashOtp, storeOtp, verifyOtp } = require('./src/services/otp.service');
const bcrypt = require('bcrypt');

const TEST_MOBILE = '+918276071523';

async function runDiagnosis() {
  console.log('=== STARTING OTP DIAGNOSTIC SUITE ===\n');

  console.log(`1. Checking user record for ${TEST_MOBILE}...`);
  const { data: user, error: userErr } = await supabase
    .from('authorised_users')
    .select('*')
    .eq('mobile_number', TEST_MOBILE)
    .maybeSingle();

  if (userErr) {
    console.error('❌ Error fetching user:', userErr);
  } else if (!user) {
    console.error(`❌ User ${TEST_MOBILE} NOT FOUND in authorised_users table!`);
  } else {
    console.log('✅ User found:');
    console.log(`   - ID: ${user.id}`);
    console.log(`   - Display Name: ${user.display_name}`);
    console.log(`   - Role: ${user.role}`);
    console.log(`   - Is Active: ${user.is_active}`);
    console.log(`   - Telegram Chat ID: ${user.telegram_chat_id || 'NOT SET'}`);
  }

  console.log('\n2. Checking existing otp_requests for', TEST_MOBILE, '...');
  const { data: otpRecords, error: otpErr } = await supabase
    .from('otp_requests')
    .select('*')
    .eq('mobile_number', TEST_MOBILE)
    .order('created_at', { ascending: false })
    .limit(5);

  if (otpErr) {
    console.error('❌ Error fetching otp_requests:', otpErr);
  } else if (!otpRecords || otpRecords.length === 0) {
    console.log('⚠️ No OTP requests found for', TEST_MOBILE);
  } else {
    console.log(`Found ${otpRecords.length} recent OTP requests:`);
    const now = new Date();
    console.log(`   Current Server Time: ${now.toISOString()} (${now.toLocaleString()})`);
    otpRecords.forEach((rec, idx) => {
      const exp = new Date(rec.expires_at);
      const isExp = now > exp;
      console.log(`   [${idx + 1}] ID: ${rec.id}`);
      console.log(`       Created At: ${rec.created_at}`);
      console.log(`       Expires At: ${rec.expires_at} -> ${isExp ? 'EXPIRED' : 'VALID'}`);
      console.log(`       Is Used: ${rec.is_used}`);
      console.log(`       Attempts: ${rec.attempts}`);
    });
  }

  console.log('\n3. Testing increment_otp_attempts RPC function...');
  if (otpRecords && otpRecords.length > 0) {
    const testRecordId = otpRecords[0].id;
    const { data: rpcRes, error: rpcErr } = await supabase.rpc('increment_otp_attempts', { p_id: testRecordId });
    if (rpcErr) {
      console.error('❌ RPC increment_otp_attempts FAILED:', rpcErr);
    } else {
      console.log(`✅ RPC increment_otp_attempts works! Returned attempts: ${rpcRes}`);
    }
  }

  console.log('\n4. Simulating fresh OTP Generation & Storage...');
  const testRawOtp = '987654';
  const hashed = await hashOtp(testRawOtp);
  try {
    const stored = await storeOtp(TEST_MOBILE, hashed);
    console.log('✅ Fresh OTP stored in DB successfully:');
    console.log(`   ID: ${stored.id}`);
    console.log(`   Expires At: ${stored.expires_at}`);

    console.log('\n5. Testing verifyOtp with valid code (987654)...');
    const verifySuccess = await verifyOtp(TEST_MOBILE, testRawOtp);
    console.log('Result:', verifySuccess);

    console.log('\n6. Testing verifyOtp again after it has been used...');
    const verifyReuse = await verifyOtp(TEST_MOBILE, testRawOtp);
    console.log('Result:', verifyReuse);

  } catch (err) {
    console.error('❌ Fresh OTP Test Failed:', err);
  }

  console.log('\n=== DIAGNOSTIC SUITE COMPLETE ===');
  process.exit(0);
}

runDiagnosis();
