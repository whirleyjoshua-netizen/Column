// One component's rule must not restyle another's (live check 2026-11-20): a second bare `.lead-row {}` (the lead form's
// rows, 92307a6) turned the campaigns Overview rows into a centered column, and a second bare `.need-row {}` (a step's
// needs, a0de809) pushed the text of every Home, HQ and board "needs you" row to the far right. A class that more than
// one part of the app uses keeps one bare rule; the others are scoped to their container. A third, `.cal-add` (the
// Boards calendar "+", 79e51ad, opacity 0), hid the Connect Google/Outlook/Apple Calendar buttons; that "+" is `.cal-new` now.
import fs from 'node:fs';
const css = fs.readFileSync(new URL('../client/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
// Top-level rules only (not inside @media), whose selector list includes the bare class.
const top = [];
let depth = 0, start = 0;
for (let i = 0; i < css.length; i++) {
  if (css[i] === '{') { if (depth === 0) top.push({ sel: css.slice(start, i).trim(), at: i }); depth++; }
  else if (css[i] === '}') { depth--; if (depth === 0) start = i + 1; }
}
const bare = (cls) => top.filter((r) => !r.sel.startsWith('@') && r.sel.split(',').some((s) => s.trim() === cls));
for (const cls of ['.lead-row', '.need-row', '.cal-add']) {
  const n = bare(cls).length;
  ok(n === 1, `${cls} has one bare rule (found ${n}); other uses are scoped to their container`);
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
