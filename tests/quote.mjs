import WebSocket from '../server/node_modules/ws/index.js';
const B = 'http://127.0.0.1:4797';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const req = (tok) => async (m, p, body, raw) => { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); if (raw) return { status: r.status, body: j }; if (!r.ok) throw new Error(p + ' ' + r.status + ' ' + JSON.stringify(j)); return j; };
const a = await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: 'q' + Date.now(), password: 'secret1', name: 'Jo', mode: 'create', device: 'x', deviceId: 'd1' }) })).json();
const A = req(a.token);
const heard = [];
const ws = new WebSocket(`ws://127.0.0.1:4797/ws?t=${a.token}`);
ws.on('message', (d) => heard.push(JSON.parse(d)));
await new Promise((r) => ws.on('open', r));
const p = await A('POST', '/api/projects', { template: 'bids', name: 'Estimating' });
ok(p.types.map((t) => t.key).join() === 'quotes,bids,jobs,clients,price_list', 'Bids & Quotes: quotes, bids, clients, price list');
const T = Object.fromEntries(p.types.map((t) => [t.key, t]));
const F = (t, k) => T[t].fields.find((f) => f.key === k);
const add = (t, values) => A('POST', `/api/projects/${p.id}/records`, { typeId: T[t].id, values });
const cl = await add('clients', { name: 'Desert Auto <b>', contact: 'Maria Lopez', email: 'maria@desertauto.com', address: '12 Main St, Las Vegas', kind: 'Business' });
const film = await add('price_list', { item: 'Ceramic film install', unit: 'window', price: 185, cost: 70 });
const q1 = await add('quotes', { title: 'Showroom tint', client: cl.id, valid_until: '2099-12-31', terms: 'Net 15.\nWarranty: lifetime.', items: { rows: [
  { desc: 'Ceramic film install', qty: 12, unit: 'window', price: 185, cost: 70, from: film.id },
  { desc: 'Old film removal', qty: 4, unit: 'window', price: 40, cost: 10 },
  { desc: 'Permit fee', qty: 1, price: 75, taxable: false } ], taxRate: 8.375, discount: { type: 'percent', value: 10 } } });
