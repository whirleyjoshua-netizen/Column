// Kloomie's agents: three specialists a person can hand work to, each with a job, the tools it may use and the
// things it produces, working as that person and through the same routes the app uses. A task an agent makes is
// a task in the Day; a job is a job in Jobs; a doc is a doc. Nothing is a separate AI-only copy.
//   - Chief of Staff: what should I be doing? (the day, the week, priorities, time)
//   - Client & Sales Manager: who needs my attention to bring money in? (leads, follow-ups, proposals)
//   - Operations Manager: what has to happen to deliver what we sold? (projects, checklists, visits, routes)
// "Ask your team" goes to the coordinator, which splits a request into assignments for the right specialists
// and passes each one what the others did.
//
// How far each agent may go is the person's choice, per agent:
//   observe  reads and reports; changes nothing, suggests
//   prepare  drafts everything; every change waits for a yes
//   execute  makes routine changes itself (tasks, time, records, docs); important ones wait for a yes
//   automate as execute, and runs its scheduled workflows on its own
// Important, always waiting for a yes: emailing anyone. Agents never delete anything. The team's own rules
// (rules.js) still apply on top: a discount over the limit waits for an owner's OK like anyone's would.
// Every change is written down: what, why, which records, and how to undo it.

export const AGENTS = {
  chief: {
    name: 'Chief of Staff', icon: '🧭', tags: 'Planning · Priorities · Calendar',
    purpose: 'Your right hand. Turns scattered responsibilities into an organized, workable day and week.',
    duties: [
      'Reviews your calendar, tasks and active projects',
      'Spots conflicts, overdue work and days that won’t fit',
      'Builds a practical schedule around what’s already booked',
      'Breaks big goals into tasks you can finish',
      'Says what to do first, what to hand off and what can wait',
      'Turns commitments in emails you paste into tasks',
      'Prepares your end-of-day summary and plans the week',
    ],
    tools: ['look_at_day', 'list_tasks', 'find_records', 'read_record', 'list_campaigns', 'team_schedule', 'plan_route', 'find_docs', 'read_doc', 'create_task', 'update_task', 'schedule_time', 'move_time', 'write_doc', 'notify_me'],
    workflows: [
      { key: 'briefing', name: 'Morning briefing', ask: 'Give me my morning briefing: what matters today, what is overdue or at risk, and the first thing I should do. Keep it short.', sched: { days: [1, 2, 3, 4, 5], at: 7 * 60 } },
      { key: 'plan_day', name: 'Plan my day', ask: 'Plan my day today: put my tasks into open time around what is already booked, most important first, with breaks, and tell me what won’t fit and what to move or hand off.' },
      { key: 'weekly', name: 'Weekly reset', ask: 'Do my weekly reset: review last week (done, slipped), everything open and coming up, and plan next week with priorities. Write it up as a doc.', sched: { days: [5], at: 15 * 60 } },
      { key: 'inbox', name: 'Inbox to action', ask: 'Here are emails I got. Find every commitment, request and deadline in them and turn each into a task with a due date:\n\n', paste: true },
      { key: 'recover', name: 'Schedule recovery', ask: 'Something came up and my day is off. Rework the rest of today: what still fits, what moves to another day, and who could take what.' },
      { key: 'eod', name: 'End-of-day summary', ask: 'Write my end-of-day summary: what got done today, what didn’t and where it went, and what tomorrow starts with.', sched: { days: [1, 2, 3, 4, 5], at: 17 * 60 } },
    ],
  },
  sales: {
    name: 'Client & Sales Manager', icon: '🤝', tags: 'Leads · Follow-ups · Proposals',
    purpose: 'Makes sure no lead, customer, proposal or follow-up falls through the cracks.',
    duties: [
      'Picks out new leads and inquiries and records them',
      'Pulls out names, contact details, what they need and by when',
      'Drafts personal replies and follow-ups for you to send',
      'Prepares proposals, estimates and sales letters as docs',
      'Tracks open proposals and unanswered inquiries',
      'Books customer meetings and prepares a brief beforehand',
      'Finds deals that have gone quiet and plans the next step',
    ],
    tools: ['find_records', 'read_record', 'list_projects', 'find_contacts', 'look_at_day', 'list_tasks', 'list_campaigns', 'team_schedule', 'find_docs', 'read_doc', 'create_task', 'update_task', 'save_contact', 'create_record', 'update_record', 'log_note', 'book_visit', 'schedule_time', 'write_doc', 'draft_email', 'notify_me'],
    workflows: [
      { key: 'lead', name: 'Handle a new lead', ask: 'A new lead came in. Record them (contact and lead or deal), draft my reply, suggest times to meet, and set the follow-up:\n\n', paste: true },
      { key: 'radar', name: 'Follow-up radar', ask: 'Run the follow-up radar: find leads, deals and quotes with no reply or no contact in a while, and set up the next step for each (a task, and a drafted follow-up email where there’s an address).', sched: { days: [1, 3, 5], at: 8 * 60 } },
      { key: 'proposal', name: 'Prepare a proposal', ask: 'Prepare a proposal for this customer as a doc, from what we know about them and the business:\n\n', paste: true },
      { key: 'meeting', name: 'Meeting prep', ask: 'I have customer meetings coming up. For each one in the next two days, write a short brief: who they are, what they want, what we’ve said so far, and what to get out of it.' },
      { key: 'report', name: 'Daily sales report', ask: 'Give me the daily sales report: new inquiries, open proposals and their value, follow-ups due, and deals gone quiet.', sched: { days: [1, 2, 3, 4, 5], at: 8 * 60 } },
      { key: 'after', name: 'After a conversation', ask: 'I just talked with a customer. Log it on their record, update where the deal stands, and set the next step:\n\n', paste: true },
    ],
  },
  ops: {
    name: 'Operations Manager', icon: '🛠️', tags: 'Projects · Checklists · Logistics',
    purpose: 'Makes sure the business delivers what it sold: the work behind the scenes, start to finish.',
    duties: [
      'Turns won work into a project with tasks and a timeline',
      'Spots dependencies, blockers and overdue deliverables',
      'Writes job checklists, work orders and procedures',
      'Tracks materials and what has to be ordered',
      'Books site visits and plans the route between them',
      'Checks project health and says what’s slipping',
      'Closes jobs out with a completion report',
    ],
    tools: ['list_projects', 'find_records', 'read_record', 'list_tasks', 'look_at_day', 'team_schedule', 'plan_route', 'find_docs', 'read_doc', 'create_project', 'create_record', 'update_record', 'log_note', 'book_visit', 'create_task', 'update_task', 'schedule_time', 'write_doc', 'draft_email', 'notify_me'],
    workflows: [
      { key: 'kickoff', name: 'Project kickoff', ask: 'We just won this work. Organize it: the job (or project), the tasks in order with who and when, a materials list, visits, and a completion checklist:\n\n', paste: true },
      { key: 'prep', name: 'Job preparation', ask: 'Prepare for the jobs coming up in the next few days: a checklist for each, what to bring or order, and anything missing before we can start.' },
      { key: 'route', name: 'Route tomorrow', ask: 'Look at tomorrow’s visits for the team and plan the routes: the best order, anything too tight, and what to move.' },
      { key: 'health', name: 'Project health check', ask: 'Run a health check on active jobs and projects: overdue work, blockers, jobs without a visit booked, and what to do about each.', sched: { days: [1], at: 7 * 60 + 30 } },
      { key: 'docs', name: 'Write a work order', ask: 'Write a work order (or checklist, or procedure) as a doc for:\n\n', paste: true },
      { key: 'closeout', name: 'Close out a job', ask: 'Close out this job: confirm what was delivered, write the completion report as a doc, and set up any follow-up (invoice, review request, warranty check):\n\n', paste: true },
    ],
  },
};
export const LEVELS = ['observe', 'prepare', 'execute', 'automate'];
const KEEP_RUNS = 80;
const MAX_PARTS = 4;
const MAX_TURN_CHARS = 30_000;

