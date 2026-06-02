const twilio = require('twilio');
require('dotenv').config();

let client = null;
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';

if (accountSid && authToken && accountSid !== 'your_twilio_account_sid' && authToken !== 'your_twilio_auth_token') {
  client = twilio(accountSid, authToken);
}

/**
 * Sends OTP to user's WhatsApp using Twilio WABA API.
 * If credentials are not set, it logs OTP to console in development.
 */
async function sendOtp(mobileNumber, otp) {
  const messageBody = `Your Integrated Digital Business Platform (IDBP) security OTP code is: ${otp}. It is valid for 5 minutes. Do not share this code.`;

  if (process.env.NODE_ENV === 'development' || !client) {
    console.log('\n======================================');
    console.log(`[DEV WhatsApp Send] To: ${mobileNumber}`);
    console.log(`[OTP CODE]: ${otp}`);
    console.log('======================================\n');
    return { success: true, mode: 'console' };
  }

  try {
    const formattedTo = mobileNumber.startsWith('whatsapp:') ? mobileNumber : `whatsapp:${mobileNumber}`;
    const formattedFrom = fromWhatsApp.startsWith('whatsapp:') ? fromWhatsApp : `whatsapp:${fromWhatsApp}`;

    const response = await client.messages.create({
      body: messageBody,
      from: formattedFrom,
      to: formattedTo
    });

    return { success: true, sid: response.sid, mode: 'twilio' };
  } catch (error) {
    console.error(`Twilio WhatsApp transmission failed: ${error.message}`);
    throw new Error(`WhatsApp delivery failed: ${error.message}`);
  }
}

module.exports = {
  sendOtp
};
