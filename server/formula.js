// Formulas: a field worked out from a record's other fields, like {Price} * {Qty} or {Expires} - today().
// Read by a small parser here (never eval): numbers, fields in braces, + - * / and brackets, comparisons
// (< <= > >= = !=, true is 1), and a few functions: if(test, yes, no), round(x, places), min, max, abs, today().
// A formula is kept with its fields by id ({#id}), so renaming a field doesn't break it; the app shows names.
// Dates count in days (a date is the number of days since 1970), so {Due} - today() is the days left and
// {Start} + 30 is a date 30 days on.
export const FORMATS = ['number', 'money', 'days', 'date'];
const FNS = { if: [3, 3], round: [1, 2], min: [1, 20], max: [1, 20], abs: [1, 1], today: [0, 0] };
const MAX_LEN = 300, MAX_TOKENS = 120, MAX_DEPTH = 20;

function tokens(text) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|\{([^{}]{1,80})\}|([A-Za-z_]\w*)|(<=|>=|!=|==|[-+*/(),<>=]))/y;
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    if (/^\s*$/.test(s.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`“${s.slice(i).trim().slice(0, 12)}” isn’t something a formula understands.`);
    i = re.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'field', v: m[2].trim() });
    else if (m[3] !== undefined) out.push({ k: 'name', v: m[3].toLowerCase() });
    else out.push({ k: 'op', v: m[4] === '==' ? '=' : m[4] });
    if (out.length > MAX_TOKENS) throw new Error('That formula is too long.');
  }
  return out;
}

// Text → a tree. resolve(name) gives a field's id (or null); "{#id}" is a field by id already.
export function parse(text, resolve) {
  const s = String(text ?? '').trim();
  if (!s) throw new Error('Write the formula.');
  if (s.length > MAX_LEN) throw new Error('That formula is too long.');
  const tk = tokens(s);
  let i = 0;
  const peek = () => tk[i];
  const isOp = (v) => tk[i]?.k === 'op' && tk[i].v === v;
  const need = (v) => { if (!isOp(v)) throw new Error(`Something’s missing ${i < tk.length ? 'before “' + (tk[i].v ?? '') + '”' : 'at the end'}.`); i++; };
  const depth = { n: 0 };
  const deeper = (f) => { if (++depth.n > MAX_DEPTH) throw new Error('That formula has too many brackets.'); try { return f(); } finally { depth.n--; } };
  const compare = () => {
    let a = sum();
    while (tk[i]?.k === 'op' && ['<', '<=', '>', '>=', '=', '!='].includes(tk[i].v)) { const op = tk[i++].v; a = { op, a, b: sum() }; }
    return a;
  };
  const sum = () => {
    let a = term();
    while (isOp('+') || isOp('-')) { const op = tk[i++].v; a = { op, a, b: term() }; }
    return a;
  };
  const term = () => {
    let a = unary();
    while (isOp('*') || isOp('/')) { const op = tk[i++].v; a = { op, a, b: unary() }; }
    return a;
  };
  const unary = () => (isOp('-') ? (i++, { op: 'neg', a: unary() }) : isOp('+') ? (i++, unary()) : atom());
  const atom = () => deeper(() => {
    const x = peek();
    if (!x) throw new Error('Something’s missing at the end.');
    if (x.k === 'num') { i++; return { n: x.v }; }
    if (x.k === 'field') {
      i++;
      const id = x.v.startsWith('#') ? x.v.slice(1) : resolve(x.v);
      if (!id || !resolve(id, true)) throw new Error(`There’s no field called “${x.v.replace(/^#/, '')}”.`);
      return { f: id };
    }
    if (x.k === 'name') {
      if (x.v === 'true' || x.v === 'false') { i++; return { n: x.v === 'true' ? 1 : 0 }; }
      const ar = FNS[x.v];
      if (!ar) throw new Error(`“${x.v}” isn’t a formula function. Use if, round, min, max, abs or today.`);
      i++;
      need('(');
      const args = [];
      if (!isOp(')')) { args.push(compare()); while (isOp(',')) { i++; args.push(compare()); } }
      need(')');
      if (args.length < ar[0] || args.length > ar[1]) throw new Error(`${x.v}() takes ${ar[0] === ar[1] ? ar[0] : `${ar[0]} to ${ar[1]}`} value${ar[1] === 1 ? '' : 's'}.`);
      return { fn: x.v, args };
    }
    if (isOp('(')) { i++; const e = compare(); need(')'); return e; }
    throw new Error(`“${x.v}” is in the wrong place.`);
  });
  const tree = compare();
  if (i < tk.length) throw new Error(`“${tk[i].v}” is in the wrong place.`);
  return tree;
}

// The fields a tree reads.
export const refs = (tree, out = new Set()) => {
  if (!tree) return out;
  if (tree.f) out.add(tree.f);
  if (tree.a) refs(tree.a, out);
  if (tree.b) refs(tree.b, out);
  for (const x of tree.args || []) refs(x, out);
  return out;
};

// The formula as it's kept: its fields by id.
export function store(text, resolve) {
  parse(text, resolve);
  return String(text).trim().replace(/\{([^{}]{1,80})\}/g, (m, name) => (name.trim().startsWith('#') ? m : `{#${resolve(name.trim())}}`));
}

// Works a tree out. get(id) is a field's value as a number (or null when empty); today is a day number.
// null when it can't be worked out (an empty date, dividing by zero).
export function evaluate(tree, get, today) {
  const ev = (x) => {
    if (x.n !== undefined) return x.n;
    if (x.f) return get(x.f);
    if (x.fn) {
      if (x.fn === 'today') return today;
      if (x.fn === 'if') { const c = ev(x.args[0]); return c ? ev(x.args[1]) : ev(x.args[2]); }
      const vals = x.args.map(ev);
      if (vals.some((v) => v == null)) return null;
      if (x.fn === 'round') { const k = 10 ** Math.max(0, Math.min(6, Math.round(vals[1] ?? 0))); return Math.round(vals[0] * k) / k; }
      if (x.fn === 'min') return Math.min(...vals);
      if (x.fn === 'max') return Math.max(...vals);
      if (x.fn === 'abs') return Math.abs(vals[0]);
    }
    if (x.op === 'neg') { const a = ev(x.a); return a == null ? null : -a; }
    const a = ev(x.a), b = ev(x.b);
    if (a == null || b == null) return x.op === '=' ? (a == null && b == null ? 1 : 0) : x.op === '!=' ? (a == null && b == null ? 0 : 1) : null;
    switch (x.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b === 0 ? null : a / b;
      case '<': return a < b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '=': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
    }
    return null;
  };
  const v = ev(tree);
  return v == null || !Number.isFinite(v) ? null : v;
}

// Days since 1970 ⇄ "YYYY-MM-DD".
export const dayNum = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5) : null);
export const numDay = (n) => new Date(Math.round(n) * 864e5).toISOString().slice(0, 10);

// Rollups: a field that adds up (counts, averages…) a field across the records a link field points at.
export const ROLLUP_FNS = ['count', 'sum', 'avg', 'min', 'max', 'checked'];
