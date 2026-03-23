const nodemailer = require('nodemailer');

// ─── Transporter (fresh every call — never cache on cloud platforms) ──────────
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('[email] SMTP not configured — emails will be skipped.');
    return null;
  }
  return nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000,
    greetingTimeout:   30000,
    socketTimeout:     30000,
  });
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

// ─── IFOA Logo — base64 PNG embedded inline (no file path needed on Render) ──
const LOGO_BASE64 = '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';

// ─── Build confirmation HTML ──────────────────────────────────────────────────
function buildConfirmationHtml({ airlineName, contactName, participants, trainingType, trainingDate, endDate, submittedAt }) {
  const count     = participants.length;
  const typeLabel = TRAINING_LABELS[trainingType] || trainingType;
  const startFmt  = fmtDate(trainingDate);
  const endFmt    = endDate ? fmtDate(endDate) : null;
  const subFmt    = new Date(submittedAt).toLocaleString('en-GB', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const rows = participants.map((p, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8fafc' : '#ffffff'}">
      <td style="padding:10px 20px;font-size:13px;color:#374151;border-bottom:1px solid #e5e7eb">${i + 1}</td>
      <td style="padding:10px 20px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #e5e7eb">${p.first_name} ${p.last_name}</td>
      <td style="padding:10px 20px;font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb">${p.department || '—'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Submission Confirmed – IFOA</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Helvetica,Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.10)">

      <!-- ═══════ HEADER ═══════ -->
      <tr>
        <td bgcolor="#0c1a2e" style="background:#0c1a2e;padding:28px 40px 24px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <!-- Logo -->
              <td width="130" style="vertical-align:middle">
                <div style="background:#ffffff;border-radius:10px;padding:8px 12px;display:inline-block">
                  <img src="cid:ifoa_logo" width="110" alt="IFOA" style="display:block;border:0;height:auto"/>
                </div>
              </td>
              <!-- Title -->
              <td style="vertical-align:middle;padding-left:20px">
                <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#94a3b8">International Flight Operations Academy</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:0.3px">Enrollment Confirmed</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ═══════ GREEN ACCENT BAR ═══════ -->
      <tr>
        <td style="background:linear-gradient(90deg,#16a34a,#22c55e);height:4px;font-size:0;line-height:0">&nbsp;</td>
      </tr>

      <!-- ═══════ GREETING ═══════ -->
      <tr>
        <td style="padding:36px 40px 0">
          <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#111827">
            Dear ${contactName || airlineName},
          </p>
          <p style="margin:0;font-size:14px;color:#4b5563;line-height:1.7">
            We have successfully received the training enrollment for <strong style="color:#111827">${airlineName}</strong>.
            Your submission of <strong style="color:#111827">${count} participant${count !== 1 ? 's' : ''}</strong>
            has been recorded and is now under review by the IFOA administration team.
          </p>
        </td>
      </tr>

      <!-- ═══════ SUMMARY CARD ═══════ -->
      <tr>
        <td style="padding:24px 40px 0">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
            <tr>
              <td style="background:#1e293b;padding:12px 20px">
                <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#94a3b8">Submission Summary</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px">
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:7px 0;font-size:13px;color:#6b7280;width:42%;font-weight:500">Training Type</td>
                    <td style="padding:7px 0;font-size:13px;color:#111827;font-weight:700">${trainingType} &nbsp;—&nbsp; ${typeLabel}</td>
                  </tr>
                  <tr>
                    <td style="padding:7px 0;font-size:13px;color:#6b7280;font-weight:500;border-top:1px solid #f1f5f9">Start Date</td>
                    <td style="padding:7px 0;font-size:13px;color:#111827;font-weight:600;border-top:1px solid #f1f5f9">${startFmt}</td>
                  </tr>
                  ${endFmt ? `<tr>
                    <td style="padding:7px 0;font-size:13px;color:#6b7280;font-weight:500;border-top:1px solid #f1f5f9">End Date</td>
                    <td style="padding:7px 0;font-size:13px;color:#111827;font-weight:600;border-top:1px solid #f1f5f9">${endFmt}</td>
                  </tr>` : ''}
                  <tr>
                    <td style="padding:7px 0;font-size:13px;color:#6b7280;font-weight:500;border-top:1px solid #f1f5f9">Participants</td>
                    <td style="padding:7px 0;border-top:1px solid #f1f5f9">
                      <span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:12px;font-weight:700;padding:3px 12px;border-radius:20px;border:1px solid #bbf7d0">${count} Enrolled</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:7px 0;font-size:13px;color:#6b7280;font-weight:500;border-top:1px solid #f1f5f9">Submitted At</td>
                    <td style="padding:7px 0;font-size:13px;color:#374151;border-top:1px solid #f1f5f9">${subFmt}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ═══════ PARTICIPANTS TABLE ═══════ -->
      <tr>
        <td style="padding:24px 40px 0">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#374151">
            Enrolled Participants &nbsp;(${count})
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
            <thead>
              <tr style="background:#1e293b">
                <th style="padding:10px 20px;font-size:10px;font-weight:700;color:#94a3b8;text-align:left;letter-spacing:1.5px;text-transform:uppercase;width:36px">#</th>
                <th style="padding:10px 20px;font-size:10px;font-weight:700;color:#94a3b8;text-align:left;letter-spacing:1.5px;text-transform:uppercase">Full Name</th>
                <th style="padding:10px 20px;font-size:10px;font-weight:700;color:#94a3b8;text-align:left;letter-spacing:1.5px;text-transform:uppercase">Department</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>

      <!-- ═══════ WHAT HAPPENS NEXT ═══════ -->
      <tr>
        <td style="padding:24px 40px 0">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;overflow:hidden">
            <tr>
              <td style="padding:5px 0 0 20px;vertical-align:top;width:30px">
                <p style="margin:12px 0 0;font-size:18px">ℹ️</p>
              </td>
              <td style="padding:14px 20px 14px 8px">
                <p style="margin:0 0 5px;font-size:13px;font-weight:700;color:#1d4ed8">What Happens Next?</p>
                <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.7">
                  Your records are now under review by the IFOA team. Certificates will be issued once
                  the training has been verified. All submitted records are locked — only IFOA
                  administrators can make changes.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ═══════ FOOTER ═══════ -->
      <tr>
        <td style="padding:28px 40px 32px">
          <p style="margin:0;font-size:14px;color:#374151;line-height:1.7">
            Thank you for choosing IFOA for your training needs. If you have any questions,
            please contact us at
            <a href="mailto:${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}" style="color:#2563eb;text-decoration:none;font-weight:600">${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}</a>.
          </p>
          <p style="margin:12px 0 0;font-size:13px;color:#374151">
            Best regards,<br/>
            <strong style="color:#111827">IFOA Administration Team</strong><br/>
            <span style="color:#6b7280;font-size:12px">International Flight Operations Academy</span>
          </p>
        </td>
      </tr>

      <!-- ═══════ BOTTOM BAR ═══════ -->
      <tr>
        <td bgcolor="#0c1a2e" style="background:#0c1a2e;padding:16px 40px">
          <p style="margin:0;font-size:11px;color:#64748b;text-align:center">
            This is an automated email — please do not reply directly. &nbsp;|&nbsp;
            &copy; ${new Date().getFullYear()} International Flight Operations Academy
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>

</body>
</html>`;
}

// ─── Plain-text fallback ──────────────────────────────────────────────────────
function buildConfirmationText({ airlineName, contactName, participants, trainingType, trainingDate, endDate }) {
  const typeLabel = TRAINING_LABELS[trainingType] || trainingType;
  return [
    'IFOA - Enrollment Confirmation',
    '================================',
    '',
    `Dear ${contactName || airlineName},`,
    '',
    `Training enrollment for ${airlineName} has been confirmed.`,
    '',
    `Training Type : ${trainingType} - ${typeLabel}`,
    `Start Date    : ${fmtDate(trainingDate)}`,
    endDate ? `End Date      : ${fmtDate(endDate)}` : null,
    `Participants  : ${participants.length}`,
    '',
    'Enrolled Participants:',
    ...participants.map((p, i) => `  ${i + 1}. ${p.first_name} ${p.last_name} (${p.department || '—'})`),
    '',
    'Records are under review. Certificates will be issued after verification.',
    '',
    'Best regards,',
    'IFOA Administration Team',
    'International Flight Operations Academy',
  ].filter(Boolean).join('\n');
}

// ─── Send submission confirmation ────────────────────────────────────────────
async function sendSubmissionConfirmation(opts) {
  const transporter = getTransporter();
  if (!transporter) return;

  const { toEmail, airlineName, contactName, participants, trainingType, trainingDate, endDate } = opts;
  const count     = participants.length;
  const typeLabel = TRAINING_LABELS[trainingType] || trainingType;
  const payload   = { airlineName, contactName, participants, trainingType, trainingDate, endDate, submittedAt: new Date() };

  try {
    const info = await transporter.sendMail({
      from:    `"IFOA – International Flight Operations Academy" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to:      toEmail,
      subject: `Enrollment Confirmed: ${count} Participant${count !== 1 ? 's' : ''} – ${trainingType} (${typeLabel})`,
      text:    buildConfirmationText(payload),
      html:    buildConfirmationHtml(payload),
      attachments: [{
        filename:    'ifoa_logo.png',
        content:     Buffer.from(LOGO_BASE64, 'base64'),
        cid:         'ifoa_logo',
        contentDisposition: 'inline',
        contentType: 'image/png',
      }],
    });
    console.log(`[email] Confirmation sent to ${toEmail} — messageId: ${info.messageId}`);
  } catch (err) {
    console.error(`[email] FAILED to ${toEmail}:`, err.message, '| code:', err.code || 'none');
  }
}

