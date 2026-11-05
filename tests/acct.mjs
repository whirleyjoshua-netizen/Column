// Accounts: email sign-up and sign-in, codes, adding an email to an old login, joining logins up, forgot password.
import fs from 'node:fs';
const S = process.argv[2];
const B = 'http://127.0.0.1:4797/api';
const OFF = 'http://127.0.0.1:4795/api';
const OUTBOX = S + '/dk/data/outbox';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = (base = B) => (tok) => async (m, p, body) => {
  const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const api = call();
const mails = () => (fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []);
const lastTo = (to) => mails().filter((x) => x.to === to).at(-1);
const codeIn = (m) => m?.text.match(/\b(\d{6})\b/)?.[1];
const t = Date.now();
const ann = `ann${t}@shop.test`, bo = `bo${t}@shop.test`;

// 1. Create a team with an email
let r = await api()('POST', '/auth', { mode: 'create', workspace: 'acct a ' + t, name: 'Ann', email: ann, password: 'short7x', device: 'Mac', deviceId: 'd1' });
ok(r.status === 400 && /8 characters/.test(r.body.error), 'a new account needs a password of at least 8 characters');
r = await api()('POST', '/auth', { mode: 'create', workspace: 'acct a ' + t, name: 'Ann', email: ann, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
ok(r.status === 200 && r.body.token, 'Ann creates a team with her email');
const annTok = r.body.token;
const wsA = r.body.workspace.id;
await sleep(300);
const mail1 = lastTo(ann);
ok(mail1 && /is your Kloomie code/.test(mail1.subject) && codeIn(mail1), 'a 6-digit code is emailed to her');
let st = (await api(annTok)('GET', '/state')).body;
ok(st.me.email === ann && st.me.emailVerified === false && st.me.mail === true, 'Column knows her email, not confirmed yet');
ok(!JSON.stringify(st.workspace.members).includes(ann), 'her email isn’t shown to the rest of the team');

// 2. Codes: resend limit, wrong guesses, then the right one
r = await api(annTok)('POST', '/account/verify/send');
ok(r.status === 400 && /Wait a minute/.test(r.body.error), 'a new code can’t be asked for within a minute');
const bad = codeIn(mail1) === '000000' ? '111111' : '000000';
r = await api(annTok)('POST', '/account/verify', { code: bad });
ok(r.status === 400 && /isn’t right/.test(r.body.error), 'a wrong code is refused');
r = await api(annTok)('POST', '/account/verify', { code: codeIn(mail1) });
ok(r.status === 200 && r.body.emailVerified, 'the right code confirms her email');
r = await api(annTok)('POST', '/account/verify', { code: '123456' });
ok(r.status === 200 && r.body.emailVerified, 'confirming again is harmless');

// 3. Sign in with email; join a second team with the same account
r = await api()('POST', '/auth', { mode: 'email', email: ann.toUpperCase(), password: 'wrongpass1', device: 'Phone', deviceId: 'd2' });
ok(r.status === 401 && /don’t match/.test(r.body.error), 'a wrong password is refused (and the email can be any case)');
r = await api()('POST', '/auth', { mode: 'create', workspace: 'acct b ' + t, name: 'Bo', email: bo, password: 'bospassword', device: 'Mac', deviceId: 'd3' });
const boTok = r.body.token;
const wsB = r.body.workspace.id;
const invite = (await api(boTok)('GET', '/state')).body.workspace.inviteCode;
r = await api()('POST', '/auth', { mode: 'join', workspace: 'acct b ' + t, code: invite, name: 'Ann', email: ann, password: 'nottherightone', device: 'Mac', deviceId: 'd1' });
ok(r.status === 401 && /already has an account/.test(r.body.error), 'joining with an existing email needs that account’s password');
r = await api()('POST', '/auth', { mode: 'join', workspace: 'acct b ' + t, code: invite, name: 'Ann', email: ann, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
ok(r.status === 200, 'Ann joins Bo’s team with her account');
r = await api()('POST', '/auth', { mode: 'email', email: ann, password: 'longenough1', device: 'Phone', deviceId: 'd2', workspace: wsB });
ok(r.status === 200 && r.body.accounts?.length === 2 && r.body.workspace.id === wsB, 'signing in with her email signs her in to both teams, opening the one asked for');
ok(new Set(r.body.accounts.map((x) => x.token)).size === 2, 'with a separate sign-in for each team');

// 4. An old-style login adds an email; the old sign-in still works
r = await api()('POST', '/auth', { mode: 'create', workspace: 'acct c ' + t, name: 'Cy', password: 'cypass1', device: 'Mac', deviceId: 'd4' });
const cyTok = r.body.token;
st = (await api(cyTok)('GET', '/state')).body;
ok(st.me.email === null, 'a login made without an email has none');
r = await api(cyTok)('POST', '/account/email', { email: `cy${t}@shop.test`, password: 'nope' });
ok(r.status === 403, 'adding an email needs your password');
r = await api(cyTok)('POST', '/account/email', { email: `cy${t}@shop.test`, password: 'cypass1' });
ok(r.status === 200 && r.body.email === `cy${t}@shop.test`, 'Cy adds an email with his password');
await sleep(300);
ok(codeIn(lastTo(`cy${t}@shop.test`)), 'and gets a code to confirm it');
r = await api()('POST', '/auth', { mode: 'email', email: `cy${t}@shop.test`, password: 'cypass1', device: 'Phone', deviceId: 'd5' });
ok(r.status === 200, 'he can sign in with the email and his same password');
r = await api()('POST', '/auth', { mode: 'signin', workspace: 'acct c ' + t, name: 'Cy', password: 'cypass1', device: 'Phone', deviceId: 'd5' });
ok(r.status === 200, 'the old team-and-name sign-in still works');

// 5. Two old logins of the same person become one
r = await api()('POST', '/auth', { mode: 'join', workspace: 'acct b ' + t, code: invite, name: 'Dee', password: 'deepass', device: 'Mac', deviceId: 'd6' });
const deeTok = r.body.token;
r = await api(deeTok)('POST', '/account/email', { email: ann, password: 'deepass' });
ok(r.status === 403 && /Enter its password/.test(r.body.error), 'adding an email that has an account asks for that account’s password');
r = await api()('POST', '/auth', { mode: 'join', workspace: 'acct c ' + t, code: (await api(cyTok)('GET', '/state')).body.workspace.inviteCode, name: 'Old Ann', password: 'oldann', device: 'Mac', deviceId: 'd7' });
const oldAnnTok = r.body.token;
r = await api(oldAnnTok)('POST', '/account/email', { email: ann, password: 'longenough1' });
ok(r.status === 200, 'Ann’s old login in Cy’s team joins her account with its password');
r = await api()('POST', '/auth', { mode: 'email', email: ann, password: 'longenough1', device: 'Phone', deviceId: 'd2' });
ok(r.body.accounts?.length === 3, 'now her email signs her in to all three teams');

// 6. Forgot password
const before = mails().length;
r = await api()('POST', '/auth/forgot', { email: `nobody${t}@shop.test` });
ok(r.status === 200 && r.body.ok, 'Forgot password for an unknown email gives the same answer…');
await sleep(300);
ok(mails().length === before, '…and sends nothing');
r = await api()('POST', '/auth/forgot', { email: ann });
ok(r.status === 200, 'Ann asks to reset her password');
await sleep(300);
const resetMail = lastTo(ann);
const link = resetMail?.text.match(/https?:\/\/\S+\/reset\/([\w-]+)/);
ok(resetMail && /Reset your Kloomie password/.test(resetMail.subject) && link, 'she gets an email with a reset link');
const tk = link?.[1];
r = await api()('GET', '/public/reset/' + tk);
ok(r.status === 200 && /^a•••@shop\.test$/.test(r.body.email), 'the reset page shows her email, partly hidden');
r = await api()('POST', '/public/reset/' + tk, { password: 'short' });
ok(r.status === 400, 'a short new password is refused');
const oldTok = annTok;
r = await api()('POST', '/public/reset/' + tk, { password: 'brandnewpass' });
ok(r.status === 200, 'she chooses a new password');
ok((await api(oldTok)('GET', '/state')).status === 401, 'she’s signed out everywhere');
r = await api()('POST', '/auth', { mode: 'email', email: ann, password: 'longenough1', device: 'Phone', deviceId: 'd2' });
ok(r.status === 401, 'the old password no longer works');
r = await api()('POST', '/auth', { mode: 'email', email: ann, password: 'brandnewpass', device: 'Phone', deviceId: 'd2' });
ok(r.status === 200 && r.body.accounts.length === 3, 'the new one does, for all her teams');
r = await api()('POST', '/public/reset/' + tk, { password: 'anotherone1' });
ok(r.status === 404, 'the link works only once');
r = await api()('GET', '/public/reset/notarealtokenatall');
ok(r.status === 404, 'a made-up link finds nothing');

// 7. Owners and gates
r = await api(boTok)('POST', `/members/${(await api(boTok)('GET', '/state')).body.workspace.members.find((m) => m.name === 'Ann').id}/reset`);
ok(r.status === 400 && /Forgot password/.test(r.body.error), 'an owner can’t clear the password of someone with an email; they’re pointed to Forgot password');
r = await api(cyTok)('POST', '/mail', {});
ok(r.status === 403 && /Confirm your email/.test(r.body.error), 'campaign email waits until your email is confirmed');
r = await api(boTok)('GET', '/mail');
ok(r.status !== 403, 'looking at campaign email doesn’t');

// 8. A server without email
r = await call(OFF)()('POST', '/auth/forgot', { email: ann });
ok(r.status === 400 && /isn’t set up/.test(r.body.error), 'without email set up, Forgot password says so');
r = await call(OFF)()('POST', '/auth', { mode: 'create', workspace: 'acct off ' + t, name: 'Eve', email: `eve${t}@shop.test`, password: 'evepassword', device: 'Mac', deviceId: 'd8' });
ok(r.status === 200, 'teams can still be made with an email');
st = (await call(OFF)(r.body.token)('GET', '/state')).body;
ok(st.me.email === `eve${t}@shop.test` && st.me.mail === false, 'the email is kept, with no code to confirm');
r = await call(OFF)(r.body.token)('POST', '/mail', {});
ok(r.status !== 403 || !/Confirm your email/.test(r.body?.error || ''), 'and nothing waits on confirming it');

// 9. Forgot password is limited
let limited = false;
for (let i = 0; i < 12 && !limited; i++) limited = (await api()('POST', '/auth/forgot', { email: bo })).status === 429;
ok(limited, 'asking for reset links again and again is stopped');
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
