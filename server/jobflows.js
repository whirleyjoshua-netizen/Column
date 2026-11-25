// Job Flows (the owner, 2026-11-24; docs/jobflows/CONTRACTS.md): a team names the way a kind of job goes (a flow,
// steps from a fixed menu) and every job runs on one. A flow is a draft its owners and admins edit and publish as
// versions that never change. A job's run is a campaign of kind 'job' whose steps are goals of kind 'step'; the
// one sweep that moves every job (jobSteps in index.js) finishes them, and each step is finished only by what it
// stands for really being true on the job (a client, its fields, a visit, the checklist, the signature, an invoice
// sent or paid, its tasks, a Done button). A run is never a campaign to anyone: it lives behind the job.
export const STEP_KINDS = ['client', 'details', 'book', 'work', 'signoff', 'invoice', 'payment', 'tasks', 'custom'];
const KIND_NAME = { client: 'Add client info', details: 'Add job info', book: 'Book a visit', work: 'Do the work', signoff: 'Customer signs off', invoice: 'Send the invoice', payment: 'Collect payment', tasks: 'Tasks', custom: 'Step' };
const HOW = { client: 'tap', details: 'tap', book: 'tap', work: 'tap', signoff: 'tap', invoice: 'hand', payment: 'auto', tasks: 'tap', custom: 'hand' };
const ACTION = { client: 'pick-client', details: 'edit-fields', book: 'book-visit', work: 'checklist', signoff: 'sign', invoice: 'invoice', payment: 'payment', tasks: 'tasks', custom: 'done' };
const WHO = ['anyone', 'admins', 'role', 'member'];
const SENT = ['sent', 'viewed', 'partial', 'paid'];
const MAX_FLOWS = 50, MAX_STEPS = 30, KEY_MS = 10 * 60 * 1000;

export const isJobRun = (c) => c?.kind === 'job';
export const isJobList = (t) => !!t && (t.key === 'jobs' || String(t.key || '').startsWith('trade_'));

