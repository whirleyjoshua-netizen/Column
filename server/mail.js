// Email Column sends itself: sign-up codes and password resets, through Resend.
// Resend when RESEND_API_KEY and MAIL_FROM are set. MAIL_OUTBOX=1 writes each email as a file in
// DATA_DIR/outbox instead, for local testing, so nobody real is ever emailed. Otherwise email is off,
// and the parts of Column that need it (codes, Forgot password) stay hidden.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer({ token, from, outbox, appName }) {
  const mode = token && from ? 'resend' : outbox ? 'outbox' : 'off';
  async function send({ to, subject, text, html, tag }) {
    if (mode === 'off') throw new Error('Email isn’t set up on this server.');
    if (mode === 'outbox') {
      fs.mkdirSync(outbox, { recursive: true });
      const file = path.join(outbox, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
      fs.writeFileSync(file, JSON.stringify({ to, subject, text, html, tag, at: Date.now() }));
      return { ok: true };
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ from, to: [to], subject, text, html, tags: tag ? [{ name: 'kind', value: tag }] : undefined }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(`Resend: ${j.message || r.status}`);
    }
    return { ok: true };
  }

  // One plain layout for every email: a heading, a few lines, maybe a code or a button.
  function layout({ heading, lines, code, button, foot }) {
    const html = `<!doctype html><html><body style="margin:0;background:#f3f3f6;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16161a">
<div style="max-width:480px;margin:0 auto;padding:28px 16px">
<div style="background:#fff;border-radius:14px;padding:24px">
<div style="font-weight:700;font-size:13px;color:#6b5cf0;margin-bottom:14px">${esc(appName)}</div>
<h1 style="font-size:19px;margin:0 0 10px">${esc(heading)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('')}
${code ? `<div style="font:700 30px/1 ui-monospace,Menlo,monospace;letter-spacing:6px;background:#f3f3f6;border-radius:10px;padding:16px;text-align:center;margin:16px 0">${esc(code)}</div>` : ''}
${button ? `<p style="margin:18px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#6b5cf0;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:10px">${esc(button.label)}</a></p><p style="font-size:12px;color:#6b6b76;margin:0 0 12px;word-break:break-all">Or open this link: ${esc(button.url)}</p>` : ''}
</div>
<p style="font-size:12px;color:#6b6b76;text-align:center;margin:14px 0 0">${esc(foot)}</p>
</div></body></html>`;
    const text = [heading, '', ...lines, code ? `\n    ${code}\n` : '', button ? `${button.label}: ${button.url}\n` : '', foot].filter((x) => x !== '').join('\n');
    return { html, text };
  }

  const codeEmail = (to, code) => send({
    to, tag: 'verify',
    subject: `${code} is your ${appName} code`,
    ...layout({
      heading: 'Confirm your email',
      lines: [`Enter this code in ${appName} to confirm this is your email address. It works for 30 minutes.`],
      code,
      foot: 'If you didn’t sign up, you can ignore this email.',
    }),
  });
  const resetEmail = (to, url) => send({
    to, tag: 'reset',
    subject: `Reset your ${appName} password`,
    ...layout({
      heading: 'Reset your password',
      lines: ['Someone asked to reset the password for this email address. If it was you, choose a new one. The link works once, for 30 minutes.'],
      button: { label: 'Choose a new password', url },
      foot: 'If you didn’t ask for this, ignore this email. Your password stays the same.',
    }),
  });

  const inviteEmail = (to, { team, by, url }) => send({
    to, tag: 'invite',
    subject: `${by} invited you to ${team} on ${appName}`,
    ...layout({
      heading: `Join ${team}`,
      lines: [`${by} invited you to work with the ${team} team in ${appName}.`, 'Open the link to choose your name and password. It works once, for 14 days.'],
      button: { label: `Join ${team}`, url },
      foot: 'If you weren’t expecting this, you can ignore it.',
    }),
  });
  const emailChanged = (to, { newEmail }) => send({
    to, tag: 'email-changed',
    subject: `Your ${appName} email was changed`,
    ...layout({
      heading: 'Your email was changed',
      lines: [`Your ${appName} account now uses ${newEmail}. If you didn’t do this, reset your password straight away and tell your team owner.`],
      foot: 'You’re getting this at your old address so you know.',
    }),
  });

  return { mode, send, codeEmail, resetEmail, inviteEmail, emailChanged };
}
