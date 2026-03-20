const nodemailer = require('nodemailer');

// ─── Transporter ──────────────────────────────────────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('[email] SMTP not configured — confirmation emails will be skipped.');
    return null;
  }
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,          // true for port 465 (SSL), false for 587/25 (STARTTLS)
    auth: { user, pass },
    // Allow any TLS certificate — required for many corporate/custom mail servers
    tls: {
      rejectUnauthorized: false,
      ciphers: 'SSLv3',
    },
    // Increase timeouts so slow mail servers don't abort the connection
    connectionTimeout: 10000,
    greetingTimeout:   10000,
    socketTimeout:     15000,
    // Force the EHLO hostname to match the sending domain for better deliverability
    name: (process.env.SMTP_FROM_EMAIL || user || '').split('@')[1] || 'ifoa.com',
  });
  return _transporter;
}

// ─── Training type labels ─────────────────────────────────────────────────────
const TRAINING_LABELS = {
  FDI: 'Flight Dispatch Initial',
  FDR: 'Flight Dispatch Recurrent',
  FDA: 'Flight Dispatch Advanced',
  FTL: 'Flight Time Limitations',
  NDG: 'Dangerous Goods No-Carry',
  HF:  'Human Factors for OCC',
  GD:  'Ground Operations',
  TCD: 'Training Competencies Development',
};

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

// ─── IFOA logo (base64 PNG, embedded as CID attachment) ──────────────────────
const LOGO_BASE64 =
  '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';

