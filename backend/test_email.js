// Run this from I:\project_IFOA2\backend\ to test email
// Command: node test_email.js
require('dotenv').config();
const nodemailer = require('nodemailer');

async function test() {
  console.log('\n=== IFOA Email Test ===');
  console.log('Host:', process.env.SMTP_HOST);
  console.log('Port:', process.env.SMTP_PORT);
  console.log('User:', process.env.SMTP_USER);
  console.log('Pass:', process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-4) : 'NOT SET');
  console.log('');

  // Test 1: Port 465 SSL
  console.log('--- Testing port 465 (SSL) ---');
  try {
    const t465 = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
    });
    await t465.verify();
    console.log('PORT 465: CONNECTED SUCCESSFULLY');
    
    // Send test email
    await t465.sendMail({
      from: `"IFOA Test" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER, // sends to itself as test
      subject: 'IFOA Email Test - Port 465',
      text: 'This is a test email from IFOA backend. If you see this, email is working!',
    });
    console.log('PORT 465: TEST EMAIL SENT to', process.env.SMTP_USER);
  } catch (err) {
    console.log('PORT 465 FAILED:', err.message);
    if (err.code) console.log('Error code:', err.code);
  }

  // Test 2: Port 587 STARTTLS
  console.log('\n--- Testing port 587 (STARTTLS) ---');
  try {
    const t587 = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
    });
    await t587.verify();
    console.log('PORT 587: CONNECTED SUCCESSFULLY');
  } catch (err) {
    console.log('PORT 587 FAILED:', err.message);
    if (err.code) console.log('Error code:', err.code);
  }
}

test().catch(console.error);