export function jobFlowsModule(ctx) {
  const { db, save, broadcast, rid, cleanText, readJson, send, isAdmin, PJ, toolsOf, goalsInOrder, tasksInOrder, applyTask, publicTask, canSeeTask, stepsSoon, sweepNow = (wsId) => stepsSoon(wsId), visitsOf, needsMet, noteWork = () => {} } = ctx;
  // Test only: a step with this name makes building a run throw, so the failure path can be tested from outside.
  const FAIL_STEP = process.env.NODE_ENV !== 'production' ? process.env.JOBFLOWS_FAIL_STEP || '' : '';
  db.jobFlows ||= {};
  db.jobFlowVersions ||= {};
  const keys = new Map(); // `${wsId}:${memberId}:${key}` → { sig, recordId, at }

  const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
  const copy = (x) => JSON.parse(JSON.stringify(x));
  const memberOf = (ws, id) => ws.members.find((m) => m.id === id);
  const fieldBy = (t, pred) => t?.fields.find(pred) || null;
  const filled = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

  // ---------- definitions ----------
  function listOf(ws, auth, list) {
    const p = list && db.projects[list.projectId];
    const t = p && p.types.find((x) => x.id === list.typeId);
    if (!p || p.wsId !== ws.id || !PJ.sees(p, auth.memberId) || !isJobList(t)) throw bad('Pick a job list for this flow.');
    return { p, t };
  }
  function stageLabels(t) {
    const f = fieldBy(t, (x) => x.type === 'select' && ['status', 'stage'].includes(x.key)) || fieldBy(t, (x) => x.type === 'select');
    return f ? f.choices.map((c) => c.label) : [];
  }
  // A flow's steps, cleaned. Ids stay as they were for steps the flow already had (versions keep their step ids);
  // `fresh` gives every step a new id (a copy).
  function cleanSteps(ws, t, steps, known, fresh = false) {
    if (!Array.isArray(steps) || !steps.length) throw bad('Give the flow at least one step.');
    if (steps.length > MAX_STEPS) throw bad(`A flow can have ${MAX_STEPS} steps.`);
    const stages = stageLabels(t);
    const seen = new Set();
    return steps.map((s) => {
      if (!s || !STEP_KINDS.includes(s.kind)) throw bad(`“${cleanText(s?.kind, 30) || 'That'}” isn’t a step you can add yet.`);
      let id = !fresh && typeof s.id === 'string' && known.has(s.id) && !seen.has(s.id) ? s.id : rid(8);
      seen.add(id);
      const name = cleanText(s.name, 80).trim() || KIND_NAME[s.kind];
      const w = s.who && typeof s.who === 'object' ? s.who : { type: 'anyone' };
      if (!WHO.includes(w.type)) throw bad('Pick who does each step.');
      const who = { type: w.type };
      if (w.type === 'role') {
        if (!(ws.roles || []).some((r) => r.id === w.id)) throw bad(`The role for “${name}” isn’t one of your team’s roles.`);
        who.id = w.id;
      }
      if (w.type === 'member') {
        if (!memberOf(ws, w.id)) throw bad(`The person for “${name}” isn’t on your team.`);
        who.id = w.id;
      }
      let stage = null;
      if (s.stage) {
        stage = stages.find((l) => l.toLowerCase() === String(s.stage).trim().toLowerCase()) || null;
        if (!stage) throw bad(`“${cleanText(s.stage, 40)}” isn’t a stage on this job list.`);
      }
      const st = s.settings && typeof s.settings === 'object' ? s.settings : {};
      const settings = {};
      if (s.kind === 'details' && Array.isArray(st.fields)) settings.fields = st.fields.map(String).filter((k) => t.fields.some((f) => f.key === k)).slice(0, 20);
      if (s.kind === 'book' && st.visitKind) settings.visitKind = cleanText(st.visitKind, 40);
      if (s.kind === 'work' && st.photos) settings.photos = true;
      if (s.kind === 'tasks') {
        settings.tasks = (Array.isArray(st.tasks) ? st.tasks : []).map((x) => cleanText(x, 200).trim()).filter(Boolean).slice(0, 20);
        if (!settings.tasks.length) throw bad(`Give “${name}” at least one task.`);
      }
      if (s.kind === 'custom') {
        settings.text = cleanText(st.text, 2000);
        settings.checklist = (Array.isArray(st.checklist) ? st.checklist : []).map((x) => cleanText(x, 120).trim()).filter(Boolean).slice(0, 20);
      }
      return { id, kind: s.kind, name, who, how: HOW[s.kind], canSkip: s.canSkip === true, stage, settings };
    });
  }
  const knownIds = (flow) => new Set([...(flow?.draft?.steps || []), ...Object.values(db.jobFlowVersions).filter((v) => v.flowId === flow?.id).flatMap((v) => v.body.steps)].map((s) => s.id));
  function cleanBody(ws, auth, input, flow) {
    const prev = flow?.draft || {};
    const list = input.list !== undefined ? input.list : prev.list;
    const { t } = listOf(ws, auth, list);
    return {
      list: { projectId: list.projectId, typeId: list.typeId },
      whoCreates: (input.whoCreates !== undefined ? input.whoCreates : prev.whoCreates) === 'everyone' ? 'everyone' : 'admins',
      steps: cleanSteps(ws, t, input.steps !== undefined ? input.steps : prev.steps, knownIds(flow)),
    };
  }
  const versionsOf = (flow) => Object.values(db.jobFlowVersions).filter((v) => v.flowId === flow.id).sort((a, b) => a.n - b.n);
  const activeVersion = (flow) => (flow?.activeVersionId ? db.jobFlowVersions[flow.activeVersionId] : null);
  const publicVersion = (v) => v && { id: v.id, n: v.n, body: v.body, publishedAt: v.publishedAt, publishedBy: v.publishedBy };
  const publicFlow = (flow, admin) => ({ id: flow.id, name: flow.name, icon: flow.icon, archived: !!flow.archived, activeVersionId: flow.activeVersionId, version: publicVersion(activeVersion(flow)), ...(admin ? { draft: flow.draft, createdAt: flow.createdAt, updatedAt: flow.updatedAt } : {}) });
  // Who's named on a step now: a person who left or a role that's gone leaves it to owners and admins.
  function whoNow(ws, step) {
    const w = step.who || { type: 'anyone' };
    if (w.type === 'member') { const m = memberOf(ws, w.id); return m ? { type: 'member', id: m.id, name: m.name } : { type: 'member', id: w.id, fallback: 'admins' }; }
    if (w.type === 'role') { const r = (ws.roles || []).find((x) => x.id === w.id); return r ? { type: 'role', id: r.id, name: r.name } : { type: 'role', id: w.id, fallback: 'admins' }; }
    return { type: w.type };
  }
  function mayAct(ws, auth, step) {
    if (isAdmin(auth)) return true;
    const w = whoNow(ws, step);
    if (w.fallback || w.type === 'admins') return false;
    if (w.type === 'member') return w.id === auth.memberId;
    if (w.type === 'role') return (memberOf(ws, auth.memberId)?.roleIds || []).includes(w.id);
    return true; // anyone who may edit the job: the route has already checked the job, its project and the members switch
  }

  // ---------- runs ----------
  const runsOf = (recordId) => Object.values(db.campaigns).filter((c) => isJobRun(c) && c.recordId === recordId).sort((a, b) => a.createdAt - b.createdAt);
  const activeRun = (recordId) => runsOf(recordId).find((c) => c.status === 'active') || null;
  // The run a job shows: the one going, else the last one that wasn't cancelled, else the last.
  const shownRun = (recordId) => { const all = runsOf(recordId); return all.find((c) => c.status === 'active') || all.filter((c) => c.status !== 'cancelled').at(-1) || all.at(-1) || null; };
  const stepGoals = (c) => goalsInOrder(c).filter((g) => g.kind === 'step');
  const recOf = (c) => { const r = c && db.records[c.recordId]; return r && r.wsId === c.wsId ? r : null; };
  const typeOfRec = (rec) => { const p = db.projects[rec.projectId]; return p && p.types.find((x) => x.id === rec.typeId); };
  const runInvoices = (c, rec) => Object.values(db.invoices || {}).filter((i) => i.recordId === rec.id && i.status !== 'void' && (i.createdAt || 0) >= c.createdAt);

  // What a step stands for, true or not, from the job as it is now. Changes nothing.
  function stepCondition(g, rec) {
    const c = db.campaigns[g.campaignId];
    const t = typeOfRec(rec);
    if (!c || !t) return false;
    const v = (f) => (f ? rec.values[f.id] : undefined);
    const s = g.step || {};
    switch (s.kind) {
      case 'client': {
        const id = v(fieldBy(t, (f) => f.type === 'contact'));
        return !!id && db.contacts?.[id]?.wsId === rec.wsId;
      }
      case 'details': {
        const keys = s.settings?.fields || [];
        if (!keys.length) return !!g.marked;
        return keys.every((k) => filled(v(fieldBy(t, (f) => f.key === k))));
      }
      case 'book': {
        const kind = (s.settings?.visitKind || '').toLowerCase();
        return visitsOf(rec.id).some((x) => !kind || String(x.kind || '').toLowerCase() === kind);
      }
      case 'work': {
        const cl = v(fieldBy(t, (f) => f.type === 'checklist'));
        const items = cl?.items || [];
        const ticked = fieldBy(t, (f) => f.type === 'checklist') ? items.length > 0 && items.every((i) => i.done) : !!g.marked;
        const photos = !s.settings?.photos || filled(v(fieldBy(t, (f) => f.key === 'after') || fieldBy(t, (f) => f.type === 'files')));
        return ticked && photos;
      }
      case 'signoff': {
        const sig = v(fieldBy(t, (f) => f.type === 'signature'));
        return !!(sig && sig.name && sig.image);
      }
      case 'invoice': {
        const bound = g.invoiceId && db.invoices?.[g.invoiceId];
        if (bound && bound.status !== 'void') return SENT.includes(bound.status);
        return runInvoices(c, rec).some((i) => SENT.includes(i.status));
      }
      case 'payment': {
        const ig = stepGoals(c).find((x) => x.step?.kind === 'invoice' && x.invoiceId && db.invoices?.[x.invoiceId]?.status !== 'void');
        if (ig) return db.invoices[ig.invoiceId].status === 'paid';
        const all = runInvoices(c, rec); // non-void, made since the run started; a draft is still owed
        return all.length > 0 && all.every((i) => i.status === 'paid');
      }
      case 'tasks': return tasksInOrder(g).length > 0;
      case 'custom': return !!g.marked && (s.settings?.checklist || []).every((_, i) => !!g.checks?.[i]);
      default: return false;
    }
  }
  // goalMet for a step goal: its condition, its tasks and its needs. No job → not met (never true by default).
  function stepMet(g) {
    const c = db.campaigns[g.campaignId];
    const rec = recOf(c);
    if (!rec) return false;
    return stepCondition(g, rec) && tasksInOrder(g).every((t) => t.done || t.skipped) && needsMet(g);
  }
  const metNow = (g) => !!g.skipped || stepMet(g);
  function missing(g, rec) {
    const s = g.step || {};
    const t = typeOfRec(rec);
    switch (s.kind) {
      case 'client': return 'No client on the job yet';
      case 'details': { const names = (s.settings?.fields || []).map((k) => fieldBy(t, (f) => f.key === k)).filter((f) => f && !filled(rec.values[f.id])).map((f) => f.name); return names.length ? 'Still to fill in: ' + names.join(', ') : 'Waiting for Done'; }
      case 'book': return s.settings?.visitKind ? `No ${s.settings.visitKind} visit booked` : 'No visit booked';
      case 'work': return 'The checklist isn’t all ticked' + (s.settings?.photos ? ', or the after photos are missing' : '');
      case 'signoff': return 'The customer hasn’t signed';
      case 'invoice': return 'No invoice sent';
      case 'payment': return 'Not paid yet';
      case 'tasks': { const left = tasksInOrder(g).filter((x) => !x.done && !x.skipped).length; return `${left} task${left === 1 ? '' : 's'} left`; }
      case 'custom': { const left = (s.settings?.checklist || []).filter((_, i) => !g.checks?.[i]).length; return !g.marked ? 'Waiting for Done' : `${left} checklist item${left === 1 ? '' : 's'} left`; }
      default: return 'Not done';
    }
  }
  // The run as the job's page shows it, for this person: no invoice numbers or money, only the tasks they may see.
  function runView(ws, auth, c) {
    if (!c) return null;
    const rec = recOf(c);
    const flow = db.jobFlows[c.flowId];
    const goals = stepGoals(c);
    let current = null;
    const steps = goals.map((g) => {
      const met = rec ? metNow(g) : false;
      const state = g.skipped ? 'skipped' : met ? 'done' : !current ? 'current' : 'waiting';
      if (state === 'current') current = g;
      const s = g.step;
      const out = { id: s.id, goalId: g.id, name: s.name, kind: s.kind, how: s.how, state, who: whoNow(ws, s), mayAct: mayAct(ws, auth, s), canSkip: !!s.canSkip, stage: s.stage || null, cycle: (g.reopens || 0) + (g.finished ? 1 : 0) };
      if (g.skipped) Object.assign(out, { skipReason: g.skipReason || '', skippedAt: g.skippedAt || null });
      if (s.kind === 'custom') Object.assign(out, { text: s.settings?.text || '', checklist: (s.settings?.checklist || []).map((text, i) => ({ text, done: !!g.checks?.[i] })), marked: !!g.marked });
      if (s.kind === 'details') out.fields = s.settings?.fields || [];
      if (s.kind === 'tasks') {
        const all = tasksInOrder(g);
        const seen = all.filter((x) => canSeeTask(auth, x));
        Object.assign(out, { tasks: seen.map((x) => ({ id: x.id, text: x.text, done: !!x.done, skipped: !!x.skipped, assigneeId: x.assigneeId || null })), more: all.length - seen.length });
      }
      return out;
    });
    const cur = current && steps.find((x) => x.goalId === current.id);
    return {
      id: c.id, recordId: c.recordId, flowId: c.flowId, flowName: flow?.name || c.flowName || 'Flow', icon: flow?.icon || '', versionId: c.versionId, versionN: c.versionN,
      status: c.status, startedAt: c.createdAt, done: steps.filter((x) => x.state === 'done' || x.state === 'skipped').length, total: steps.length, steps,
      current: cur ? { stepId: cur.id, name: cur.name, kind: cur.kind, action: ACTION[cur.kind], missing: rec ? missing(current, rec) : '' } : null,
      next: cur ? { stepId: cur.id, action: ACTION[cur.kind] } : null,
    };
  }
  const summary = (ws, auth, c) => { const v = runView(ws, auth, c); return v && { id: v.id, flowId: v.flowId, flowName: v.flowName, versionN: v.versionN, status: v.status, done: v.done, total: v.total, current: v.current && { stepId: v.current.stepId, name: v.current.name, kind: v.current.kind, action: v.current.action } }; };
  const tell = (c) => broadcast(c.wsId, { type: 'jobrun', recordId: c.recordId, runId: c.id, campaignId: c.id });

  // A run of a flow's version on a job: the campaign and its step goals (a Tasks step's tasks too). buildRun writes
  // nothing, so a throw leaves nothing behind; commitRun only puts what was built in place.
  function buildRun(ws, auth, rec, flow, version) {
    const now = Date.now();
    const c = {
      id: rid(), wsId: ws.id, kind: 'job', recordId: rec.id, flowId: flow.id, flowName: flow.name, versionId: version.id, versionN: version.n,
      ownerId: auth.memberId, by: auth.member, createdAt: now, name: `${flow.name} · ${PJ.recName(db.projects[rec.projectId], rec) || 'job'}`.slice(0, 80),
      brief: '', start: null, end: null, color: 'teal', status: 'active', private: false, memberIds: [], assigneeId: null, outcomes: [], methods: [], cast: [], inOrder: false, channelId: null, stackId: null, lastReportAt: null,
    };
    const goals = [], tasks = [];
    version.body.steps.forEach((step, i) => {
      if (FAIL_STEP && step.name === FAIL_STEP) throw new Error('Job Flows test: the run failed to build');
      const g = { id: rid(), wsId: ws.id, campaignId: c.id, by: auth.member, createdAt: now, title: step.name, due: null, kind: 'step', target: 1, counts: null, order: i + 1, stage: step.stage || null, staged: false, step: copy(step), marked: null, checks: [], needs: [] };
      goals.push(g);
      for (const text of step.kind === 'tasks' ? step.settings?.tasks || [] : []) {
        tasks.push(applyTask({ id: rid(), wsId: ws.id, by: auth.member, memberId: auth.memberId, createdAt: now, text: '', done: false, doneAt: null, due: null, priority: 0, goalId: g.id, assigneeId: null, recordId: rec.id }, { text }));
      }
    });
    return { c, goals, tasks };
  }
  function commitRun(run) {
    db.campaigns[run.c.id] = run.c;
    for (const g of run.goals) db.goals[g.id] = g;
    for (const t of run.tasks) db.tasks[t.id] = t;
  }
  // The sweep before the answer, so what a step action answers is what's kept (status, stage, events), as the person.
  const settle = (ws, auth) => sweepNow(ws.id, auth.member, auth.memberId);
  function afterStart(ws, auth, c, tasks) {
    for (const t of tasks) noteWork(t, null);
    save();
    for (const t of tasks) broadcast(ws.id, { type: 'task', task: publicTask(t) });
    tell(c);
    settle(ws, auth);
  }
  // A job a person may see and act on (its project, the members switch is the route's): null if not.
  function jobAt(ws, auth, id) {
    const at = PJ.recordAt(String(id || ''), ws.id, auth.memberId);
    return at && isJobList(at.t) ? at : null;
  }
  // The step a Done/skip names, in the job's going run.
  function stepAt(c, stepId) { return stepGoals(c).find((g) => g.step?.id === stepId) || null; }
  const currentGoal = (c) => stepGoals(c).find((g) => !metNow(g)) || null;
  function note(rec, text, by) { PJ.recordActivity(rec.id, { kind: 'note', note: text, by }); }

  // ---------- the Jobs list ----------
  function jobsList(ws, auth, q = {}) {
    const out = [];
    for (const p of Object.values(db.projects)) {
      if (p.wsId !== ws.id || !PJ.sees(p, auth.memberId)) continue;
      const lists = p.types.filter(isJobList);
      if (!lists.length) continue;
      for (const rec of Object.values(db.records)) {
        if (rec.projectId !== p.id) continue;
        const t = lists.find((x) => x.id === rec.typeId);
        if (!t) continue;
        const run = shownRun(rec.id);
        if (q.flow && run?.flowId !== q.flow) continue;
        const cf = fieldBy(t, (f) => f.type === 'contact');
        const contact = cf && db.contacts?.[rec.values[cf.id]];
        const sf = fieldBy(t, (f) => f.type === 'select' && ['status', 'stage'].includes(f.key));
        const df = fieldBy(t, (f) => f.key === 'scheduled');
        const name = PJ.recName(p, rec) || '';
        if (q.q && !name.toLowerCase().includes(String(q.q).toLowerCase())) continue;
        out.push({
          id: rec.id, projectId: p.id, typeId: t.id, list: t.name, name,
          client: contact && contact.wsId === ws.id ? { name: contact.name || '' } : null,
          stage: sf ? sf.choices.find((c) => c.id === rec.values[sf.id])?.label || '' : '',
          scheduled: df ? rec.values[df.id] || null : null,
          run: run ? summary(ws, auth, run) : null,
          legacy: !activeRun(rec.id) && Object.values(db.campaigns).some((c) => !isJobRun(c) && c.recordId === rec.id),
          updatedAt: rec.updatedAt,
        });
        if (out.length >= 2000) break;
      }
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // A flow a person may read: admins every one; a member only a published, unarchived flow they may start, on a job
  // list they can see.
  function mayRead(ws, auth, admin, f) {
    if (admin) return true;
    const v = !f.archived && activeVersion(f);
    if (!v || v.body.whoCreates !== 'everyone') return false;
    const pr = db.projects[v.body.list?.projectId];
    return !!(pr && pr.wsId === ws.id && PJ.sees(pr, auth.memberId) && pr.types.some((x) => x.id === v.body.list.typeId));
  }
  // ---------- routes ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d, e] = parts;
    if (a !== 'jobs' && a !== 'job-flows') return null;
    if (!toolsOf(ws).projects) return send(res, 403, { error: 'Boards are switched off for this team (Apps & Integrations → Tools).' });
    const m = req.method;
    const admin = isAdmin(auth);
    try {
      if (a === 'job-flows') {
        if (m === 'GET' && !b) {
          const flows = Object.values(db.jobFlows).filter((f) => f.wsId === ws.id && mayRead(ws, auth, admin, f)).sort((x, y) => x.createdAt - y.createdAt);
          return send(res, 200, { flows: flows.map((f) => publicFlow(f, admin)) });
        }
        if (m === 'POST' && !b) {
          if (!admin) return send(res, 403, { error: 'Only owners and admins build job flows.' });
          if (Object.values(db.jobFlows).filter((f) => f.wsId === ws.id).length >= MAX_FLOWS) return send(res, 400, { error: `A team can have ${MAX_FLOWS} job flows.` });
          const body = await readJson(req, 100_000);
          const name = cleanText(body.name, 80).trim();
          if (!name) return send(res, 400, { error: 'Give the flow a name.' });
          const flow = { id: rid(), wsId: ws.id, name, icon: cleanText(body.icon, 8) || '🧰', draft: cleanBody(ws, auth, body, null), activeVersionId: null, archived: false, createdBy: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
          db.jobFlows[flow.id] = flow;
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        const flow = b && db.jobFlows[b];
        if (!flow || flow.wsId !== ws.id || !mayRead(ws, auth, admin, flow)) return send(res, 404, { error: 'That flow is gone.' });
        if (m === 'GET' && !c) return send(res, 200, publicFlow(flow, admin));
        if (c === 'versions') {
          if (!admin) return send(res, 403, { error: 'Only owners and admins see a flow’s versions.' });
          if (m === 'GET' && !d) return send(res, 200, { versions: versionsOf(flow).map(publicVersion) });
          return send(res, 404, { error: 'A published version doesn’t change. Edit the draft and publish again.' });
        }
        if (!admin) return send(res, 403, { error: 'Only owners and admins change job flows.' });
        if (m === 'PATCH' && !c) {
          const body = await readJson(req, 100_000);
          // Everything checked first; a request that fails changes nothing.
          const n = body.name !== undefined ? cleanText(body.name, 80).trim() : flow.name;
          if (!n) return send(res, 400, { error: 'Give the flow a name.' });
          const draft = body.list !== undefined || body.steps !== undefined || body.whoCreates !== undefined ? cleanBody(ws, auth, body, flow) : flow.draft;
          Object.assign(flow, { name: n, icon: body.icon !== undefined ? cleanText(body.icon, 8) || '🧰' : flow.icon, draft, updatedAt: Date.now() });
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        if (m === 'POST' && c === 'publish') {
          const body = cleanBody(ws, auth, {}, flow); // checked again: the people and roles it names may have changed
          const v = { id: rid(), flowId: flow.id, wsId: ws.id, n: versionsOf(flow).length + 1, body: copy(body), publishedAt: Date.now(), publishedBy: auth.memberId };
          db.jobFlowVersions[v.id] = v;
          Object.assign(flow, { draft: body, activeVersionId: v.id, updatedAt: Date.now() });
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        if (m === 'POST' && c === 'copy') {
          if (Object.values(db.jobFlows).filter((f) => f.wsId === ws.id).length >= MAX_FLOWS) return send(res, 400, { error: `A team can have ${MAX_FLOWS} job flows.` });
          const src = activeVersion(flow)?.body || flow.draft;
          const { t } = listOf(ws, auth, src.list);
          const draft = { ...copy(src), steps: cleanSteps(ws, t, src.steps, new Set(), true) };
          const nf = { id: rid(), wsId: ws.id, name: `${flow.name} (copy)`.slice(0, 80), icon: flow.icon, draft, activeVersionId: null, archived: false, createdBy: auth.memberId, createdAt: Date.now(), updatedAt: Date.now() };
          db.jobFlows[nf.id] = nf;
          save();
          return send(res, 200, publicFlow(nf, true));
        }
        if (m === 'POST' && c === 'archive') {
          const body = await readJson(req, 1_000).catch(() => ({}));
          flow.archived = body.archived !== false;
          flow.updatedAt = Date.now();
          save();
          return send(res, 200, publicFlow(flow, true));
        }
        return send(res, 404, { error: 'Unknown endpoint' });
      }

      // a === 'jobs'
      if (m === 'GET' && !b) { const sp = new URL(req.url, 'http://x').searchParams; return send(res, 200, { jobs: jobsList(ws, auth, { flow: sp.get('flow'), q: sp.get('q') }) }); }
      if (m === 'POST' && !b) {
        const body = await readJson(req, 200_000);
        const flow = db.jobFlows[body.flowId];
        if (!flow || flow.wsId !== ws.id || !flow.activeVersionId) return send(res, 404, { error: 'That flow is gone.' });
        if (flow.archived) return send(res, 400, { error: 'That flow is archived, so new jobs can’t start on it.' });
        const version = activeVersion(flow);
        if (version.body.whoCreates !== 'everyone' && !admin) return send(res, 403, { error: 'Only owners and admins start jobs on this flow.' });
        const p = db.projects[version.body.list.projectId];
        const t = p && p.types.find((x) => x.id === version.body.list.typeId);
        if (!p || p.wsId !== ws.id || !PJ.sees(p, auth.memberId) || !t) return send(res, 404, { error: 'That flow’s job list is gone.' });
        const values = body.values && typeof body.values === 'object' ? { ...body.values } : {};
        if (body.contactId) { const cf = fieldBy(t, (f) => f.type === 'contact'); if (cf) values[cf.key] = String(body.contactId); }
        // A retry with the same key gives back the same job; the same key for another job is refused.
        const key = body.key ? `${ws.id}:${auth.memberId}:${cleanText(body.key, 100)}` : null;
        const sig = JSON.stringify({ f: flow.id, v: values });
        for (const [k, x] of keys) if (Date.now() - x.at > KEY_MS) keys.delete(k);
        if (key && keys.has(key)) {
          const x = keys.get(key);
          if (x.sig !== sig) return send(res, 409, { error: 'That request key was used for another job.' });
          const rec = db.records[x.recordId];
          if (rec) return send(res, 200, { job: PJ.publicRecordOf(rec), run: runView(ws, auth, shownRun(rec.id)) });
        }
        // The run is built against the job before either is kept: a throw keeps neither (nor uses up a job number).
        let run;
        const made = PJ.jobRecord(ws, p, t, auth, values, req, body, (rec) => { run = buildRun(ws, auth, rec, flow, version); });
        if (made.held) return send(res, made.held.status, made.held.body);
        const rec = made.rec;
        commitRun(run);
        if (key) keys.set(key, { sig, recordId: rec.id, at: Date.now() });
        PJ.announceRecord(rec, auth.member);
        afterStart(ws, auth, run.c, run.tasks);
        return send(res, 200, { job: PJ.publicRecordOf(rec), run: runView(ws, auth, run.c) });
      }
      const at = jobAt(ws, auth, b);
      if (!at) return send(res, 404, { error: 'That job is gone.' });
      const { rec } = at;
      if (c === 'run' && m === 'GET') return send(res, 200, { run: runView(ws, auth, shownRun(rec.id)) });
      if (c === 'flow' && m === 'POST' && !d) {
        if (!admin) return send(res, 403, { error: 'Only owners and admins put a job on a flow.' });
        const body = await readJson(req, 10_000);
        const flow = db.jobFlows[body.flowId];
        if (!flow || flow.wsId !== ws.id || !flow.activeVersionId) return send(res, 404, { error: 'That flow is gone.' });
        if (flow.archived) return send(res, 400, { error: 'That flow is archived.' });
        const version = activeVersion(flow);
        if (version.body.list?.projectId !== rec.projectId || version.body.list?.typeId !== rec.typeId) return send(res, 400, { error: `“${flow.name}” is for another job list, so it can’t go on this job.` });
        const going = activeRun(rec.id);
        if (going && body.replace !== true) return send(res, 409, { error: `This job is already on “${going.flowName}”. Replace it to start over on another flow.` });
        const run = buildRun(ws, auth, rec, flow, version);
        commitRun(run);
        if (going) { Object.assign(going, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: auth.memberId }); tell(going); note(rec, `Moved from the flow “${going.flowName}” to “${flow.name}”`, auth.member); }
        else note(rec, `Put on the flow “${flow.name}”`, auth.member);
        afterStart(ws, auth, run.c, run.tasks);
        return send(res, 200, { run: runView(ws, auth, run.c) });
      }
      if (c === 'flow' && d === 'cancel' && m === 'POST') {
        if (!admin) return send(res, 403, { error: 'Only owners and admins take a job off its flow.' });
        const going = activeRun(rec.id);
        if (!going) return send(res, 404, { error: 'This job isn’t on a flow.' });
        const body = await readJson(req, 10_000).catch(() => ({}));
        const why = cleanText(body.reason, 300).trim();
        if (!why) return send(res, 400, { error: 'Say why it’s coming off its flow.' });
        Object.assign(going, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: auth.memberId });
        note(rec, `Taken off the flow “${going.flowName}”: ${why}`, auth.member);
        save();
        tell(going);
        settle(ws, auth);
        return send(res, 200, { run: runView(ws, auth, going) });
      }
      if (c === 'steps' && d && m === 'POST') {
        // The going run, or a finished one (reopening a step puts it back to going); never a cancelled one.
        const run = activeRun(rec.id) || runsOf(rec.id).filter((x) => x.status === 'done').at(-1) || null;
        if (!run) return send(res, 404, { error: 'This job isn’t on a flow.' });
        const g = stepAt(run, d);
        if (!g) return send(res, 404, { error: 'That step isn’t on this job’s flow.' });
        const s = g.step;
        const body = await readJson(req, 10_000).catch(() => ({}));
        if (e === 'done') {
          if (!(s.kind === 'custom' || (s.kind === 'details' && !(s.settings?.fields || []).length))) return send(res, 409, { error: `“${s.name}” finishes by itself when it’s done on the job.` });
          if (!mayAct(ws, auth, s)) return send(res, 403, { error: `“${s.name}” is for ${whoNow(ws, s).name || 'owners and admins'}.` });
          if (!g.marked) {
            if (currentGoal(run)?.id !== g.id) return send(res, 409, { error: 'Finish the steps before this one first.' });
            g.marked = { byId: auth.memberId, at: Date.now() };
            save();
          }
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
        if (e === 'check') {
          if (s.kind !== 'custom') return send(res, 409, { error: 'Only your own steps have a checklist here.' });
          if (!mayAct(ws, auth, s)) return send(res, 403, { error: `“${s.name}” is for ${whoNow(ws, s).name || 'owners and admins'}.` });
          const i = Number(body.item);
          if (!Number.isInteger(i) || i < 0 || i >= (s.settings?.checklist || []).length) return send(res, 400, { error: 'That checklist item isn’t there.' });
          // Unticking an item of a finished step reopens it (and a finished run): that's a reopen, so admins only.
          if (body.done === false && g.finished && !admin) return send(res, 403, { error: `“${s.name}” is finished. Only owners and admins reopen it.` });
          g.checks = [...(g.checks || [])];
          g.checks[i] = body.done !== false;
          save();
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
        if (e === 'skip') {
          if (!admin && !(s.canSkip && mayAct(ws, auth, s))) return send(res, 403, { error: `Only owners and admins can skip “${s.name}”.` });
          const why = cleanText(body.reason, 300).trim();
          if (!why) return send(res, 400, { error: 'Say why it’s being skipped.' });
          if (!g.skipped) {
            Object.assign(g, { skipped: true, skipReason: why, skippedById: auth.memberId, skippedAt: Date.now() });
            note(rec, `Skipped “${s.name}”: ${why}`, auth.member);
            save();
          }
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
        if (e === 'reopen') {
          if (!admin) return send(res, 403, { error: 'Only owners and admins reopen steps.' });
          Object.assign(g, { skipped: false, skipReason: null, skippedById: null, skippedAt: null, marked: null });
          note(rec, `Reopened “${s.name}”`, auth.member);
          save();
          tell(run);
          settle(ws, auth);
          return send(res, 200, { run: runView(ws, auth, run) });
        }
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      if (err.status) return send(res, err.status, { error: err.message });
      throw err;
    }
  }

  // An invoice made from a run's Invoice step: that step reads it (a voided one is replaced by the next).
  function bindInvoice(rec, inv, stepId) {
    const run = activeRun(rec.id);
    const g = run && stepAt(run, stepId);
    if (!g || g.step.kind !== 'invoice') return;
    const was = g.invoiceId && db.invoices?.[g.invoiceId];
    if (!was || was.status === 'void') g.invoiceId = inv.id;
  }
  // Job deleted: its runs and their steps go; the steps' tasks stay as plain tasks.
  function dropFor(rec) {
    for (const c of runsOf(rec.id)) {
      for (const g of Object.values(db.goals)) if (g.campaignId === c.id) {
        for (const t of Object.values(db.tasks)) if (t.goalId === g.id) t.goalId = null;
        delete db.goals[g.id];
      }
      delete db.campaigns[c.id];
    }
  }

  return { route, stepMet, activeRun, isJobRun, isJobList, runsOf, bindInvoice, dropFor, tell, runView };
}
