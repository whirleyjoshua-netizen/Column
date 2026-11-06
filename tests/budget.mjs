// Campaign budgets: what a campaign may spend, measured against money out tagged to it and its sub-campaigns.
const B = 'http://127.0.0.1:4797/api';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const api = (tok) => async (m, p, body) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const today = new Date().toLocaleDateString('en-CA');

let r = await api(null)('POST', '/auth', { mode: 'create', workspace: 'budget ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = api(r.body.token);
await jo('PATCH', '/workspace', { tools: { bills: true } });

r = await jo('POST', '/campaigns', { name: 'Spring mailers', start: today, budget: '2,000' });
ok(r.status === 200 && r.body.budget === 200000, 'a campaign takes a budget, written like 2,000');
ok(r.body.budgetSpent === 0, 'nothing spent yet');
const c = r.body;

r = await jo('POST', '/campaigns', { name: 'Bad', budget: 'lots' });
ok(r.status === 400, 'a budget that isn’t a number is refused');

await jo('POST', '/money', { kind: 'out', amount: '450', day: today, category: 'Printing', campaignId: c.id });
await jo('POST', '/money', { kind: 'in', amount: '900', day: today, category: 'Sales', campaignId: c.id });
let st = (await jo('GET', '/state')).body;
let got = st.campaigns.find((x) => x.id === c.id);
ok(got.budgetSpent === 45000, 'money out tagged to it counts against the budget; money in doesn’t');

r = await jo('POST', '/campaigns', { name: 'Door hangers', parentId: c.id });
const sub = r.body;
await jo('POST', '/money', { kind: 'out', amount: '100.50', day: today, category: 'Printing', campaignId: sub.id });
st = (await jo('GET', '/state')).body;
got = st.campaigns.find((x) => x.id === c.id);
ok(got.budgetSpent === 55050, 'a sub-campaign’s spending counts against the main budget');
ok(!('budgetSpent' in st.campaigns.find((x) => x.id === sub.id)), 'a campaign with no budget has no budget numbers');

r = await jo('PATCH', '/campaigns/' + c.id, { budget: '2500.75' });
ok(r.body.budget === 250075, 'the budget can be changed, cents and all');
r = await jo('PATCH', '/campaigns/' + c.id, { budget: null });
ok(r.body.budget === null && !('budgetSpent' in r.body), 'clearing it takes the budget away');
r = await jo('PATCH', '/campaigns/' + c.id, { budget: '0' });
ok(r.body.budget === null, 'a budget of 0 takes it away too');

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
