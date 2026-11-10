// Daily standups for a project: each person answers three questions (what they finished, what they're on, what's in
// their way), the project gets a team report for the day, and anything in someone's way becomes a task for the
// project lead with a notification. Each weekday from 9am team time, people who haven't posted get a reminder.
const TICK_MS = Number(process.env.STANDUP_TICK_MS) || 10 * 60_000;
const FROM = Number(process.env.STANDUP_FROM ?? 9 * 60); // minutes after midnight, team time

export function standupModule({ db, save, broadcast, rid, cleanText, readJson, send, notify, makeTask, teamDay, localNow, sees }) {
  db.standups ||= {};
  const on = (p) => !!p.standup?.on;
  const lead = (ws, p) => (ws.members.some((m) => m.id === p.standup?.leadId) ? p.standup.leadId : p.memberId);
  // Who's expected: the people who can see the project (everyone on the team, unless it's private).
  const people = (ws, p) => ws.members.filter((m) => sees(p, m.id));
  const entriesOn = (p, day) => Object.values(db.standups).filter((x) => x.projectId === p.id && x.day === day).sort((a, b) => a.at - b.at);
  const publicEntry = ({ wsId, ...x }) => x;
  function report(ws, p, day) {
    const list = entriesOn(p, day);
    const posted = new Set(list.map((x) => x.memberId));
    return {
      day, on: on(p), leadId: lead(ws, p), entries: list.map(publicEntry),
      waiting: people(ws, p).filter((m) => !posted.has(m.id)).map((m) => m.id),
      blockers: list.filter((x) => x.blocked).length,
    };
  }
  const news = (p) => broadcast(p.wsId, { type: 'standup', projectId: p.id });

  async function route(req, res, parts, auth, ws) {
    const [a, b, c] = parts;
    if (a !== 'projects' || c !== 'standup') return null;
    const p = db.projects[b];
    if (!p || p.wsId !== ws.id || !sees(p, auth.memberId)) return send(res, 404, { error: 'That project is gone.' });
    const m = req.method;
    const url = new URL(req.url, 'http://x');
    const today = teamDay(ws.id);
    if (m === 'GET') {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : today;
      return send(res, 200, report(ws, p, day));
    }
    if (m === 'POST') {
      const body = await readJson(req);
      const did = cleanText(body.did, 2000), doing = cleanText(body.doing, 2000), blocked = cleanText(body.blocked, 2000);
      if (!did && !doing && !blocked) return send(res, 400, { error: 'Answer at least one.' });
      let x = Object.values(db.standups).find((y) => y.projectId === p.id && y.day === today && y.memberId === auth.memberId);
      const wasBlocked = x?.blocked || '';
      if (!x) {
        x = { id: rid(), wsId: ws.id, projectId: p.id, day: today, memberId: auth.memberId };
        db.standups[x.id] = x;
      }
      Object.assign(x, { did, doing, blocked, by: auth.member, at: Date.now() });
      // Something in the way: a task for the project lead today, and they hear about it.
      if (blocked && blocked !== wasBlocked) {
        const leadId = lead(ws, p);
        const task = makeTask?.(ws, auth, { text: `Unblock ${auth.member}: ${blocked}`.slice(0, 300), due: today, assigneeId: leadId });
        if (task) x.taskId = task.id;
        if (leadId !== auth.memberId) notify(ws.id, leadId, { title: `${auth.member} is blocked`, text: `${p.name}: ${blocked}`, kind: 'standup', go: 'standup:' + p.id, taskId: task?.id || null });
      }
      // Old answers go after 90 days.
      for (const y of Object.values(db.standups)) if (y.projectId === p.id && y.day < new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)) delete db.standups[y.id];
      save();
      news(p);
      return send(res, 200, report(ws, p, today));
    }
    if (m === 'PATCH') {
      const me = ws.members.find((x) => x.id === auth.memberId);
      if (!['owner', 'admin'].includes(me?.role) && p.memberId !== auth.memberId) return send(res, 403, { error: 'Only whoever made the project, or an owner or admin, can change its standup.' });
      const body = await readJson(req);
      p.standup = { on: body.on !== undefined ? !!body.on : on(p), leadId: ws.members.some((x) => x.id === body.leadId) ? body.leadId : p.standup?.leadId || p.memberId, prompted: p.standup?.prompted || null };
      save();
      news(p);
      return send(res, 200, report(ws, p, today));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Weekday mornings: a nudge for whoever hasn't posted yet, once a day.
  function tick() {
    for (const p of Object.values(db.projects)) {
      if (!on(p)) continue;
      const ws = db.workspaces[p.wsId];
      if (!ws || ws.deleteAt) continue;
      const now = localNow(ws);
      if (now.weekday === 0 || now.weekday === 6 || now.minutes < FROM || p.standup.prompted === now.day) continue;
      p.standup.prompted = now.day;
      const posted = new Set(entriesOn(p, now.day).map((x) => x.memberId));
      for (const m of people(ws, p)) if (!posted.has(m.id)) notify(ws.id, m.id, { title: `Standup for ${p.name}`, text: 'What did you finish, what are you on today, and is anything in your way?', kind: 'standup', go: 'standup:' + p.id, key: 'standup:' + p.id });
      save();
    }
  }
  setInterval(tick, TICK_MS).unref?.();
  setTimeout(tick, 2000).unref?.();
  return { route, tick };
}
