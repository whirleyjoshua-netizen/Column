// The live check of 2026-11-20 found the word "null" on screen (Team → Weeks ahead, a job's Quote total). The DOM's
// own append / replaceChildren / prepend / before / after write a null as the text "null"; only our h() skips it.
// This fails when a `cond ? x : null` (or `? null :`) is passed straight to one of those.
import fs from 'node:fs';
const file = new URL('../client/' + (process.argv[3] || 'app.js'), import.meta.url);
const s = fs.readFileSync(file, 'utf8');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const found = [];
const re = /\.(append|replaceChildren|prepend|before|after)\(/g;
let m;
while ((m = re.exec(s))) {
  const i = m.index + m[0].length;
  let d = 1, j = i, str = null;
  const top = new Set();
  for (; j < s.length; j++) {
    const c = s[j];
    if (str) { if (c === '\\') { j++; continue; } if (c === str) str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) { d--; if (d === 0) break; }
    else if (d === 1) top.add(j);
  }
  const seg = s.slice(i, j);
  const rx = /([?:])\s*null\b/g;
  let k;
  while ((k = rx.exec(seg))) if (top.has(i + k.index)) found.push(s.slice(0, i + k.index).split('\n').length);
}
ok(found.length === 0, 'nothing hands null to the DOM’s append/replaceChildren (it would show “null”)' + (found.length ? ': lines ' + found.join(', ') : ''));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
