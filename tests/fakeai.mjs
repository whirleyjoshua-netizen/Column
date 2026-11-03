import http from 'node:http';
import fs from 'node:fs';
const log = process.argv[2];
http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-test', last_id: 'claude-test' }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    const user = JSON.stringify(j.messages);
    fs.appendFileSync(log, JSON.stringify({ sys: sys.slice(0, 300), user }) + '\n');
    let out;
    if (sys.includes('helping a small business team move one')) {
      out = { read: 'Ben is interested and waiting on pricing for 14 vans since the last call.', steps: [
        { kind: 'task', text: 'Send Ben fleet pricing', due: '2026-11-03', why: 'He asked for it on the call' },
        { kind: 'stage', field: 'Stage', to: 'Customer', why: 'test' },
        { kind: 'stage', field: 'Stage', to: 'Martian', why: 'should be dropped' },
        { kind: 'message', channel: 'email', subject: 'Fleet pricing', text: 'Hi Ben, here is the pricing for your 14 vans.', why: 'Keep it moving' } ] };
    } else if (sys.includes('You are an estimator')) {
      const id = (user.match(/\[([\w-]{8,24})\] Ceramic/) || [])[1];
      const hasPdf = /"type":"document"|application\/pdf|"mime":"application\/pdf"/.test(user);
      out = { rows: [{ desc: 'Ceramic film, 12 windows', qty: 12, unit: 'window', from: id || null, price: 999 }, { desc: 'Ladder rental', qty: 1, unit: 'day', price: 85, cost: 60 }], assumptions: ['12 windows from plan sheet A2', 'pdf seen: ' + hasPdf], questions: ['Are the skylights included?'] };
    } else if (sys.includes('You are Sidekick')) out = { reply: 'Here is a report doc.', title: 'Fleet check-in', cards: [{ type: 'note', title: 'Fleet push · weekly report', template: 'report', text: '# What worked\n- Two **booked** demos\n# Next week\n- [ ] Call the rest', why: 'You asked how it went' }] };
    else if (sys.includes('Write the whole doc')) out = { text: '[[live:2]]\n# What worked\n- Calls to **Desert Auto** landed\n# What didn’t\n- [few callbacks]\n# Next week\n- [ ] Book 3 demos', title: 'AI title' };
    else if (sys.includes('Rewrite the selected text so it reads better')) out = { text: 'Much **better** words' };
    else if (sys.includes('Write what they ask for')) out = { text: '- First point\n- Second point' };
    else out = { text: 'ok' };
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
}).listen(4799);