const q2 = await add('quotes', { title: 'Second' });
ok(q1.values[F('quotes', 'number').id] === 'Q-1001' && q2.values[F('quotes', 'number').id] === 'Q-1002', 'quotes are numbered Q-1001, Q-1002');
const it = q1.values[F('quotes', 'items').id];
ok(it.rows.length === 3 && it.rows[0].price === 18500 && it.rows[0].cost === 7000 && it.rows[2].taxable === false && it.rows[0].from === film.id && it.discount.value === 10, 'line items kept in cents, with cost, taxability and the price-list item');
await A('PATCH', `/api/records/${q2.id}`, { values: { [F('quotes', 'number').id]: 'Q-9' } });
ok((await A('GET', `/api/projects/${p.id}/records`)).find((r) => r.id === q2.id).values[F('quotes', 'number').id] === 'Q-1002', 'the number can’t be changed by hand');
// API totals: subtotal 12*185 + 4*40 + 75 = 2220 + 160 + 75 = 2455; discount 10% = 245.5 -> 24550c ; taxable 2380 * 0.9 * 8.375% = 179.3925 -> 17939c ; total = 245500 - 24550 + 17939 = 238889
const key = await A('POST', '/api/integrations/keys', { name: 't' });
const V = req(key.token);
const out = await V('GET', `/api/v1/projects/${p.id}/quotes/records/${q1.id}`);
const items = out.fields.items;
ok(items.subtotal === 2455 && items.discount_total === 245.5 && items.tax === 179.39 && items.total === 2388.89, `API totals: ${items.subtotal} − ${items.discount_total} + ${items.tax} = ${items.total}`);
ok(items.cost === 880 && items.margin === 1329.5 && items.margin_percent === 60.2, `cost $${items.cost}, margin $${items.margin} (${items.margin_percent}%)`);
ok(out.fields.number === 'Q-1001' && (await V('GET', `/api/v1/projects/${p.id}`)).types[0].fields.find((f) => f.key === 'number').read_only, 'the API shows the number as read-only');
const viaApi = await V('POST', `/api/v1/projects/${p.id}/quotes/records`, { fields: { title: 'From API', items: { rows: [{ description: 'Service call', qty: 1, price: 95 }] } } });
ok(viaApi.fields.items.total === 95 && viaApi.fields.number === 'Q-1003', 'an API quote gets line items and the next number');
// a bid with an estimate and plans
const plan = await (await fetch(B + '/api/upload?name=plans.pdf&type=application/pdf', { method: 'PUT', headers: { authorization: 'Bearer ' + a.token }, body: Buffer.from('%PDF-1.4 test') })).json();
const bid = await add('bids', { job: 'Henderson Library glazing', client: cl.id, status: 'Estimating', bid_due: '2026-11-15', plans: [plan.id], estimate: { rows: [{ desc: 'Film, 3,200 sq ft', qty: 3200, unit: 'sq ft', price: 9.5, cost: 4.1 }] } });
ok(bid.values[F('bids', 'plans').id][0] === plan.id && bid.values[F('bids', 'estimate').id].rows[0].price === 950, 'a bid holds its plans and an estimate');
// send the quote
const sent = await A('POST', `/api/records/${q1.id}/share`, { hours: 0 });
ok(sent.share.token && F('quotes', 'status').choices.find((c) => c.id === sent.values[F('quotes', 'status').id]).label === 'Sent' && sent.values[F('quotes', 'issued').id], 'sending makes a link, marks it Sent and dates it');
const url = `${B}/q/${sent.share.token}`;
let page = await (await fetch(url)).text();
ok(page.includes('Q-1001 · Showroom tint') && page.includes('Desert Auto &lt;b&gt;') && page.includes('$2,388.89') && page.includes('Tax (8.375%)') && page.includes('Discount (10%)') && page.includes('Net 15.<br>Warranty'), 'the customer page shows the quote, client (escaped), totals and terms');
ok(!page.includes('70') || !page.includes('$70.00'), 'it never shows our cost');
ok(!page.includes('<script'), 'no scripts on the page');
await new Promise((r) => setTimeout(r, 200));
let recs = await A('GET', `/api/projects/${p.id}/records`);
const stOf = (r) => F('quotes', 'status').choices.find((c) => c.id === r.values[F('quotes', 'status').id])?.label;
ok(stOf(recs.find((r) => r.id === q1.id)) === 'Viewed', 'opening it marks the quote Viewed');
// accept
const acc = await fetch(url + '/accept', { method: 'POST', body: new URLSearchParams({ name: 'Maria Lopez' }), redirect: 'manual' });
ok(acc.status === 303, 'accepting redirects back to the page');
recs = await A('GET', `/api/projects/${p.id}/records`);
const q1n = recs.find((r) => r.id === q1.id);
ok(stOf(q1n) === 'Accepted' && q1n.values[F('quotes', 'accepted_by').id] === 'Maria Lopez' && q1n.values[F('quotes', 'accepted_on').id], 'accepted, by Maria Lopez, dated');
await new Promise((r) => setTimeout(r, 200));
ok(heard.some((m) => m.type === 'quote:answer' && m.act === 'accept' && m.name === 'Maria Lopez' && m.total === 238889), 'the team hears it was accepted, with the total');
page = await (await fetch(url)).text();
ok(page.includes('✓ Accepted by Maria Lopez') && !page.includes('<form'), 'the page now says accepted, with no form');
await fetch(url + '/decline', { method: 'POST', body: new URLSearchParams({ name: 'Someone' }), redirect: 'manual' });
ok(stOf((await A('GET', `/api/projects/${p.id}/records`)).find((r) => r.id === q1.id)) === 'Accepted', 'an answered quote can’t be answered again');
// decline another
const q4 = await add('quotes', { title: 'Lobby', valid_until: '2099-01-01', items: { rows: [{ desc: 'x', qty: 1, price: 100 }] } });
const s4 = await A('POST', `/api/records/${q4.id}/share`, {});
await fetch(`${B}/q/${s4.share.token}/decline`, { method: 'POST', body: new URLSearchParams({ name: 'Ben', reason: 'Went with another shop' }), redirect: 'manual' });
const q4n = (await A('GET', `/api/projects/${p.id}/records`)).find((r) => r.id === q4.id);
ok(stOf(q4n) === 'Declined' && q4n.values[F('quotes', 'accepted_by').id] === 'Declined by Ben: Went with another shop', 'declined, with who and why');
// accept needs a name
const q5 = await add('quotes', { title: 'Name check', items: { rows: [{ desc: 'x', qty: 1, price: 10 }] } });
const s5 = await A('POST', `/api/records/${q5.id}/share`, {});
await fetch(`${B}/q/${s5.share.token}/accept`, { method: 'POST', body: new URLSearchParams({ name: '' }), redirect: 'manual' });
ok(stOf((await A('GET', `/api/projects/${p.id}/records`)).find((r) => r.id === q5.id)) === 'Sent', 'accepting without a name does nothing');
// expired
const q6 = await add('quotes', { title: 'Old', valid_until: '2020-01-01', items: { rows: [{ desc: 'x', qty: 1, price: 10 }] } });
const s6 = await A('POST', `/api/records/${q6.id}/share`, {});
page = await (await fetch(`${B}/q/${s6.share.token}`)).text();
ok(page.includes('This quote expired on January 1, 2020') && !page.includes('<form'), 'a quote past its date says it expired and can’t be accepted');
// turning the link off
await A('DELETE', `/api/records/${q6.id}/share`);
ok((await fetch(`${B}/q/${s6.share.token}`)).status === 404, 'turning the link off stops it');
ok((await fetch(`${B}/q/nonsense`)).status === 404, 'a made-up link finds nothing');
ws.close();
