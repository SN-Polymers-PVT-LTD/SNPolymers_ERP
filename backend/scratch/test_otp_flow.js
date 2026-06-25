const fs = require('fs');
const path = require('path');

async function testOtp() {
  const mobileNumber = '+919222227515';
  console.log(`Requesting OTP for ${mobileNumber}...`);

  // Clear existing file first
  const otpFilePath = path.join(__dirname, 'latest_otp.txt');
  if (fs.existsSync(otpFilePath)) {
    fs.unlinkSync(otpFilePath);
  }

  try {
    const response = await fetch('http://localhost:5000/api/v1/auth/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobileNumber })
    });
    
    const data = await response.json();
    console.log('Response from API:', data);

    // Wait a brief second for fs write
    await new Promise(resolve => setTimeout(resolve, 500));

    if (fs.existsSync(otpFilePath)) {
      const otp = fs.readFileSync(otpFilePath, 'utf8');
      console.log(`SUCCESS! Found written OTP code: ${otp}`);
    } else {
      console.log('FAIL: latest_otp.txt was not created.');
    }
  } catch (err) {
    console.error('Error requesting OTP:', err.message);
  }
}

testOtp();
