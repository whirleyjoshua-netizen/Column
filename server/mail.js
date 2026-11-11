// Email Kloomie sends itself: sign-up codes and password resets, through Resend.
// Resend when RESEND_API_KEY and MAIL_FROM are set. MAIL_OUTBOX=1 writes each email as a file in
// DATA_DIR/outbox instead, for local testing, so nobody real is ever emailed. Otherwise email is off,
// and the parts of Kloomie that need it (codes, Forgot password) stay hidden.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer({ token, from, outbox, appName }) {
  const mode = token && from ? 'resend' : outbox ? 'outbox' : 'off';
  // fromName: whose name the email comes in under (a team writing to its customer), still from our address.
  async function send({ to, subject, text, html, tag, fromName, replyTo }) {
    if (mode === 'off') throw new Error('Email isn’t set up on this server.');
    const addr = /<([^>]+)>/.exec(from || '')?.[1] || from;
    const sender = fromName ? `"${String(fromName).replace(/["\\<>\r\n]/g, '').slice(0, 60)}" <${addr}>` : from;
    if (mode === 'outbox') {
      // Tests can make the stand-in take as long as a real send (Resend answers over the network), to catch races.
      if (Number(process.env.MAIL_OUTBOX_DELAY_MS) > 0) await new Promise((r) => setTimeout(r, Number(process.env.MAIL_OUTBOX_DELAY_MS)));
      fs.mkdirSync(outbox, { recursive: true });
      const file = path.join(outbox, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
      fs.writeFileSync(file, JSON.stringify({ to, subject, text, html, tag, fromName, replyTo, at: Date.now() }));
      return { ok: true };
    }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ from: sender, to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}), tags: tag ? [{ name: 'kind', value: tag }] : undefined }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(`Resend: ${j.message || r.status}`);
    }
    return { ok: true };
  }

  // One plain layout for every email: a heading, a few lines, maybe a code or a button.
  function layout({ heading, lines, code, button, foot, brand }) {
    const html = `<!doctype html><html><body style="margin:0;background:#f3f3f6;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16161a">
<div style="max-width:480px;margin:0 auto;padding:28px 16px">
<div style="background:#fff;border-radius:14px;padding:24px">
<div style="font-weight:700;font-size:13px;color:#6b5cf0;margin-bottom:14px">${esc(brand || appName)}</div>
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

  // A team writing to one of its customers: on the way, a visit tomorrow, asking for a review. It comes in under
  // the team's name, and replies go to the team.
  const customerEmail = (to, { team, replyTo, subject, heading, lines, button, tag }) => send({
    to, tag, subject, fromName: team, replyTo,
    ...layout({ brand: team, heading, lines, button, foot: `Sent by ${team} with ${appName}. Reply to this email to reach them.` }),
  });

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

  const longDay = (ms, tz) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz || 'UTC' });
  const teamDeleting = (to, { team, by, when, tz }) => send({
    to, tag: 'team-deleting',
    subject: `${team} is being deleted from ${appName}`,
    ...layout({
      heading: `${team} is being deleted`,
      lines: [`${by} asked to delete the ${team} team. It’s locked now, and everything in it will be erased for good on ${longDay(when, tz)}.`, 'Until then, any team owner can sign in and cancel it from Settings.'],
      foot: 'You’re getting this because you’re on the team.',
    }),
  });
  const teamKept = (to, { team, by }) => send({
    to, tag: 'team-kept',
    subject: `${team} won’t be deleted`,
    ...layout({
      heading: `${team} won’t be deleted`,
      lines: [`${by} cancelled deleting the ${team} team. Everything is as it was, and you can sign in again.`],
      foot: 'You’re getting this because you’re on the team.',
    }),
  });

  const accountDeleted = (to, { teams }) => send({
    to, tag: 'account-deleted',
    subject: `Your ${appName} account was deleted`,
    ...layout({
      heading: 'Your account was deleted',
      lines: [`Your ${appName} account for this email is gone, and you’ve left ${teams.join(', ')}. Your private things were deleted; what you shared stays with each team.`, 'If you didn’t do this, tell your team owner straight away.'],
      foot: 'This is the last email you’ll get from us at this address.',
    }),
  });

  const exportReady = (to, { team, mine, url }) => send({
    to, tag: 'export-ready',
    subject: `Your ${appName} export of ${team} is ready`,
    ...layout({
      heading: 'Your export is ready',
      lines: [`The export of ${mine ? 'your things in ' : ''}${team} is ready to download. Sign in to ${appName} and open Settings to get it. It’s kept for 7 days.`],
      button: { label: `Open ${appName}`, url },
      foot: 'You’re getting this because you asked for an export.',
    }),
  });

  // To whoever runs this server (ALERT_EMAIL), not to customers.
  const alertEmail = (to, { url, list }) => send({
    to, tag: 'alert',
    subject: `${appName} alert: ${list[0].what}${list.length > 1 ? ` (+${list.length - 1} more)` : ''}`,
    ...layout({
      heading: list.length > 1 ? `${list.length} problems on ${url}` : `A problem on ${url}`,
      lines: list.flatMap((x) => [`${x.what}${x.count > 1 ? ` (${x.count} times)` : ''}, first at ${new Date(x.at).toISOString().replace('T', ' ').slice(0, 19)} UTC`, x.msg]),
      foot: 'Alerts are grouped and sent at most every 15 minutes. The server log on Railway has the full details.',
    }),
  });

  // Getting started: one welcome, then reminders as the free trial runs out (days 3, 1, and 0 = it ended).
  const welcomeEmail = (to, { team, url, trialDays }) => send({
    to, tag: 'welcome',
    subject: `Welcome to ${appName}`,
    ...layout({
      heading: `${team} is ready`,
      lines: [
        `Thanks for starting ${team} on ${appName}.${trialDays ? ` Your free trial runs for ${trialDays} days, with no card needed.` : ''} Three things make the biggest difference in the first week:`,
        '1. Invite your team, in Settings → Team, so work lands with the right people.',
        '2. Connect your calendar and email, in Settings → Connections, so your day and your sends live in one place.',
        '3. Start your first campaign, from Campaigns → New, or ask Sidekick to plan one for you.',
        `Home has a Get started list that ticks these off as you go. Questions? Just reply to this email.`,
      ],
      button: { label: `Open ${appName}`, url },
      foot: 'You’re getting this because you created a team.',
    }),
  });
  const trialEmail = (to, { team, url, days, seats, price, ends, tz }) => {
    const per = `$${(price / 100).toFixed(price % 100 ? 2 : 0)}`;
    const total = `$${((price * seats) / 100).toFixed((price * seats) % 100 ? 2 : 0)}`;
    const cost = `It’s ${per} a person a month: ${total} a month for ${seats === 1 ? 'one person' : `the ${seats} people`} on ${team} now.`;
    return send({
      to, tag: 'trial-' + days,
      subject: days ? `Your ${appName} trial ends ${days === 1 ? 'tomorrow' : `in ${days} days`}` : `Your ${appName} trial has ended`,
      ...layout({
        heading: days ? `${days === 1 ? 'One day' : `${days} days`} left in your trial` : `${team}’s free trial has ended`,
        lines: days
          ? [`The free trial for ${team} ends on ${longDay(ends, tz)}. To keep working without a break, subscribe before then.`, cost, 'If you don’t, nothing is deleted: the team turns read-only, so everyone can still look and export, until an owner subscribes.']
          : [`${team} is read-only now. Everyone can still sign in, look around and export, and nothing has been deleted.`, `Subscribe to pick up right where you left off. ${cost}`],
        button: { label: 'Subscribe', url },
        foot: 'You’re getting this because you own the team. Questions? Just reply.',
      }),
    });
  };

  return { mode, send, customerEmail, codeEmail, alertEmail, resetEmail, inviteEmail, emailChanged, teamDeleting, teamKept, accountDeleted, exportReady, welcomeEmail, trialEmail };
}