// ─── HTML email builder ───────────────────────────────────────────────────────
function buildConfirmationHtml({ airlineName, contactName, participants, trainingType, trainingDate, endDate, submittedAt }) {
  const count        = participants.length;
  const typeLabel    = TRAINING_LABELS[trainingType] || trainingType;
  const startFmt     = fmtDate(trainingDate);
  const endFmt       = endDate ? fmtDate(endDate) : null;
  const submittedFmt = new Date(submittedAt).toLocaleString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  const participantRows = participants
    .map((p, i) => `
      <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#ffffff'};">
        <td style="padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${i + 1}</td>
        <td style="padding:10px 16px;font-size:13px;color:#1e293b;font-weight:600;border-bottom:1px solid #e2e8f0;">${p.first_name} ${p.last_name}</td>
        <td style="padding:10px 16px;font-size:13px;color:#475569;border-bottom:1px solid #e2e8f0;">${p.department || '—'}</td>
      </tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Submission Confirmation  IFOA</title>
  <style>
    /* Force white background on logo bar — defeats Gmail/Apple Mail dark mode */
    .logo-bar, .logo-bar td, .logo-bar table { background-color: #ffffff !important; }
    @media (prefers-color-scheme: dark) {
      .logo-bar, .logo-bar td, .logo-bar table { background-color: #ffffff !important; }
      .logo-bar img { background-color: #ffffff !important; }
    }
    [data-ogsc] .logo-bar, [data-ogsc] .logo-bar td { background-color: #ffffff !important; }
  </style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
      style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- ── HEADER: white logo bar + dark title bar ── -->
      <!-- White logo strip: bgcolor attr + inline style + class all set to white to defeat dark mode -->
      <tr>
        <td bgcolor="#ffffff" class="logo-bar"
          style="background-color:#ffffff;padding:20px 40px 16px;border-bottom:3px solid #0f172a;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
            bgcolor="#ffffff" style="background-color:#ffffff;">
            <tr>
              <!-- Logo cell: extra div wrapper with white bg so dark-mode clients can't invert it -->
              <td bgcolor="#ffffff" width="150"
                style="background-color:#ffffff;vertical-align:middle;padding:6px 16px 6px 0;">
                <div style="background-color:#ffffff;display:inline-block;padding:6px 8px;border-radius:6px;">
                  <img src="cid:ifoa_logo" alt="IFOA Logo"
                    width="120" height="auto"
                    style="display:block;width:120px;max-width:120px;height:auto;border:0;" />
                </div>
              </td>
              <td bgcolor="#ffffff" align="right"
                style="background-color:#ffffff;vertical-align:middle;">
                <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:1.5px;
                  color:#64748b !important;text-transform:uppercase;">International Flight Operations Academy</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- Dark title bar -->
      <tr>
        <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:22px 40px 20px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;">
                <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;line-height:1.2;">
                  Submission Confirmed
                </h1>
                <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">
                  Training enrollment received successfully
                </p>
              </td>
              <td align="right" style="vertical-align:middle;width:56px;">
                <div style="width:46px;height:46px;background:rgba(74,222,128,0.15);border-radius:50%;
                  text-align:center;line-height:46px;border:2px solid #4ade80;display:inline-block;">
                  <span style="font-size:20px;color:#4ade80;">✓</span>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ── BODY ── -->
      <tr>
        <td style="padding:32px 40px 0;">

          <!-- Greeting -->
          <p style="margin:0 0 18px;font-size:15px;color:#334155;line-height:1.6;">
            Dear <strong>${contactName || airlineName}</strong>,
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
            We have successfully received your training enrollment submission for
            <strong>${airlineName}</strong>. Below is a full summary of the
            <strong>${count} participant${count !== 1 ? 's' : ''}</strong> enrolled.
          </p>

          <!-- Summary card -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:1.5px;
                color:#64748b;text-transform:uppercase;">Submission Summary</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;width:42%;">Training Type</td>
                  <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;">
                    ${trainingType} – ${typeLabel}
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;">Start Date</td>
                  <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;">${startFmt}</td>
                </tr>
                ${endFmt ? `<tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;">End Date</td>
                  <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;">${endFmt}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;">Total Participants</td>
                  <td style="padding:6px 0;">
                    <span style="display:inline-block;background:#dcfce7;color:#166534;font-size:13px;
                      font-weight:700;padding:2px 12px;border-radius:20px;border:1px solid #bbf7d0;">
                      ${count} enrolled
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:13px;color:#64748b;">Submitted At</td>
                  <td style="padding:6px 0;font-size:13px;color:#0f172a;">${submittedFmt}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- Participant table -->
          <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#334155;
            text-transform:uppercase;letter-spacing:1px;">
            Enrolled Participants (${count})
          </p>
          <table width="100%" cellpadding="0" cellspacing="0"
            style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;margin-bottom:28px;">
            <thead>
              <tr style="background:#0f172a;">
                <th style="padding:10px 16px;font-size:10px;font-weight:700;color:#94a3b8;
                  text-align:left;letter-spacing:1px;text-transform:uppercase;width:32px;">#</th>
                <th style="padding:10px 16px;font-size:10px;font-weight:700;color:#94a3b8;
                  text-align:left;letter-spacing:1px;text-transform:uppercase;">Full Name</th>
                <th style="padding:10px 16px;font-size:10px;font-weight:700;color:#94a3b8;
                  text-align:left;letter-spacing:1px;text-transform:uppercase;">Department</th>
              </tr>
            </thead>
            <tbody>${participantRows}</tbody>
          </table>

          <!-- Info box -->
          <table width="100%" cellpadding="0" cellspacing="0"
            style="background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;margin-bottom:32px;">
            <tr><td style="padding:16px 20px;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#1d4ed8;">
                What happens next?
              </p>
              <p style="margin:0;font-size:13px;color:#3b4f9e;line-height:1.6;">
                Your records have been received and are now under review by the IFOA team.
                Certificates will be generated and shared once the training is verified.
                All submitted records are locked only IFOA administrators can make changes.
              </p>
            </td></tr>
          </table>

        </td>
      </tr>

      <!-- ── FOOTER ── -->
      <tr>
        <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:22px 40px;">
          <p style="margin:0 0 5px;font-size:13px;color:#334155;font-weight:600;">
            International Flight Operations Academy (IFOA)
          </p>
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
            This is an automated confirmation email. Please do not reply directly.<br/>
            For questions contact us at
            <a href="mailto:${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}"
              style="color:#3b82f6;text-decoration:none;">
              ${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}
            </a>.
          </p>
        </td>
      </tr>

    </table>

    <p style="margin:18px 0 0;font-size:11px;color:#94a3b8;text-align:center;">
      © ${new Date().getFullYear()} International Flight Operations Academy · All rights reserved
    </p>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Plain-text fallback ──────────────────────────────────────────────────────
function buildConfirmationText({ airlineName, contactName, participants, trainingType, trainingDate, endDate }) {
  const typeLabel = TRAINING_LABELS[trainingType] || trainingType;
  const lines = [
    `IFOA – Submission Confirmation`,
    ``,
    `Dear ${contactName || airlineName},`,
    ``,
    `Your training enrollment for ${airlineName} has been successfully submitted.`,
    ``,
    `Training Type : ${trainingType} – ${typeLabel}`,
    `Start Date    : ${fmtDate(trainingDate)}`,
    endDate ? `End Date      : ${fmtDate(endDate)}` : null,
    `Participants  : ${participants.length}`,
    ``,
    `Enrolled:`,
    ...participants.map((p, i) => `  ${i + 1}. ${p.first_name} ${p.last_name}  (${p.department || '—'})`),
    ``,
    `Records are now locked and under review by the IFOA team.`,
    ``,
    `International Flight Operations Academy`,
  ].filter(l => l !== null);
  return lines.join('\n');
}

// ─── Public send function ─────────────────────────────────────────────────────
async function sendSubmissionConfirmation(opts) {
  const transporter = getTransporter();
  if (!transporter) return;

  const { toEmail, airlineName, contactName, participants, trainingType, trainingDate, endDate } = opts;
  const count     = participants.length;
  const typeLabel = TRAINING_LABELS[trainingType] || trainingType;
  const subject   = `✅ IFOA – ${count} Participant${count !== 1 ? 's' : ''} Enrolled: ${trainingType} – ${typeLabel}`;
  const payload   = { airlineName, contactName, participants, trainingType, trainingDate, endDate, submittedAt: new Date() };

  try {
    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'IFOA – International Flight Operations Academy'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to:   toEmail,
      subject,
      text: buildConfirmationText(payload),
      html: buildConfirmationHtml(payload),
      attachments: [
        {
          filename:    'ifoa_logo.png',
          content:     Buffer.from(LOGO_BASE64, 'base64'),
          cid:         'ifoa_logo',
          contentDisposition: 'inline',
          contentType: 'image/png',
        },
      ],
    });
    console.log(`[email] Confirmation sent to ${toEmail} (${count} participant${count !== 1 ? 's' : ''})`);
  } catch (err) {
    // Log full SMTP error so we can diagnose delivery failures (e.g. blocked by recipient server)
    console.error('[email] Failed to send confirmation to', toEmail);
    console.error('[email] SMTP error:', err.message);
    if (err.response) console.error('[email] SMTP response:', err.response);
    if (err.code)     console.error('[email] Error code:', err.code);
  }
}

