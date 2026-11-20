// The live check of 2026-11-20: Map → Mileage → Add a trip showed "Round trip (there and back)" one word to a line,
// spilling off the sheet. `.check` is the round 18px task tick; a label given it is squeezed to 18px wide.
// A tick box with words beside it is a label of class "pick".
import fs from 'node:fs';
const s = fs.readFileSync(new URL('../client/app.js', import.meta.url), 'utf8');
const bad = [];
s.split('\n').forEach((l, i) => { if (/h\('label',\s*\{\s*class:\s*'check[ ']/.test(l)) bad.push(i + 1); });
console.log((bad.length ? 'FAIL' : 'PASS') + ' no label wears the round task tick’s class' + (bad.length ? ': lines ' + bad.join(', ') : ''));
console.log(bad.length ? '1 failed' : 'all passed');
process.exit(bad.length ? 1 : 0);
