// Rules and approvals: what people on the team (and, later, Kloomie's agents) may do by themselves, what needs an
// owner's OK first, and what isn't allowed at all. These are enforced here, on the server, not just asked of the AI.
//
// When someone tries something that needs an OK, nothing changes: the request is kept as an approval, the people
// who can approve hear about it, and approving it replays that same request as the person who asked, so it lands
// exactly as they meant it (or fails with the reason, if the thing is gone by then). Owners can always act, and so
// can admins when the team lets admins approve.

export const ACTIONS = {
  discount: { name: 'Giving a discount', what: 'a discount', unit: 'percent', over: 10, about: 'On a job’s or quote’s price lines.' },
  invoice: { name: 'Sending an invoice', what: 'an invoice', unit: 'dollars', over: 5000, about: 'Sending it to the customer.' },
  deleteRecord: { name: 'Deleting a job or record', what: 'deleting a job or record', about: 'Jobs, quotes, leads: anything in Jobs & projects.' },
};
const LEVELS = ['auto', 'approval', 'never'];
const KEEP_DAYS = 60;

export function rulesModule({ db, save, broadcast, rid, cleanText, readJson, send, notify, replay }) {
  db.approvals ||= {};
  const rulesOf = (ws) => {
    const r = ws.rules || {};
    return {
      approvers: r.approvers === 'admins' ? 'admins' : 'owners',
      ...Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, { level: LEVELS.includes(r[k]?.level) ? r[k].level : 'auto', ...(a.unit ? { over: Number.isFinite(r[k]?.over) ? r[k].over : a.over } : {}) }])),
    };
  };
  const roleOf = (ws, memberId) => ws.members.find((m) => m.id === memberId)?.role;
  const approverIds = (ws) => ws.members.filter((m) => m.role === 'owner' || (rulesOf(ws).approvers === 'admins' && m.role === 'admin')).map((m) => m.id);
  const canApprove = (ws, memberId) => approverIds(ws).includes(memberId);
  const amountText = (action, n) => (ACTIONS[action].unit === 'percent' ? `${Math.round(n * 10) / 10}%` : ACTIONS[action].unit === 'dollars' ? `$${Math.round(n).toLocaleString('en-US')}` : '');
  const ruleText = (action, r) => `${ACTIONS[action].name}${ACTIONS[action].unit ? ` over ${amountText(action, r.over)}` : ''}`;
  const publicApproval = ({ wsId, req, ...x }) => x;
  const news = (wsId) => broadcast(wsId, { type: 'approvals' });

  // The check at the point of action. null: go ahead. Otherwise { status, body } to send instead of doing it.
  // amount: the size of the thing (a percent, or dollars) for rules with a limit; req: the request to replay.
  function hold(ws, auth, action, { amount = 0, summary = '', target = null, req = null } = {}) {
    const r = rulesOf(ws)[action];
    if (!r || r.level === 'auto') return null;
    if (ACTIONS[action].unit && !(amount > r.over)) return null;
    if (auth.approved && db.approvals[auth.approved]?.action === action) return null;
    if (canApprove(ws, auth.memberId)) return null;
    if (r.level === 'never') return { status: 403, body: { error: `${ruleText(action, r)} isn’t allowed on this team.` } };
    const x = {
      id: rid(), wsId: ws.id, action, amount, summary: cleanText(summary, 300) || ACTIONS[action].name, target,
      req: req ? { method: req.method, path: req.path, body: req.body } : null,
      by: auth.member, byId: auth.memberId, at: Date.now(), status: 'pending',
    };
    db.approvals[x.id] = x;
    save();
    for (const id of approverIds(ws)) notify(ws.id, id, { title: `${auth.member} needs your OK`, text: x.summary, kind: 'approval', go: 'approval:' + x.id });
    news(ws.id);
    const names = ws.members.filter((m) => approverIds(ws).includes(m.id)).map((m) => m.name);
    return { status: 202, body: { pending: true, approval: publicApproval(x), error: `That needs an OK first (${ruleText(action, r).toLowerCase()}). Sent to ${names.join(' and ') || 'the owner'}.` } };
  }

  // Approving replays the request as the person who asked; it either lands or fails with the reason.
  async function decide(ws, auth, x, yes, note) {
    x.status = yes ? 'approved' : 'declined';
    Object.assign(x, { decidedBy: auth.member, decidedById: auth.memberId, decidedAt: Date.now(), note: cleanText(note, 300) });
    if (yes && x.req) {
      if (!ws.members.some((m) => m.id === x.byId)) {
        x.status = 'failed';
        x.error = `${x.by} isn’t on the team any more.`;
      } else {
        const out = await replay(ws, x.byId, x.id, x.req);
        if (out.status >= 300) {
          x.status = 'failed';
          x.error = cleanText(out.body?.error, 300) || 'It couldn’t be done any more.';
        }
      }
    }
    save();
    const said = { approved: 'approved', declined: 'declined', failed: 'approved, but it couldn’t be done' }[x.status];
    notify(ws.id, x.byId, { title: `${auth.member} ${said} your request`, text: [x.summary, x.error, x.note].filter(Boolean).join(' · '), kind: 'approval', go: 'approval:' + x.id });
    news(ws.id);
    return x;
  }

  function list(ws, auth) {
    const cut = Date.now() - KEEP_DAYS * 864e5;
    for (const x of Object.values(db.approvals)) if (x.wsId === ws.id && x.status !== 'pending' && (x.decidedAt || x.at) < cut) delete db.approvals[x.id];
    const mine = canApprove(ws, auth.memberId);
    return Object.values(db.approvals).filter((x) => x.wsId === ws.id && (mine || x.byId === auth.memberId)).sort((a, b) => b.at - a.at).slice(0, 100).map(publicApproval);
  }
  const state = (ws, auth) => ({ rules: rulesOf(ws), actions: ACTIONS, canApprove: canApprove(ws, auth.memberId), approvals: list(ws, auth) });

  // What the AI hears about the enforced rules, alongside the rules written in Company HQ.
  function promptLines(ws) {
    const r = rulesOf(ws);
    return Object.keys(ACTIONS).filter((k) => r[k].level !== 'auto').map((k) => `- ${ruleText(k, r[k])}: ${r[k].level === 'never' ? 'not allowed' : 'needs an owner’s OK first'}`);
  }

  // ---------- routes: /api/rules and /api/approvals ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b, c] = parts;
    const m = req.method;
    if (a === 'rules') {
      if (m === 'GET' && !b) return send(res, 200, state(ws, auth));
      if (m === 'PUT' && !b) {
        if (roleOf(ws, auth.memberId) !== 'owner') return send(res, 403, { error: 'Only team owners can change the rules.' });
        const body = await readJson(req);
        const now = rulesOf(ws);
        const next = { approvers: body.approvers === 'admins' ? 'admins' : body.approvers === 'owners' ? 'owners' : now.approvers };
        for (const k of Object.keys(ACTIONS)) {
          const v = body[k] || {};
          next[k] = { level: LEVELS.includes(v.level) ? v.level : now[k].level };
          if (ACTIONS[k].unit) {
            const n = Number(String(v.over ?? now[k].over).replace(/[$,%\s]/g, ''));
            next[k].over = Number.isFinite(n) && n >= 0 ? Math.min(n, ACTIONS[k].unit === 'percent' ? 100 : 1e9) : now[k].over;
          }
        }
        ws.rules = next;
        save();
        broadcast(ws.id, { type: 'approvals' });
        return send(res, 200, state(ws, auth));
      }
      return send(res, 405, { error: 'Method not allowed' });
    }
    if (a !== 'approvals') return null;
    if (m === 'GET' && !b) return send(res, 200, state(ws, auth));
    const x = b && db.approvals[b]?.wsId === ws.id ? db.approvals[b] : null;
    if (!x) return send(res, 404, { error: 'That request is gone.' });
    if (m === 'POST' && (c === 'approve' || c === 'decline')) {
      if (!canApprove(ws, auth.memberId)) return send(res, 403, { error: 'Only the people who approve can do that.' });
      if (x.status !== 'pending') return send(res, 409, { error: `That was already ${x.status}.` });
      const body = await readJson(req);
      await decide(ws, auth, x, c === 'approve', body.note);
      return send(res, 200, { approval: publicApproval(x), ...state(ws, auth) });
    }
    // Taking back your own request before anyone decides.
    if (m === 'DELETE' && !c) {
      if (x.byId !== auth.memberId || x.status !== 'pending') return send(res, 403, { error: 'You can only take back your own request while it’s waiting.' });
      delete db.approvals[x.id];
      save();
      news(ws.id);
      return send(res, 200, state(ws, auth));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  return { route, hold, rulesOf, promptLines, canApprove, ACTIONS };
}