export function agentsModule({ db, save, broadcast, rid, cleanText, readJson, send, notify, replay, run: llmRun, sendEmail, textToDoc, PJ, isAdminId, localNow, tzOf, fmtMinutes, hasAi = () => true }) {
  db.agentRuns ||= {};
  db.agentPrefs ||= {};
  const prefKey = (wsId, memberId) => `${wsId}:${memberId}`;
  // Each person's own settings for each agent: how far it may go, standing instructions, and when it runs.
  function prefsOf(wsId, memberId) {
    const p = db.agentPrefs[prefKey(wsId, memberId)] || {};
    return Object.fromEntries(Object.keys(AGENTS).map((k) => [k, {
      level: LEVELS.includes(p[k]?.level) ? p[k].level : 'execute',
      instructions: p[k]?.instructions || '',
      schedules: Array.isArray(p[k]?.schedules) ? p[k].schedules : [],
      paused: !!p[k]?.paused,
    }]));
  }
  const memberOf = (ws, id) => ws.members.find((m) => m.id === id);
  // v counts changes, so the app never swaps a newer copy for an older one that arrives late.
  // A deleted assignment stays deleted, even if its last model call comes back afterwards.
  const news = (x) => { if (db.agentRuns[x.id] !== x) return; x.v = (x.v || 0) + 1; broadcast(x.wsId, { type: 'agent', run: publicRun(x), forMember: x.memberId }); };
  const publicRun = ({ wsId, history, ...x }) => x;
  const runsOf = (wsId, memberId) => Object.values(db.agentRuns).filter((x) => x.wsId === wsId && x.memberId === memberId).sort((a, b) => b.createdAt - a.createdAt);

  // ---------- reading: what the person can see, from the same view the app loads for them ----------
  const hm = (m) => (m == null ? '' : fmtMinutes(m));
  const parseTime = (s) => {
    if (s == null || s === '') return null;
    if (Number.isFinite(Number(s))) return Math.max(0, Math.min(1440, Math.round(Number(s))));
    const m = String(s).trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]) % 24;
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    return h * 60 + Number(m[2] || 0);
  };
  const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const nameOf = (ws, id) => memberOf(ws, id)?.name || null;
  const words = (s, n = 300) => cleanText(String(s ?? '').replace(/\s+/g, ' '), n);
  const fieldWords = (ws, p, t, f, v) => {
    if (v == null || v === '') return null;
    if (f.type === 'select') return f.choices?.find((c) => c.id === v)?.label || null;
    if (f.type === 'multi') return (v || []).map((id) => f.choices?.find((c) => c.id === id)?.label).filter(Boolean).join(', ') || null;
    if (f.type === 'person') return nameOf(ws, v);
    if (f.type === 'money') return '$' + (Number(v) / 100).toLocaleString('en-US');
    if (f.type === 'contact') { const c = db.contacts[v]; return c ? [c.name, c.email, c.phone].filter(Boolean).join(' · ') : null; }
    if (f.type === 'link') return (v || []).map((id) => db.records[id]).filter(Boolean).map((r) => String(r.values[db.projects[r.projectId]?.types.find((x) => x.id === r.typeId)?.primary] ?? '')).join(', ') || null;
    if (f.type === 'checkbox') return v ? 'yes' : 'no';
    if (f.type === 'checklist') return (v.items || []).map((x) => (x.done ? '☑ ' : '☐ ') + x.text).join('; ') || null;
    if (['items', 'files', 'signature', 'measure', 'equipment', 'materials', 'readings', 'permit'].includes(f.type)) return null;
    return words(v, 200);
  };
  const recLine = (ws, r, extra = 6) => {
    const p = db.projects[r.projectId];
    const t = p?.types.find((x) => x.id === r.typeId);
    if (!t) return null;
    const out = { id: r.id, project: p.name, list: t.singular || t.name, name: String(r.values[t.primary] ?? '') || 'Untitled' };
    let n = 0;
    for (const f of t.fields) {
      if (f.id === t.primary || n >= extra) continue;
      const w = fieldWords(ws, p, t, f, r.values[f.id]);
      if (w) { out[f.name] = w; n++; }
    }
    const last = (r.log || [])[0];
    out.lastActivity = last ? new Date(last.at).toISOString().slice(0, 10) : new Date(r.createdAt).toISOString().slice(0, 10);
    return out;
  };

  // The tools, each one a thing the person could do themselves in the app. kind 'read' never changes anything.
  const TOOLS = {
    look_at_day: {
      kind: 'read', label: (a) => `Looked at ${a.date || 'today'}`,
      description: 'The person’s day: everything on their calendar (including events from their connected calendars and job visits), and tasks due that day or overdue. Use before planning or scheduling.',
      parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD; today if left out' } } },
      async run(cx, a) {
        const date = isDay(a.date) ? a.date : cx.today;
        const s = await cx.state();
        const entries = s.entries.filter((e) => e.memberId === cx.memberId && (e.date === date || (e.repeat && e.date <= date))).map((e) => ({ id: e.id, what: e.text, start: hm(e.start), end: hm(e.end), allDay: e.start == null, done: e.done, from: e.cal?.imported ? 'their calendar' : e.visitId ? 'job visit' : 'Kloomie', repeats: e.repeat || undefined })).sort((x, y) => (parseTime(x.start) ?? -1) - (parseTime(y.start) ?? -1));
        const tasks = s.tasks.filter((t) => !t.done && mineTask(cx, t) && t.due && t.due <= date).map((t) => taskLine(cx, t));
        return { date, weekday: new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), now: date === cx.today ? hm(cx.nowMin) : undefined, calendar: entries, tasksDueOrOverdue: tasks };
      },
    },
    list_tasks: {
      kind: 'read', label: (a) => `Went through ${a.which === 'everyone' ? 'the team’s' : 'your'} tasks`,
      description: 'Open tasks. which: mine (assigned to or made by the person, default), overdue, upcoming (next 14 days), unscheduled (no due date), everyone (the whole team, as far as they can see), done_recently (finished in the last 7 days).',
      parameters: { type: 'object', properties: { which: { type: 'string', enum: ['mine', 'overdue', 'upcoming', 'unscheduled', 'everyone', 'done_recently'] }, query: { type: 'string' } } },
      async run(cx, a) {
        const s = await cx.state();
        const q = String(a.query || '').toLowerCase();
        const week = Date.now() - 7 * 864e5;
        const which = a.which || 'mine';
        let list = s.tasks.filter((t) => (which === 'done_recently' ? t.done && (t.doneAt || 0) > week : !t.done));
        if (which !== 'everyone') list = list.filter((t) => mineTask(cx, t));
        if (which === 'overdue') list = list.filter((t) => t.due && t.due < cx.today);
        if (which === 'upcoming') list = list.filter((t) => t.due && t.due >= cx.today && t.due <= addDays(cx.today, 14));
        if (which === 'unscheduled') list = list.filter((t) => !t.due);
        if (q) list = list.filter((t) => t.text.toLowerCase().includes(q));
        list.sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999') || (y.priority || 0) - (x.priority || 0));
        return { count: list.length, tasks: list.slice(0, 60).map((t) => taskLine(cx, t)) };
      },
    },
    list_projects: {
      kind: 'read', label: () => 'Looked over Jobs & projects',
      description: 'Every project in Jobs & projects the person can see, with its lists (e.g. Jobs, Leads, Deals, Quotes) and each list’s fields and choices. Use before creating or updating records, to get names right.',
      parameters: { type: 'object', properties: {} },
      async run(cx) {
        return { projects: Object.values(db.projects).filter((p) => p.wsId === cx.ws.id && PJ.sees(p, cx.memberId)).map((p) => ({ id: p.id, name: p.name, template: p.template, lists: p.types.map((t) => ({ name: t.name, singular: t.singular, fields: t.fields.filter((f) => !['autonumber', 'files', 'signature', 'items'].includes(f.type)).map((f) => ({ name: f.name, type: f.type, ...(f.choices ? { choices: f.choices.map((c) => c.label) } : {}) })) })) })) };
      },
    },
    find_records: {
      kind: 'read', label: (a) => (a.query ? `Searched Jobs & projects for “${words(a.query, 40)}”` : 'Searched Jobs & projects'),
      description: 'Records in Jobs & projects (jobs, leads, deals, quotes, contacts, work items…). Filter by words, project, list, a status/stage choice, or quiet_days (no activity for at least that many days).',
      parameters: { type: 'object', properties: { query: { type: 'string' }, project: { type: 'string' }, list: { type: 'string' }, status: { type: 'string', description: 'a status or stage choice, e.g. Proposal sent' }, quiet_days: { type: 'number' } } },
      async run(cx, a) {
        const q = String(a.query || '').toLowerCase();
        const quiet = Number(a.quiet_days) > 0 ? Date.now() - Number(a.quiet_days) * 864e5 : null;
        const out = [];
        for (const r of Object.values(db.records)) {
          if (r.wsId !== cx.ws.id) continue;
          const p = db.projects[r.projectId];
          if (!p || !PJ.sees(p, cx.memberId) || (a.project && !same(p.name, a.project))) continue;
          const t = p.types.find((x) => x.id === r.typeId);
          if (!t || (a.list && !same(t.name, a.list) && !same(t.singular, a.list))) continue;
          if (a.status && !t.fields.some((f) => f.type === 'select' && same(f.choices?.find((c) => c.id === r.values[f.id])?.label, a.status))) continue;
          if (quiet && ((r.log || [])[0]?.at || r.createdAt) > quiet) continue;
          const line = recLine(cx.ws, r);
          if (q && !JSON.stringify(line).toLowerCase().includes(q)) continue;
          out.push(line);
          if (out.length >= 50) break;
        }
        return { count: out.length, records: out };
      },
    },
    read_record: {
      kind: 'read', label: (a, cx) => `Read ${recTitle(a.id) || 'a record'}`,
      description: 'Everything about one record: its fields, linked records, timeline (calls, notes, changes) and open tasks.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(cx, a) {
        const at = PJ.recordAt(String(a.id), cx.ws.id, cx.memberId);
        if (!at) throw new Error('No record with that id that you can see.');
        return { id: at.rec.id, about: PJ.recordStory(at.rec, cx.ws) };
      },
    },
    list_campaigns: {
      kind: 'read', label: () => 'Checked campaigns',
      description: 'Campaigns (marketing, outreach, launches) with status, dates and goals.',
      parameters: { type: 'object', properties: {} },
      async run(cx) {
        const s = await cx.state();
        return { campaigns: s.campaigns.filter((c) => c.status !== 'done').slice(0, 30).map((c) => ({ id: c.id, name: c.name, status: c.status, start: c.start, end: c.end, goals: s.goals.filter((g) => g.campaignId === c.id).map((g) => g.title).slice(0, 8) })) };
      },
    },
    find_contacts: {
      kind: 'read', label: (a) => (a.query ? `Looked up “${words(a.query, 40)}” in Contacts` : 'Looked through Contacts'),
      description: 'Customers and prospects in Contacts, by name, email, phone or company. Owners and admins only.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      async run(cx, a) {
        const r = await cx.call('GET', '/api/contacts');
        if (r.status !== 200) throw new Error(r.body?.error || 'Contacts aren’t open to this person.');
        const q = String(a.query || '').toLowerCase();
        const list = r.body.contacts.filter((c) => !q || [c.name, c.email, c.phone, c.company].some((v) => String(v || '').toLowerCase().includes(q)));
        return { count: list.length, contacts: list.slice(0, 30).map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.company, tags: c.tags, doNotContact: c.dne || undefined })) };
      },
    },
    team_schedule: {
      kind: 'read', label: (a) => `Checked the team’s visits on ${a.date || 'today'}`,
      description: 'Job visits on a day by person (owners and admins see everyone), and jobs still waiting for a visit.',
      parameters: { type: 'object', properties: { date: { type: 'string' } } },
      async run(cx, a) {
        const r = await cx.call('GET', '/api/schedule?date=' + (isDay(a.date) ? a.date : cx.today));
        if (r.status !== 200) throw new Error(r.body?.error || 'Couldn’t read the schedule.');
        return r.body;
      },
    },
    plan_route: {
      kind: 'read', label: (a) => `Planned the route for ${a.date || 'today'}`,
      description: 'A person’s job visits on a day in order on real roads: driving times, what is too tight, and a better order if there is one.',
      parameters: { type: 'object', properties: { date: { type: 'string' }, person: { type: 'string', description: 'a team member’s name; the person themselves if left out' } } },
      async run(cx, a) {
        const who = a.person ? cx.ws.members.find((m) => same(m.name, a.person))?.id : cx.memberId;
        if (!who) throw new Error('Nobody on the team by that name.');
        const r = await cx.call('GET', `/api/route?date=${isDay(a.date) ? a.date : cx.today}&member=${who}`);
        if (r.status !== 200) throw new Error(r.body?.error || 'Couldn’t plan the route.');
        if (!r.body.configured) return { note: 'Road routing isn’t set up on this server; plan the order by address instead.', ...r.body };
        return r.body;
      },
    },
    find_docs: {
      kind: 'read', label: (a) => (a.query ? `Looked for docs about “${words(a.query, 40)}”` : 'Looked through docs'),
      description: 'Docs in Kloomie (proposals, SOPs, plans, notes) by words in the title or text.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
      async run(cx, a) {
        const s = await cx.state();
        const q = String(a.query || '').toLowerCase();
        const docs = s.items.filter((it) => it.type === 'text' && (!q || (it.title || '').toLowerCase().includes(q) || String(it.text || '').toLowerCase().includes(q)));
        return { docs: docs.slice(-30).reverse().map((it) => ({ id: it.id, title: it.title || String(it.text || '').split('\n')[0].slice(0, 100), edited: new Date(it.editedAt || it.createdAt).toISOString().slice(0, 10) })) };
      },
    },
    read_doc: {
      kind: 'read', label: (a) => `Read ${docTitle(a.id) || 'a doc'}`,
      description: 'The text of one doc.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      async run(cx, a) {
        const s = await cx.state();
        const it = s.items.find((x) => x.id === a.id && x.type === 'text');
        if (!it) throw new Error('No doc with that id that you can see.');
        return { id: it.id, title: it.title, text: String(it.text || '').slice(0, 12_000) };
      },
    },

    // ---------- making and changing things ----------
    create_task: {
      kind: 'write', label: (a) => `Task: ${words(a.text, 120)}${a.due ? ` (due ${a.due})` : ''}${a.assignee ? ` → ${a.assignee}` : ''}`,
      description: 'Add a task to Kloomie (shows in the Day and Tasks). assignee: a team member’s or role’s name exactly as given; the person themselves if left out. record_id ties it to a job, lead or deal.',
      parameters: { type: 'object', properties: { text: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD' }, assignee: { type: 'string' }, record_id: { type: 'string' }, priority: { type: 'number', description: '0 normal, 1 high, 2 urgent' }, why: { type: 'string' } }, required: ['text'] },
      async run(cx, a) {
        const body = { text: a.text, due: isDay(a.due) ? a.due : null, priority: [0, 1, 2].includes(Number(a.priority)) ? Number(a.priority) : 0, ...who(cx, a.assignee), ...(a.record_id ? { recordId: a.record_id } : {}) };
        const r = await cx.call('POST', '/api/tasks', body);
        return done(r, { kind: 'task', id: r.body?.id, label: r.body?.text }, { undo: { method: 'DELETE', path: '/api/tasks/' + r.body?.id } });
      },
    },
    update_task: {
      kind: 'write', label: (a) => `Changed task “${taskText(a.id) || 'a task'}”: ${[a.due !== undefined ? `due ${a.due || 'none'}` : '', a.done ? 'done' : '', a.assignee ? `→ ${a.assignee}` : '', a.priority != null ? `priority ${a.priority}` : '', a.text ? 'reworded' : ''].filter(Boolean).join(', ')}`,
      description: 'Change a task: due date (or null to unschedule), done, who it’s for, priority, wording.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, due: { type: ['string', 'null'] }, done: { type: 'boolean' }, assignee: { type: 'string' }, priority: { type: 'number' }, text: { type: 'string' }, why: { type: 'string' } }, required: ['id'] },
      async run(cx, a) {
        const t = db.tasks[a.id];
        if (!t || t.wsId !== cx.ws.id) throw new Error('No task with that id.');
        const body = {};
        if (a.due !== undefined) body.due = isDay(a.due) ? a.due : null;
        if (a.done !== undefined) body.done = !!a.done;
        if (a.priority != null) body.priority = [0, 1, 2].includes(Number(a.priority)) ? Number(a.priority) : 0;
        if (a.text) body.text = a.text;
        if (a.assignee) Object.assign(body, who(cx, a.assignee));
        const before = Object.fromEntries(Object.keys(body).map((k) => [k, t[k] ?? null]));
        if (body.assigneeId || body.roleId) Object.assign(before, { assigneeId: t.assigneeId || null, roleId: t.roleId || null });
        const r = await cx.call('PATCH', '/api/tasks/' + a.id, body);
        return done(r, { kind: 'task', id: a.id, label: t.text }, { undo: { method: 'PATCH', path: '/api/tasks/' + a.id, body: before } });
      },
    },
    schedule_time: {
      kind: 'write', label: (a) => `Put on ${a.date}: ${words(a.text, 100)}${a.start ? ` ${a.start}${a.end ? '–' + a.end : ''}` : ''}`,
      description: 'Put a block of time on the person’s calendar in Kloomie (and their connected calendar, if they write to one). Times like 9:30am or 14:00. task_id links it to the task it’s for.',
      parameters: { type: 'object', properties: { text: { type: 'string' }, date: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, task_id: { type: 'string' }, why: { type: 'string' } }, required: ['text', 'date'] },
      async run(cx, a) {
        const start = parseTime(a.start), end = parseTime(a.end);
        const r = await cx.call('POST', '/api/entries', { text: a.text, date: a.date, start, end: start == null ? null : end ?? Math.min(1440, start + 60), ...(a.task_id ? { taskId: a.task_id } : {}) });
        return done(r, { kind: 'entry', id: r.body?.id, label: a.text, date: a.date }, { undo: { method: 'DELETE', path: '/api/entries/' + r.body?.id } });
      },
    },
    move_time: {
      kind: 'write', label: (a) => `Moved “${entryText(a.id) || 'a block'}” to ${[a.date, a.start].filter(Boolean).join(' ')}`,
      description: 'Move a block of time the person made in Kloomie (not an event from their outside calendar, and not a job visit).',
      parameters: { type: 'object', properties: { id: { type: 'string' }, date: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, why: { type: 'string' } }, required: ['id'] },
      async run(cx, a) {
        const e = db.entries[a.id];
        if (!e || e.wsId !== cx.ws.id || e.memberId !== cx.memberId) throw new Error('No block of yours with that id.');
        if (e.cal?.imported || e.visitId) throw new Error('That one comes from another calendar or is a job visit; suggest the change instead.');
        const body = {};
        if (isDay(a.date)) body.date = a.date;
        if (a.start !== undefined) body.start = parseTime(a.start);
        if (a.end !== undefined) body.end = parseTime(a.end);
        else if (body.start != null && e.start != null && e.end != null) body.end = Math.min(1440, body.start + (e.end - e.start));
        const before = { date: e.date, start: e.start, end: e.end };
        const r = await cx.call('PATCH', '/api/entries/' + a.id, body);
        return done(r, { kind: 'entry', id: a.id, label: e.text, date: body.date || e.date }, { undo: { method: 'PATCH', path: '/api/entries/' + a.id, body: before } });
      },
    },
    save_contact: {
      kind: 'write', label: (a) => `Contact: ${words(a.name, 80)}${a.email ? ` <${a.email}>` : ''}`,
      description: 'Add a customer or prospect to Contacts (owners and admins), or fill in details on one that exists (same email).',
      parameters: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, company: { type: 'string' }, address: { type: 'string' }, notes: { type: 'string' }, why: { type: 'string' } }, required: ['name'] },
      async run(cx, a) {
        const body = Object.fromEntries(['name', 'email', 'phone', 'company', 'address'].filter((k) => a[k]).map((k) => [k, String(a[k])]));
        if (a.notes) body.note = String(a.notes);
        const have = a.email && Object.values(db.contacts).find((c) => c.wsId === cx.ws.id && same(c.email, a.email));
        const r = have ? await cx.call('PATCH', '/api/contacts/' + have.id, body) : await cx.call('POST', '/api/contacts', body);
        const c = r.body;
        return done(r, { kind: 'contact', id: c?.id || have?.id, label: a.name }, have ? {} : { undo: { method: 'DELETE', path: '/api/contacts/' + c?.id } });
      },
    },
    create_project: {
      kind: 'write', label: (a) => `New project: ${words(a.name, 80)}`,
      description: 'Start a new project in Jobs & projects from a template: crm (contacts and deals), bids (quotes and bids), jobs (jobs and installs, with clients), blank (one simple list), tech (software). Most jobs belong in an existing project as a record instead.',
      parameters: { type: 'object', properties: { template: { type: 'string' }, name: { type: 'string' }, why: { type: 'string' } }, required: ['template', 'name'] },
      async run(cx, a) {
        const r = await cx.call('POST', '/api/projects', { template: a.template, name: a.name });
        return done(r, { kind: 'project', id: r.body?.id, label: a.name });
      },
    },
    create_record: {
      kind: 'write', label: (a) => `New ${singularOf(a.project, a.list)} in ${a.project}: ${words(primaryOf(a), 100)}`,
      description: 'Add a record to a list in a project (a job, lead, deal, quote, work item…). values: field name → value, using the field names and choices from list_projects. Dates YYYY-MM-DD, money in dollars, people by name, a contact field by the contact’s name or email, a checklist as a list of steps.',
      parameters: { type: 'object', properties: { project: { type: 'string' }, list: { type: 'string' }, values: { type: 'object' }, why: { type: 'string' } }, required: ['project', 'list', 'values'] },
      async run(cx, a) {
        const { p, t } = listOf(cx, a.project, a.list);
        const r = await cx.call('POST', `/api/projects/${p.id}/records`, { typeId: t.id, values: valuesFor(cx, t, a.values) });
        return done(r, { kind: 'record', id: r.body?.id, label: String(r.body?.values?.[t.primary] ?? '') }, { undo: { method: 'DELETE', path: '/api/records/' + r.body?.id } });
      },
    },
    update_record: {
      kind: 'write', label: (a) => `Updated ${recTitle(a.id) || 'a record'}: ${Object.keys(a.values || {}).join(', ')}`,
      description: 'Change fields on a record (e.g. move a deal’s stage, set a job’s date, tick checklist steps by giving the whole list). values: field name → value, as for create_record.',
      parameters: { type: 'object', properties: { id: { type: 'string' }, values: { type: 'object' }, why: { type: 'string' } }, required: ['id', 'values'] },
      async run(cx, a) {
        const at = PJ.recordAt(String(a.id), cx.ws.id, cx.memberId);
        if (!at) throw new Error('No record with that id that you can see.');
        const values = valuesFor(cx, at.t, a.values);
        const before = Object.fromEntries(Object.keys(values).map((k) => { const v = at.rec.values[k] ?? null; return [k, v != null && at.t.fields.find((f) => f.id === k)?.type === 'money' ? v / 100 : v]; }));
        const r = await cx.call('PATCH', '/api/records/' + at.rec.id, { values });
        return done(r, { kind: 'record', id: at.rec.id, label: String(at.rec.values[at.t.primary] ?? '') }, { undo: { method: 'PATCH', path: '/api/records/' + at.rec.id, body: { values: before } } });
      },
    },
    log_note: {
      kind: 'write', label: (a) => `Logged ${a.kind === 'email' ? 'an email' : 'a ' + (a.kind || 'note')} on ${recTitle(a.record_id) || 'a record'}`,
      description: 'Write on a record’s timeline what happened: a call, email, meeting or note. follow_up (YYYY-MM-DD) also makes a follow-up task.',
      parameters: { type: 'object', properties: { record_id: { type: 'string' }, kind: { type: 'string', enum: ['note', 'call', 'email', 'meeting'] }, text: { type: 'string' }, follow_up: { type: 'string' }, why: { type: 'string' } }, required: ['record_id', 'text'] },
      async run(cx, a) {
        const r = await cx.call('POST', `/api/records/${a.record_id}/log`, { kind: a.kind || 'note', note: a.text, ...(isDay(a.follow_up) ? { followUp: a.follow_up } : {}) });
        return done(r, { kind: 'record', id: a.record_id, label: recTitle(a.record_id) });
      },
    },
    book_visit: {
      kind: 'write', label: (a) => `Booked a ${a.kind || 'visit'} for ${recTitle(a.record_id) || 'a job'} on ${a.date}${a.start ? ' at ' + a.start : ''}`,
      description: 'Book a visit on a job (an estimate, install, service call…): date, times, and who goes (names; the person themselves if left out). It goes on their calendars and the team schedule.',
      parameters: { type: 'object', properties: { record_id: { type: 'string' }, date: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, kind: { type: 'string' }, people: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } }, required: ['record_id', 'date'] },
      async run(cx, a) {
        const memberIds = (Array.isArray(a.people) ? a.people : []).map((n) => cx.ws.members.find((m) => same(m.name, n))?.id).filter(Boolean);
        const start = parseTime(a.start);
        const r = await cx.call('POST', `/api/records/${a.record_id}/visits`, { date: a.date, start, end: start == null ? null : parseTime(a.end) ?? Math.min(1440, start + 60), ...(a.kind ? { kind: a.kind } : {}), ...(memberIds.length ? { memberIds } : {}) });
        return done(r, { kind: 'record', id: a.record_id, label: recTitle(a.record_id) }, r.body?.id ? { undo: { method: 'DELETE', path: `/api/visits/${r.body.id}` } } : {});
      },
    },
    write_doc: {
      kind: 'write', label: (a) => `Doc: ${words(a.title, 100)}`,
      description: 'Write a doc in Kloomie: a plan, proposal, brief, checklist, work order, report. text in simple markdown (# headings, - bullets, - [ ] to-dos). Complete and ready to use, in the business’s voice.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, why: { type: 'string' } }, required: ['title', 'text'] },
      async run(cx, a) {
        const doc = textToDoc(`${a.title}\n${a.text}`);
        const r = await cx.call('POST', '/api/items', { type: 'text', doc: { title: cleanText(a.title, 300), blocks: doc.blocks } });
        return done(r, { kind: 'doc', id: r.body?.id, label: a.title }, { undo: { method: 'DELETE', path: '/api/items/' + r.body?.id } });
      },
    },
    draft_email: {
      kind: 'write', important: true, label: (a) => `Email to ${a.to_name || a.to_email}: ${words(a.subject, 100)}`,
      description: 'Draft an email to a customer, prospect or supplier. It is never sent until the person reads it and says yes. Personal, specific, in the business’s voice; no placeholders, no prices or promises you weren’t given.',
      parameters: { type: 'object', properties: { to_name: { type: 'string' }, to_email: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, record_id: { type: 'string' }, why: { type: 'string' } }, required: ['to_email', 'subject', 'body'] },
      async run(cx, a) {
        const out = await sendEmail(cx.ws, cx.memberId, { name: a.to_name || '', email: a.to_email, subject: a.subject, text: a.body });
        if (a.record_id && PJ.recordAt(String(a.record_id), cx.ws.id, cx.memberId)) await cx.call('POST', `/api/records/${a.record_id}/log`, { kind: 'email', note: `Emailed ${a.to_name || a.to_email}: ${a.subject}` });
        return { ok: true, result: { sent: true, from: out.from }, changed: a.record_id ? [{ kind: 'record', id: a.record_id, label: recTitle(a.record_id) }] : [] };
      },
    },
    notify_me: {
      kind: 'write', quiet: true, label: (a) => `Heads-up: ${words(a.title, 100)}`,
      description: 'Send the person a notification (bell and phone) about something that needs them: a deadline, a risk, a decision.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title'] },
      async run(cx, a) {
        notify(cx.ws.id, cx.memberId, { title: cleanText(a.title, 120), text: cleanText(a.text, 300), kind: 'agent', go: 'agent:' + cx.runId });
        return { ok: true, result: { sent: true }, changed: [] };
      },
    },
  };
  // The coordinator's way to bring in another specialist partway through.
  const HANDOFF = {
    description: 'Hand part of this request to another specialist, with what they need to know: chief (Chief of Staff: time, calendar, priorities), sales (Client & Sales Manager: leads, customers, emails, proposals), ops (Operations Manager: jobs, checklists, visits, routes).',
    parameters: { type: 'object', properties: { agent: { type: 'string', enum: Object.keys(AGENTS) }, ask: { type: 'string' } }, required: ['agent', 'ask'] },
  };

  // ---------- helpers the tools share ----------
  const same = (x, y) => String(x ?? '').trim().toLowerCase() === String(y ?? '').trim().toLowerCase() && String(x ?? '').trim() !== '';
  const mineTask = (cx, t) => t.assigneeId === cx.memberId || (!t.assigneeId && !t.roleId && t.memberId === cx.memberId) || (t.roleId && (memberOf(cx.ws, cx.memberId)?.roleIds || []).includes(t.roleId));
  const taskLine = (cx, t) => ({ id: t.id, task: t.text.slice(0, 200), due: t.due || null, priority: t.priority || undefined, for: t.assigneeId ? nameOf(cx.ws, t.assigneeId) : t.roleId ? (cx.ws.roles || []).find((r) => r.id === t.roleId)?.name : undefined, campaign: t.goalId ? db.campaigns[db.goals[t.goalId]?.campaignId]?.name : undefined, about: t.recordId ? recTitle(t.recordId) : undefined, waitingOn: t.blockedBy?.length ? true : undefined });
  const taskText = (id) => db.tasks[id]?.text?.slice(0, 80);
  const entryText = (id) => db.entries[id]?.text?.slice(0, 80);
  const docTitle = (id) => db.items[id]?.title;
  const recTitle = (id) => { const r = db.records[id]; const p = r && db.projects[r.projectId]; const t = p?.types.find((x) => x.id === r.typeId); return t ? String(r.values[t.primary] ?? '') || 'Untitled' : null; };
  // A list's name for one of its records (Deals → deal), for step labels.
  const singularOf = (project, list) => { const t = Object.values(db.projects).filter((p) => same(p.name, project)).flatMap((p) => p.types).find((x) => same(x.name, list) || same(x.singular, list)); return (t?.singular || list || 'record').toLowerCase(); };
  const primaryOf = (a) => { const v = a.values || {}; return v.Name || v.Title || v.name || v.title || Object.values(v).find((x) => typeof x === 'string') || ''; };
  function who(cx, name) {
    if (!name) return {};
    const r = (cx.ws.roles || []).find((x) => same(x.name, name));
    if (r) return { roleId: r.id };
    const m = cx.ws.members.find((x) => same(x.name, name) || same(x.name.split(/\s+/)[0], name));
    if (!m) throw new Error(`Nobody on the team called ${name}. Team: ${cx.ws.members.map((x) => x.name).join(', ')}.`);
    return { assigneeId: m.id };
  }
  function listOf(cx, project, list) {
    const ps = Object.values(db.projects).filter((p) => p.wsId === cx.ws.id && PJ.sees(p, cx.memberId));
    const p = ps.find((x) => same(x.name, project)) || (ps.length === 1 ? ps[0] : null);
    if (!p) throw new Error(`No project called ${project}. Projects: ${ps.map((x) => x.name).join(', ') || 'none yet'}.`);
    const t = p.types.find((x) => same(x.name, list) || same(x.singular, list)) || (p.types.length === 1 ? p.types[0] : null);
    if (!t) throw new Error(`No list called ${list} in ${p.name}. Lists: ${p.types.map((x) => x.name).join(', ')}.`);
    return { p, t };
  }
  // Field names and plain values (choice labels, names, dollars) to what Kloomie keeps.
  function valuesFor(cx, t, vals) {
    const out = {};
    const bad = [];
    for (const [k, v] of Object.entries(vals || {})) {
      const f = t.fields.find((x) => same(x.name, k) || same(x.key, k)) || (/^(name|title)$/i.test(k) ? t.fields.find((x) => x.id === t.primary) : null);
      if (!f || ['autonumber', 'files', 'signature', 'items'].includes(f.type)) { bad.push(k); continue; }
      if (v == null || v === '') { out[f.id] = null; continue; }
      if (f.type === 'select') { const c = f.choices.find((x) => same(x.label, v)); if (c) out[f.id] = c.id; else bad.push(`${k} (choices: ${f.choices.map((x) => x.label).join(', ')})`); }
      else if (f.type === 'multi') out[f.id] = (Array.isArray(v) ? v : [v]).map((l) => f.choices.find((x) => same(x.label, l))?.id).filter(Boolean);
      else if (f.type === 'person') { const m = cx.ws.members.find((x) => same(x.name, v) || same(x.name.split(/\s+/)[0], v)); if (m) out[f.id] = m.id; else bad.push(k); }
      else if (f.type === 'money') out[f.id] = Number(String(v).replace(/[$,\s]/g, '')) || 0; // dollars in; the API keeps cents
      else if (f.type === 'number') out[f.id] = Number(String(v).replace(/[,\s]/g, '')) || 0;
      else if (f.type === 'checkbox') out[f.id] = v === true || /^(yes|true|1|done)$/i.test(String(v));
      else if (f.type === 'date') { if (isDay(v)) out[f.id] = v; else bad.push(k); }
      else if (f.type === 'contact') { const c = Object.values(db.contacts).find((x) => x.wsId === cx.ws.id && (same(x.name, v) || same(x.email, v) || x.id === v)); if (c) out[f.id] = c.id; else bad.push(`${k} (save the contact first)`); }
      else if (f.type === 'link') out[f.id] = (Array.isArray(v) ? v : [v]).map((x) => (db.records[x]?.wsId === cx.ws.id ? x : Object.values(db.records).find((r) => r.typeId === f.target && (same(recTitle(r.id), x) || Object.values(r.values).some((y) => typeof y === 'string' && y.includes('@') && same(y, x))))?.id)).filter(Boolean);
      else if (f.type === 'checklist') out[f.id] = { items: (Array.isArray(v) ? v : String(v).split('\n')).map((x) => (typeof x === 'object' ? { text: cleanText(x.text, 300), done: !!x.done } : { text: cleanText(String(x).replace(/^[-*\s[\]x]+/i, ''), 300) })).filter((x) => x.text).slice(0, 60) };
      else out[f.id] = String(v).slice(0, 8000);
    }
    if (bad.length && !Object.keys(out).length) throw new Error(`None of those fields fit. Not known or not settable: ${bad.join('; ')}. Fields: ${t.fields.map((f) => f.name).join(', ')}.`);
    return out;
  }
  // A route's answer as a step result: done, held for an OK under the team's rules, or failed with the reason.
  function done(r, changed, more = {}) {
    if (r.status === 202 && r.body?.pending) return { ok: false, held: { approvalId: r.body.approval?.id, text: r.body.error }, changed: [] };
    if (r.status >= 300) throw new Error(r.body?.error || `That didn’t work (${r.status}).`);
    return { ok: true, result: { done: true, id: changed.id }, changed: changed.id ? [changed] : [], ...more };
  }

  // ---------- running an assignment ----------
  // A part is one specialist's share of a request. The model works with the tools; reads run straight away,
  // changes run or wait for a yes depending on the level, and every one is kept as a step.
  function systemFor(ws, memberId, agentKey, level, prefs, coordinated) {
    const a = AGENTS[agentKey];
    const me = memberOf(ws, memberId);
    const now = localNow(tzOf(ws), Date.now());
    const allowed = {
      observe: 'You may only look and report. Do not make or change anything; write what you would do as recommendations.',
      prepare: 'Prepare everything: every change you make is saved as a proposal the person approves one by one. Go ahead and propose the full set.',
      execute: 'Make routine changes yourself (tasks, calendar time, records, notes, docs). Emails are drafted for the person to approve; nothing is ever sent without them.',
      automate: 'Make routine changes yourself (tasks, calendar time, records, notes, docs). Emails are drafted for the person to approve; nothing is ever sent without them.',
    }[level];
    const team = ws.members.map((m) => `${m.name}${m.id === memberId ? ' (the person you work for)' : ''}${m.role === 'owner' ? ', owner' : m.role === 'admin' ? ', admin' : ''}${(m.roleIds || []).length ? ': ' + m.roleIds.map((id) => (ws.roles || []).find((r) => r.id === id)?.name).filter(Boolean).join(', ') : ''}`).join('; ');
    return [
      `You are the ${a.name} for ${me?.name || 'the owner'} at ${ws.name}, inside Kloomie, their work app. ${a.purpose}`,
      `Your responsibilities:\n${a.duties.map((d) => '- ' + d).join('\n')}`,
      `Today is ${now.date} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.dow]}), it is ${fmtMinutes(now.min)} on the team’s clock.`,
      `The team: ${team}.`,
      `How you work: look before you act (read the day, tasks, records you need), then do the work with your tools so it lands in Kloomie as real tasks, calendar time, records and docs, not just advice. Don’t duplicate: check whether a task, record or contact already exists before making one. Use names exactly as the tools give them. Never invent facts, prices, customers or commitments; where something is missing, say so in your report or ask. ${allowed} You can’t delete anything.`,
      coordinated ? 'You are one of three specialists on this request (Chief of Staff, Client & Sales Manager, Operations Manager). Do your part only; use hand_off if another specialist must do something that is theirs.' : 'If part of the request belongs to another specialist (time and priorities: chief; customers and sales: sales; delivery, jobs and logistics: ops), use hand_off for that part.',
      prefs.instructions ? `Standing instructions from ${me?.name || 'the person'} for you:\n${prefs.instructions}` : '',
      'Finish with a short report to the person in plain words: what you found, what you did (and what is waiting for their yes), and what they should do next. No preamble. Use short lines or bullets.',
    ].filter(Boolean).join('\n\n');
  }

  async function runPart(x, part) {
    const ws = db.workspaces[x.wsId];
    if (!ws || !memberOf(ws, x.memberId)) return;
    const prefs = prefsOf(x.wsId, x.memberId)[part.agent];
    const level = x.level?.[part.agent] || prefs.level;
    const a = AGENTS[part.agent];
    let stateCache = null;
    const cx = {
      ws, memberId: x.memberId, runId: x.id, today: localNow(tzOf(ws), Date.now()).date, nowMin: localNow(tzOf(ws), Date.now()).min,
      call: (method, path, body) => replay(ws, x.memberId, null, { method, path, body }, `${memberOf(ws, x.memberId).name}’s ${a.name}`),
      state: async () => { if (!stateCache) { const r = await replay(ws, x.memberId, null, { method: 'GET', path: '/api/state' }); stateCache = r.body; } return stateCache; },
    };
    part.status = 'running';
    part.startedAt = Date.now();
    news(x);
    const tools = a.tools.map((k) => ({ name: k, description: TOOLS[k].description, parameters: TOOLS[k].parameters }));
    if (x.parts.length < MAX_PARTS) tools.push({ name: 'hand_off', ...HANDOFF });
    const exec = async (name, args) => {
      if (x.status === 'cancelled') throw new Error('The person stopped this assignment. Stop now.');
      if (name === 'hand_off') {
        if (!AGENTS[args.agent] || args.agent === part.agent) throw new Error('Can’t hand that off; do it yourself or say so in the report.');
        // Already coming up in this request: add to its brief rather than run it twice.
        const next = x.parts.find((p) => p.agent === args.agent && p.status === 'planned');
        if (next) next.ask = cleanText(`${next.ask}\n\nAlso, from the ${a.name}: ${args.ask}`, 8000);
        else if (x.parts.length >= MAX_PARTS) throw new Error('Can’t hand that off; do it yourself or say so in the report.');
        else x.parts.push({ id: rid(6), agent: args.agent, ask: cleanText(args.ask, 4000), from: part.agent, status: 'planned', steps: [] });
        part.steps.push({ id: rid(6), kind: 'handoff', label: `Handed to the ${AGENTS[args.agent].name}: ${words(args.ask, 140)}`, status: 'done', at: Date.now() });
        news(x);
        return { handedOff: true, note: 'They will pick it up after you finish.' };
      }
      const tool = a.tools.includes(name) && TOOLS[name];
      if (!tool) throw new Error('Not one of your tools.');
      const step = { id: rid(6), tool: name, kind: tool.kind, label: cleanText(safeLabel(tool, args, cx), 200), why: cleanText(args.why, 300), at: Date.now() };
      if (tool.kind === 'read') {
        part.steps.push(step);
        try {
          const out = await tool.run(cx, args);
          step.status = 'done';
          news(x);
          return out;
        } catch (e) {
          step.status = 'failed';
          step.error = cleanText(e.message, 300);
          news(x);
          throw e;
        }
      }
      // A change: done now, or kept for a yes.
      step.args = args;
      part.steps.push(step);
      const ask = level === 'observe' ? 'suggest' : level === 'prepare' || tool.important ? 'propose' : 'run';
      if (ask === 'suggest' && !tool.quiet) {
        step.status = 'suggested';
        news(x);
        return { notDone: true, note: 'You are only observing: this is noted as a suggestion for the person. Carry on and mention it in your report.' };
      }
      if (ask === 'propose' && !tool.quiet) {
        step.status = 'proposed';
        news(x);
        return { proposed: true, note: tool.important ? 'Saved as a draft for the person to read and send. Carry on as if it will go out; don’t draft it again.' : 'Saved for the person to approve. Carry on as if it will happen; don’t propose it again.' };
      }
      return applyStep(x, cx, step);
    };
    const history = [...(part.history || []), { role: 'user', text: !part.reply && (x.parts.length > 1 || part.from) ? handoffContext(x, part) : part.ask }];
    try {
      const out = await llmRun(ws, x.memberId, { system: systemFor(ws, x.memberId, part.agent, level, prefs, x.agent === 'team'), history, tools, exec, task: part.agent === 'sales' ? 'customer' : part.agent === 'ops' ? 'jobs' : 'plan' });
      part.report = cleanText(out, 6000);
      part.history = [...history, { role: 'assistant', text: part.report }].slice(-12);
      part.status = x.status === 'cancelled' ? 'cancelled' : part.steps.some((s) => ['proposed', 'held'].includes(s.status)) ? 'awaiting' : 'completed';
    } catch (e) {
      part.status = 'failed';
      part.error = cleanText(e.message, 400);
    }
    part.finishedAt = Date.now();
    save();
    news(x);
  }
  // What the next specialist hears: the request, and what the others already did.
  function handoffContext(x, part) {
    const before = x.parts.filter((p) => p !== part && p.status !== 'planned' && p.status !== 'running');
    return [
      `The request from the person: ${x.ask}`,
      part.ask && part.ask !== x.ask ? `Your part: ${part.ask}` : '',
      ...before.map((p) => `What the ${AGENTS[p.agent].name} did:\n${p.steps.filter((s) => s.kind !== 'read').map((s) => `- ${s.label} [${s.status}]${s.changed?.length ? ' ids: ' + s.changed.map((c) => `${c.kind} ${c.id}`).join(', ') : ''}`).join('\n') || '- nothing changed'}\nTheir report: ${p.report || p.error || ''}`),
    ].filter(Boolean).join('\n\n').slice(0, MAX_TURN_CHARS);
  }
  const safeLabel = (tool, args, cx) => { try { return tool.label(args || {}, cx); } catch { return 'Step'; } };

  // Running a change (now, or when the person approves it), keeping what it changed and how to undo it.
  async function applyStep(x, cx, step) {
    const tool = TOOLS[step.tool];
    try {
      const out = await tool.run(cx, step.args || {});
      if (out.held) {
        step.status = 'held';
        step.approvalId = out.held.approvalId;
        step.error = cleanText(out.held.text, 300);
        news(x);
        return { waiting: true, note: out.held.text + ' Carry on; mention it in your report.' };
      }
      step.status = 'done';
      step.doneAt = Date.now();
      step.changed = out.changed || [];
      if (out.undo?.path && !/undefined/.test(out.undo.path)) step.undo = out.undo;
      news(x);
      return out.result || { done: true };
    } catch (e) {
      step.status = 'failed';
      step.error = cleanText(e.message, 300);
      news(x);
      throw e;
    }
  }

  // The whole request: one specialist, or the coordinator first deciding who does what.
  async function runAssignment(x) {
    const ws = db.workspaces[x.wsId];
    if (!ws) return;
    x.status = 'running';
    news(x);
    try {
      if (x.agent === 'team' && !x.parts.length) {
        x.status = 'planning';
        news(x);
        const plan = await coordinate(ws, x);
        if (plan.question) {
          x.question = plan.question;
          x.status = 'blocked';
          x.parts.push({ id: rid(6), agent: 'chief', ask: x.ask, status: 'planned', steps: [] });
          save();
          return news(x);
        }
        x.parts = plan.parts.map((p) => ({ id: rid(6), agent: p.agent, ask: p.ask, status: 'planned', steps: [] }));
        x.plan = plan.summary;
        news(x);
      }
      for (let i = 0; i < x.parts.length && i < MAX_PARTS; i++) {
        const part = x.parts[i];
        if (x.status === 'cancelled') break;
        if (part.status === 'planned') await runPart(x, part);
      }
    } catch (e) {
      x.error = cleanText(e.message, 400);
    }
    finish(x);
  }
  function finish(x) {
    if (db.agentRuns[x.id] !== x) return;
    const parts = x.parts;
    if (x.status === 'cancelled' || x.status === 'blocked') {
      // stays as it is
    } else if (x.error && !parts.some((p) => p.status === 'completed' || p.status === 'awaiting')) x.status = 'failed';
    else if (parts.some((p) => p.steps.some((s) => ['proposed', 'held'].includes(s.status)))) x.status = 'awaiting';
    else if (parts.length && parts.every((p) => p.status === 'failed')) { x.status = 'failed'; x.error ||= parts[0].error; }
    else x.status = 'completed';
    x.finishedAt = Date.now();
    const waiting = parts.flatMap((p) => p.steps).filter((s) => s.status === 'proposed').length;
    if (x.scheduled || waiting) notify(x.wsId, x.memberId, { title: waiting ? `${agentName(x)}: ${waiting} thing${waiting === 1 ? '' : 's'} to approve` : `${agentName(x)}: ${x.title}`, text: (parts.at(-1)?.report || x.error || '').slice(0, 200), kind: 'agent', go: 'agent:' + x.id });
    trim(x.wsId, x.memberId);
    save();
    news(x);
  }
  const agentName = (x) => (x.agent === 'team' ? 'Your team' : AGENTS[x.agent].name);
  function trim(wsId, memberId) {
    for (const old of runsOf(wsId, memberId).slice(KEEP_RUNS)) delete db.agentRuns[old.id];
  }
  // The coordinator: which specialists, in what order, each with its part. Asks first if it can't tell.
  async function coordinate(ws, x) {
    const system = `You coordinate three specialists for a small-business owner in Kloomie:
- chief: Chief of Staff (the day and week, priorities, calendar, task lists, turning commitments into tasks)
- sales: Client & Sales Manager (leads, customers, contacts, replies and follow-ups, proposals, the sales pipeline, customer meetings)
- ops: Operations Manager (delivering won work: jobs and projects, checklists, work orders, materials, visits, routes, closeout)
Split the request into 1 to 3 assignments in the order they should happen, each given to one specialist with exactly what they should do. Only include a specialist if the request needs them. If the request is too unclear to start, ask one short question instead.
Reply with JSON only: {"summary":"one line on the plan","parts":[{"agent":"chief|sales|ops","ask":""}],"question":null}`;
    const out = await llmRun(ws, x.memberId, { system, history: [{ role: 'user', text: x.ask }], tools: [], exec: () => Promise.reject(new Error('No tools')), task: 'plan' });
    let j = {};
    try { j = JSON.parse(String(out).slice(String(out).indexOf('{'), String(out).lastIndexOf('}') + 1)); } catch {}
    if (j.question && !(Array.isArray(j.parts) && j.parts.length)) return { question: cleanText(j.question, 300) };
    const parts = (Array.isArray(j.parts) ? j.parts : []).filter((p) => AGENTS[p?.agent]).slice(0, 3).map((p) => ({ agent: p.agent, ask: cleanText(p.ask, 4000) || x.ask }));
    return { summary: cleanText(j.summary, 300), parts: parts.length ? parts : [{ agent: 'chief', ask: x.ask }] };
  }

  function newRun(ws, memberId, { agent, ask, title, workflow = null, scheduled = false }) {
    const x = {
      id: rid(), wsId: ws.id, memberId, agent, ask: cleanText(ask, MAX_TURN_CHARS), title: cleanText(title, 120) || cleanText(String(ask).split('\n')[0], 120),
      workflow, scheduled, status: 'requested', createdAt: Date.now(), parts: agent === 'team' ? [] : [{ id: rid(6), agent, ask: cleanText(ask, MAX_TURN_CHARS), status: 'planned', steps: [] }],
    };
    db.agentRuns[x.id] = x;
    save();
    news(x);
    runAssignment(x).catch((e) => console.error('Agent run failed:', e.message));
    return x;
  }

  // ---------- scheduled runs: each agent's workflows at their times, on the team's clock ----------
  const TICK = Number(process.env.AGENT_TICK_MS) || 60_000;
  function tick() {
    for (const [key, p] of Object.entries(db.agentPrefs)) {
      const [wsId, memberId] = key.split(':');
      const ws = db.workspaces[wsId];
      if (!ws || ws.deleteAt || !memberOf(ws, memberId) || ws.settings?.tools?.agents === false) continue;
      const now = localNow(tzOf(ws), Date.now());
      for (const [agent, pr] of Object.entries(p)) {
        if (!AGENTS[agent] || pr.level !== 'automate' || pr.paused) continue;
        for (const s of pr.schedules || []) {
          const wf = AGENTS[agent].workflows.find((w) => w.key === s.workflow);
          if (!wf || wf.paste || !s.days?.includes(now.dow) || now.min < s.at || s.last === now.date) continue;
          if (now.min > s.at + 180) continue; // missed by hours (server was down): skip today rather than run late
          s.last = now.date;
          save();
          newRun(ws, memberId, { agent, ask: wf.ask, title: wf.name, workflow: wf.key, scheduled: true });
        }
      }
    }
  }
  setInterval(() => { try { tick(); } catch (e) { console.error('Agent schedules:', e.message); } }, TICK).unref();

  // ---------- routes ----------
  const publicAgents = (wsId, memberId) => {
    const prefs = prefsOf(wsId, memberId);
    const runs = runsOf(wsId, memberId);
    const week = Date.now() - 7 * 864e5;
    return Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => {
      const mine = runs.filter((x) => x.parts.some((p) => p.agent === k));
      const steps = mine.flatMap((x) => x.parts.filter((p) => p.agent === k).flatMap((p) => p.steps)).filter((s) => s.kind === 'write');
      const recent = mine.filter((x) => x.createdAt > week);
      return [k, {
        ...a, tools: a.tools.map((t) => ({ key: t, kind: TOOLS[t].kind, important: !!TOOLS[t].important })), ...prefs[k],
        busy: mine.some((x) => ['requested', 'planning', 'running'].includes(x.status)),
        stats: { week: recent.length, done: steps.filter((s) => s.status === 'done').length, approved: steps.filter((s) => s.approvedAt).length, skipped: steps.filter((s) => s.status === 'skipped').length, undone: steps.filter((s) => s.status === 'undone').length, waiting: steps.filter((s) => s.status === 'proposed').length, failed: mine.filter((x) => x.status === 'failed').length },
      }];
    }));
  };
  const stepOf = (x, stepId) => { for (const p of x.parts) { const s = p.steps.find((y) => y.id === stepId); if (s) return { p, s }; } return null; };
  const cxFor = (x, agent) => {
    const ws = db.workspaces[x.wsId];
    return { ws, memberId: x.memberId, runId: x.id, today: localNow(tzOf(ws), Date.now()).date, nowMin: 0, call: (method, path, body) => replay(ws, x.memberId, null, { method, path, body }, `${memberOf(ws, x.memberId).name}’s ${AGENTS[agent].name}`), state: async () => (await replay(ws, x.memberId, null, { method: 'GET', path: '/api/state' })).body };
  };
  function settle(x) {
    for (const p of x.parts) if (p.status === 'awaiting' && !p.steps.some((s) => ['proposed', 'held'].includes(s.status))) p.status = 'completed';
    if (x.status === 'awaiting' && !x.parts.some((p) => p.steps.some((s) => ['proposed', 'held'].includes(s.status)))) x.status = 'completed';
  }

  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d] = parts;
    if (a !== 'agents') return null;
    const m = req.method;
    if (ws.settings?.tools?.agents === false) return send(res, 403, { error: 'Agents are switched off for this team.' });
    if (m === 'GET' && !b) return send(res, 200, { agents: publicAgents(ws.id, auth.memberId), runs: runsOf(ws.id, auth.memberId).slice(0, 40).map(publicRun), levels: LEVELS, ai: hasAi(ws.id, auth.memberId) });
    // Settings for one agent: level, instructions, schedules, pause.
    if (b && AGENTS[b] && m === 'PATCH' && !c) {
      const body = await readJson(req, 20_000);
      const key = prefKey(ws.id, auth.memberId);
      const all = (db.agentPrefs[key] ||= {});
      const pr = (all[b] ||= {});
      if (body.level !== undefined) { if (!LEVELS.includes(body.level)) return send(res, 400, { error: 'Pick observe, prepare, execute or automate.' }); pr.level = body.level; }
      if (body.instructions !== undefined) pr.instructions = cleanText(body.instructions, 3000);
      if (body.paused !== undefined) pr.paused = !!body.paused;
      if (body.schedules !== undefined) {
        if (!Array.isArray(body.schedules)) return send(res, 400, { error: 'That isn’t a list of schedules.' });
        const old = pr.schedules || [];
        pr.schedules = body.schedules.slice(0, 10).map((s) => {
          const wf = AGENTS[b].workflows.find((w) => w.key === s?.workflow && !w.paste);
          const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((n) => n >= 0 && n <= 6))].sort();
          const at = Math.round(Number(s.at));
          return wf && days.length && at >= 0 && at < 1440 ? { workflow: wf.key, days, at, last: old.find((o) => o.workflow === wf.key)?.last || null } : null;
        }).filter(Boolean);
      }
      save();
      return send(res, 200, publicAgents(ws.id, auth.memberId)[b]);
    }
    // A new assignment, for one agent or the whole team.
    if (b === 'runs' && !c && m === 'POST') {
      const body = await readJson(req, 100_000);
      const agent = body.agent === 'team' || AGENTS[body.agent] ? body.agent : null;
      if (!agent) return send(res, 400, { error: 'Pick an agent.' });
      const wf = agent !== 'team' && body.workflow ? AGENTS[agent].workflows.find((w) => w.key === body.workflow) : null;
      const extra = cleanText(body.ask, MAX_TURN_CHARS);
      const ask = wf ? wf.ask + (wf.paste ? extra : extra ? `\n\nAlso: ${extra}` : '') : extra;
      if (!ask.trim() || (wf?.paste && !extra)) return send(res, 400, { error: wf?.paste ? 'Paste or describe it first.' : 'Say what you need.' });
      if (runsOf(ws.id, auth.memberId).filter((x) => ['requested', 'planning', 'running'].includes(x.status)).length >= 3) return send(res, 429, { error: 'Your team is busy with three assignments. Wait for one to finish.' });
      const x = newRun(ws, auth.memberId, { agent, ask, title: wf ? wf.name + (extra && !wf.paste ? '' : '') : body.title, workflow: wf?.key || null });
      return send(res, 200, publicRun(x));
    }
    const x = b === 'runs' && c && db.agentRuns[c];
    if (b === 'runs' && (!x || x.wsId !== ws.id || x.memberId !== auth.memberId)) return send(res, 404, { error: 'That assignment is gone.' });
    if (x && !d && m === 'GET') return send(res, 200, publicRun(x));
    if (x && d === 'cancel' && m === 'POST') {
      if (['requested', 'planning', 'running'].includes(x.status)) x.status = 'cancelled';
      for (const p of x.parts) for (const s of p.steps) if (s.status === 'proposed') s.status = 'skipped';
      if (x.status !== 'cancelled') settle(x);
      save();
      news(x);
      return send(res, 200, publicRun(x));
    }
    if (x && d === 'delete' && m === 'POST') {
      if (['requested', 'planning', 'running'].includes(x.status)) return send(res, 400, { error: 'Stop it first.' });
      delete db.agentRuns[x.id];
      save();
      broadcast(ws.id, { type: 'agent:remove', id: x.id, forMember: auth.memberId });
      return send(res, 200, { ok: true });
    }
    // Reply: answer its question, or ask for more, in the same assignment.
    if (x && d === 'reply' && m === 'POST') {
      const body = await readJson(req, 50_000);
      const text = cleanText(body.text, 8000);
      if (!text) return send(res, 400, { error: 'Write something first.' });
      if (['requested', 'planning', 'running'].includes(x.status)) return send(res, 400, { error: 'It’s still working. Wait for it to finish.' });
      if (x.status === 'blocked' && x.agent === 'team') {
        x.ask = `${x.ask}\n\nThey answered your question (${x.question}): ${text}`;
        x.question = null;
        x.parts = [];
        runAssignment(x).catch((e) => console.error('Agent run failed:', e.message));
        return send(res, 200, publicRun(x));
      }
      const last = x.parts.filter((p) => p.status !== 'planned').at(-1) || x.parts[0];
      const part = { id: rid(6), agent: last.agent, ask: text, status: 'planned', steps: [], history: last.history || [{ role: 'user', text: last.ask }, { role: 'assistant', text: last.report || '' }], reply: true };
      x.parts.push(part);
      x.status = 'running';
      x.error = null;
      news(x);
      (async () => { await runPart(x, part); finish(x); })().catch((e) => console.error('Agent reply failed:', e.message));
      return send(res, 200, publicRun(x));
    }
    // Decide on a step: approve (run it now, with any edits to a draft), skip, or undo one already done.
    if (x && d === 'steps' && m === 'POST') {
      const body = await readJson(req, 50_000);
      const ids = Array.isArray(body.ids) ? body.ids : [body.id];
      const results = [];
      for (const id of ids) {
        const at = stepOf(x, id);
        if (!at) continue;
        const { p, s } = at;
        const cx = cxFor(x, p.agent);
        if (body.do === 'approve' && s.status === 'proposed') {
          if (body.args && ids.length === 1 && s.tool === 'draft_email') for (const k of ['to_name', 'to_email', 'subject', 'body']) if (typeof body.args[k] === 'string') s.args[k] = body.args[k].slice(0, 20_000);
          s.approvedAt = Date.now();
          try { await applyStep(x, cx, s); } catch {}
          s.label = cleanText(safeLabel(TOOLS[s.tool], s.args, cx), 200);
        } else if (body.do === 'skip' && s.status === 'proposed') s.status = 'skipped';
        else if (body.do === 'undo' && s.status === 'done' && s.undo) {
          const r = await cx.call(s.undo.method, s.undo.path, s.undo.body);
          if (r.status === 202 && r.body?.pending) s.error = cleanText(r.body.error, 300);
          else if (r.status < 300) { s.status = 'undone'; s.undoneAt = Date.now(); s.error = null; } else s.error = cleanText(r.body?.error || 'Couldn’t undo it.', 300);
        }
        results.push(s);
      }
      settle(x);
      save();
      news(x);
      return send(res, 200, publicRun(x));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  return { route, AGENTS, prefsOf, tick };
}