// ─── Password Reset Email ─────────────────────────────────────────────────────────────────────
async function sendPasswordResetEmail({ toEmail, airlineName, resetUrl }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP not configured — password reset email skipped.');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0"
      style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <tr>
        <td style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);padding:28px 40px;">
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">Password Reset Request</h1>
          <p style="margin:6px 0 0;font-size:13px;color:#94a3b8;">IFOA Airline Portal</p>
        </td>
      </tr>

      <tr><td style="padding:32px 40px;">
        <p style="margin:0 0 16px;font-size:15px;color:#334155;line-height:1.6;">
          Dear <strong>${airlineName}</strong>,
        </p>
        <p style="margin:0 0 24px;font-size:15px;color:#334155;line-height:1.6;">
          We received a request to reset your password. Click the button below to set a new password.
          This link is valid for <strong>1 hour</strong>.
        </p>

        <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
          <tr>
            <td style="background:#1d4ed8;border-radius:12px;text-align:center;">
              <a href="${resetUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">
                Reset My Password
              </a>
            </td>
          </tr>
        </table>

        <p style="margin:0 0 8px;font-size:13px;color:#64748b;line-height:1.6;">
          If the button doesn't work, copy and paste this link into your browser:
        </p>
        <p style="margin:0 0 24px;font-size:12px;color:#3b82f6;word-break:break-all;">${resetUrl}</p>

        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:24px;">
          <p style="margin:0;font-size:13px;color:#92400e;">
            ⚠️ If you didn't request this, you can safely ignore this email. Your password will not change.
          </p>
        </div>
      </td></tr>

      <tr>
        <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">
            International Flight Operations Academy (IFOA)
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = `Password Reset - IFOA\n\nDear ${airlineName},\n\nClick the link below to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, ignore this email.\n\nIFOA`;

  try {
    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'IFOA – International Flight Operations Academy'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to:      toEmail,
      subject: '🔒 IFOA – Reset Your Password',
      text,
      html,
    });
    console.log(`[email] Password reset sent to ${toEmail}`);
  } catch (err) {
    console.error('[email] Failed to send password reset to', toEmail, err.message);
  }
}

module.exports = { sendSubmissionConfirmation, sendPasswordResetEmail };