// ─── Send password reset email ────────────────────────────────────────────────
async function sendPasswordResetEmail({ toEmail, airlineName, resetUrl }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[email] SMTP not configured — password reset skipped.');
    return;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Password Reset – IFOA</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Helvetica,Arial,sans-serif">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:40px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.10)">

      <!-- ═══════ HEADER ═══════ -->
      <tr>
        <td bgcolor="#0c1a2e" style="background:#0c1a2e;padding:28px 40px 24px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="130" style="vertical-align:middle">
                <div style="background:#ffffff;border-radius:10px;padding:8px 12px;display:inline-block">
                  <img src="cid:ifoa_logo" width="110" alt="IFOA" style="display:block;border:0;height:auto"/>
                </div>
              </td>
              <td style="vertical-align:middle;padding-left:20px">
                <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#94a3b8">International Flight Operations Academy</p>
                <p style="margin:4px 0 0;font-size:20px;font-weight:800;color:#ffffff">Password Reset Request</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Accent bar -->
      <tr>
        <td style="background:linear-gradient(90deg,#dc2626,#ef4444);height:4px;font-size:0;line-height:0">&nbsp;</td>
      </tr>

      <!-- ═══════ BODY ═══════ -->
      <tr>
        <td style="padding:36px 40px 0">
          <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#111827">Dear ${airlineName},</p>
          <p style="margin:0 0 24px;font-size:14px;color:#4b5563;line-height:1.7">
            We received a request to reset the password for your IFOA Airline Portal account.
            Click the button below to choose a new password. This link is valid for
            <strong style="color:#111827">1 hour</strong>.
          </p>

          <!-- CTA Button -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px">
            <tr>
              <td style="background:#1d4ed8;border-radius:10px;text-align:center">
                <a href="${resetUrl}"
                  style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px">
                  Reset My Password
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 6px;font-size:13px;color:#6b7280">If the button doesn't work, copy and paste this link:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#2563eb;word-break:break-all;line-height:1.6">${resetUrl}</p>

          <!-- Warning box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef9c3;border:1px solid #fde047;border-radius:10px;margin-bottom:8px">
            <tr>
              <td style="padding:14px 18px">
                <p style="margin:0;font-size:13px;color:#854d0e;line-height:1.6">
                  ⚠️ &nbsp;If you did not request a password reset, please ignore this email.
                  Your password will remain unchanged and no action is required.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- ═══════ FOOTER ═══════ -->
      <tr>
        <td style="padding:28px 40px 32px">
          <p style="margin:0;font-size:13px;color:#374151;line-height:1.7">
            Best regards,<br/>
            <strong style="color:#111827">IFOA Security Team</strong><br/>
            <span style="font-size:12px;color:#6b7280">International Flight Operations Academy</span>
          </p>
        </td>
      </tr>

      <!-- Bottom bar -->
      <tr>
        <td bgcolor="#0c1a2e" style="background:#0c1a2e;padding:16px 40px">
          <p style="margin:0;font-size:11px;color:#64748b;text-align:center">
            This is an automated security email — do not reply. &nbsp;|&nbsp;
            &copy; ${new Date().getFullYear()} International Flight Operations Academy
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>

</body>
</html>`;

  const text = `IFOA – Password Reset\n\nDear ${airlineName},\n\nReset your password using this link (valid 1 hour):\n${resetUrl}\n\nIf you did not request this, ignore this email.\n\nIFOA Security Team\nInternational Flight Operations Academy`;

  try {
    const info = await transporter.sendMail({
      from:    `"IFOA – International Flight Operations Academy" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to:      toEmail,
      subject: 'Reset Your IFOA Airline Portal Password',
      text,
      html,
      attachments: [{
        filename:    'ifoa_logo.png',
        content:     Buffer.from(LOGO_BASE64, 'base64'),
        cid:         'ifoa_logo',
        contentDisposition: 'inline',
        contentType: 'image/png',
      }],
    });
    console.log(`[email] Password reset sent to ${toEmail} — messageId: ${info.messageId}`);
  } catch (err) {
    console.error(`[email] FAILED password reset to ${toEmail}:`, err.message, '| code:', err.code || 'none');
  }
}

module.exports = { sendSubmissionConfirmation, sendPasswordResetEmail };
