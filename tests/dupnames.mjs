// The app's client is one big closure per file: a second `function x` (or `const x`) at the same level silently
// replaces or clashes with the first. The Notion import's `importSheet` replaced Contacts' own (found by contactsui).
// This fails on any name declared twice at a file's top level inside its closure (two-space indent).
import fs from 'node:fs';
let fails = 0;
for (const f of ['client/app.js', 'client/dockit.js', 'client/boardkit.js', 'client/wordkit.js', 'server/index.js', 'server/projects.js', 'server/agents.js', 'server/notion.js']) {
  const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const indent = f.startsWith('client/') || f === 'server/projects.js' ? '  ' : '';
  const re = new RegExp(`^${indent}(?:async\\s+)?(?:function\\*?\\s+([A-Za-z_$][\\w$]*)|(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=)`, 'gm');
  const seen = new Map();
  for (const m of src.matchAll(re)) {
    const name = m[1] || m[2];
    const line = src.slice(0, m.index).split('\n').length;
    if (seen.has(name)) { console.log(`FAIL ${f}: “${name}” is declared twice (lines ${seen.get(name)} and ${line})`); fails++; }
    else seen.set(name, line);
  }
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
