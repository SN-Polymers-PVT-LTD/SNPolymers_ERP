const nodemailer = require('nodemailer');
require('dotenv').config();

const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
const adminEmailAddress = process.env.ADMIN_EMAIL;

let transporter = null;

if (gmailUser && gmailAppPassword) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword
    }
  });
} else {
  console.warn('WARNING: Nodemailer email credentials missing. Email alerts will be console-logged only.');
}

/**
 * Sends an email notification to the administrator.
 * Decoupled as a background task to prevent blocking the HTTP response.
 */
function sendEmail(subject, htmlBody) {
  if (!adminEmailAddress) {
    console.warn('[Email Alert] Admin email recipient (ADMIN_EMAIL) is not configured.');
    return;
  }

  const mailOptions = {
    from: gmailUser || '"IDBP Auth System" <noreply@snpolymers.com>',
    to: adminEmailAddress,
    subject: subject,
    html: htmlBody
  };

  if (!transporter) {
    console.log('\n======================================');
    console.log(`[DEV Email Notification] To: ${adminEmailAddress}`);
    console.log(`[Subject]: ${subject}`);
    console.log(`[HTML Content]:\n${htmlBody}`);
    console.log('======================================\n');
    return;
  }

  // Execute asynchronously without blocking
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error(`Error sending admin email alert: ${error.message}`);
    } else {
      console.log(`Admin email alert sent: ${info.response}`);
    }
  });
}

/**
 * Trigger Login Alert
 */
function notifyAdminLogin({ mobileNumber, displayName, role, ipAddress, userAgent }) {
  const subject = `[IDBP Login Alert] User Authenticated - ${mobileNumber}`;
  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #0284c7;">Authentication Event Triggered</h2>
      <p>A whitelisted user has successfully signed in to the Integrated Digital Business Platform.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
        <tr style="background-color: #f8fafc;">
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0; width: 35%;">Mobile Number</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${mobileNumber}</td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">Display Name</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${displayName || 'N/A'}</td>
        </tr>
        <tr style="background-color: #f8fafc;">
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">System Role</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${role}</td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">IP Address</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${ipAddress}</td>
        </tr>
        <tr style="background-color: #f8fafc;">
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">User Agent</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${userAgent}</td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">Timestamp</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${new Date().toLocaleString()}</td>
        </tr>
      </table>
    </div>
  `;
  sendEmail(subject, htmlBody);
}

/**
 * Trigger Logout Alert
 */
function notifyAdminLogout({ mobileNumber, displayName, durationFormatted, logoutTime }) {
  const subject = `[IDBP Logout Alert] User Logged Out - ${mobileNumber}`;
  const htmlBody = `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 5px;">
      <h2 style="color: #64748b;">Session Terminated Event</h2>
      <p>A user session has been successfully closed and logged out.</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
        <tr style="background-color: #f8fafc;">
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0; width: 35%;">Mobile Number</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${mobileNumber}</td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">Display Name</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${displayName || 'N/A'}</td>
        </tr>
        <tr style="background-color: #f8fafc;">
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">Total Session Duration</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #0f172a;">${durationFormatted}</td>
        </tr>
        <tr>
          <td style="padding: 8px; font-weight: bold; border: 1px solid #e2e8f0;">Logout Timestamp</td>
          <td style="padding: 8px; border: 1px solid #e2e8f0;">${new Date(logoutTime).toLocaleString()}</td>
        </tr>
      </table>
    </div>
  `;
  sendEmail(subject, htmlBody);
}

module.exports = {
  notifyAdminLogin,
  notifyAdminLogout
};
