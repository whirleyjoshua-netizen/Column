// AI helpers for software projects, always draft first: nothing is made until someone looks it over and says so.
//   - Plan a feature (the product manager's job): an idea in plain words becomes a feature (phase, priority, why)
//     and the work to build it: stories and tasks with points and acceptance criteria, open questions, risks.
//   - Write test cases (the QA job): a feature's work and acceptance criteria become test cases.
// Both run on the team's own AI key, with Company HQ's planning context.
const POINTS = [1, 2, 3, 5, 8, 13];
const nearest = (n) => POINTS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 3);

export function techAiModule({ db, save, cleanText, readJson, send, aiAsk, replyJson, PJ }) {
  const k = (t, key) => t?.fields.find((f) => f.key === key);
  const labels = (f) => (f?.choices || []).map((c) => c.label);
  const choice = (f, label) => f?.choices.find((c) => c.label.toLowerCase() === String(label || '').toLowerCase())?.id;
  const name = (t, r) => String(r.values[t.primary] ?? '');
  const list = (v, n, max) => (Array.isArray(v) ? v : []).map((x) => cleanText(x, max)).filter(Boolean).slice(0, n);
  const typesOf = (p) => ({ work: p.types.find((t) => t.key === 'work'), feats: p.types.find((t) => t.key === 'features'), tests: p.types.find((t) => t.key === 'tests') });

  // A plan as it's kept: only phases, types and labels the project has, points on the usual scale.
  function cleanPlan(p, d) {
    const { work, feats } = typesOf(p);
    const f = d?.feature || {};
    return {
      feature: { title: cleanText(f.title, 160) || 'New feature', why: cleanText(f.why, 2000), phase: labels(k(feats, 'phase')).find((l) => l.toLowerCase() === String(f.phase || '').toLowerCase()) || null, priority: labels(k(feats, 'priority')).find((l) => l.toLowerCase() === String(f.priority || '').toLowerCase()) || null },
      items: (Array.isArray(d?.items) ? d.items : []).slice(0, 25).map((x) => ({
        title: cleanText(x?.title, 160), type: labels(k(work, 'type')).find((l) => l.toLowerCase() === String(x?.type || '').toLowerCase()) || 'Story',
        estimate: Number(x?.estimate) > 0 ? nearest(Number(x.estimate)) : null, description: cleanText(x?.description, 2000),
        acceptance: list(x?.acceptance, 10, 300), labels: list(x?.labels, 5, 30).filter((l) => labels(k(work, 'labels')).includes(l)), on: x?.on !== false,
      })).filter((x) => x.title),
      questions: list(d?.questions, 8, 300),
      risks: list(d?.risks, 8, 300),
    };
  }

  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d] = parts;
    const m = req.method;
    // ----- plan a feature -----
    if (a === 'projects' && c === 'ai-feature' && m === 'POST') {
      const p = db.projects[b];
      if (!p || p.wsId !== ws.id || !PJ.sees(p, auth.memberId) || p.template !== 'tech') return send(res, 404, { error: 'That project is gone.' });
      const { work, feats } = typesOf(p);
      const body = await readJson(req, 100_000);
      if (d === 'create') {
        const plan = cleanPlan(p, body.plan);
        const fv = { [feats.primary]: plan.feature.title };
        const put = (t, vals, key, val) => { const f = k(t, key); if (f && val != null && val !== '') vals[f.id] = val; };
        put(feats, fv, 'description', plan.feature.why);
        put(feats, fv, 'phase', choice(k(feats, 'phase'), plan.feature.phase));
        put(feats, fv, 'priority', choice(k(feats, 'priority'), plan.feature.priority));
        put(feats, fv, 'status', choice(k(feats, 'status'), 'Planned'));
        const feature = PJ.createRecord(ws, p, feats, auth, fv);
        const items = [];
        for (const x of plan.items.filter((y) => y.on)) {
          const v = { [work.primary]: x.title };
          put(work, v, 'type', choice(k(work, 'type'), x.type));
          put(work, v, 'estimate', x.estimate);
          put(work, v, 'description', x.description);
          put(work, v, 'feature', [feature.id]);
          put(work, v, 'labels', x.labels.map((l) => choice(k(work, 'labels'), l)).filter(Boolean));
          if (x.acceptance.length) put(work, v, 'acceptance', { items: x.acceptance.map((text) => ({ text })) });
          items.push(PJ.createRecord(ws, p, work, auth, v));
        }
        save();
        return send(res, 200, { feature: PJ.publicRecord(feature), items: items.map(PJ.publicRecord) });
      }
      const idea = cleanText(body.idea, 4000);
      if (!idea) return send(res, 400, { error: 'Describe the idea first.' });
      const have = Object.values(db.records).filter((r) => r.projectId === p.id && r.typeId === feats.id).slice(0, 40).map((r) => `- ${name(feats, r)}`).join('\n');
      const system = `You are the product manager on a small software team, inside Kloomie. Turn an idea into a feature and the work to build it.
Break it into stories (what a user can do) and tasks (work users won't see), each small enough to finish in a few days, with an estimate in story points (1, 2, 3, 5, 8, 13) and 2 to 5 testable acceptance criteria written as plain statements. Order them in the order they'd be built. Add the open questions someone should answer before building, and the risks.
Phases you can use: ${labels(k(feats, 'phase')).join(', ')}. Priorities: ${labels(k(feats, 'priority')).join(', ')}. Work types: ${labels(k(work, 'type')).join(', ')}. Labels: ${labels(k(work, 'labels')).join(', ')}.
Don't invent facts about the product or business; where something matters and you don't know it, make it a question.
Reply with JSON only: {"feature":{"title":"","why":"what and why, 2-4 sentences","phase":"","priority":""},"items":[{"title":"","type":"Story","estimate":3,"description":"","acceptance":[""],"labels":[]}],"questions":[""],"risks":[""]}`;
      try {
        const out = replyJson(await aiAsk(ws, auth.memberId, system, `Product: ${p.name}\nFeatures already planned:\n${have || '(none)'}\n\nThe idea:\n${idea}`, 'plan'));
        return send(res, 200, { plan: cleanPlan(p, out) });
      } catch (e) {
        return send(res, e.status || 502, { error: e.message });
      }
    }
    // ----- write test cases for a feature -----
    if (a === 'records' && c === 'ai-tests' && m === 'POST') {
      const at = PJ.recordAt(b, ws.id, auth.memberId);
      if (!at || at.p.template !== 'tech' || at.t.key !== 'features') return send(res, 404, { error: 'That feature is gone.' });
      const { rec, p } = at;
      const { work, feats, tests } = typesOf(p);
      if (!tests) return send(res, 400, { error: 'This project has no test cases list.' });
      const body = await readJson(req, 100_000);
      const plats = labels(k(tests, 'platforms'));
      const clean = (list) => (Array.isArray(list) ? list : []).slice(0, 30).map((x) => ({ title: cleanText(x?.title, 160), steps: cleanText(x?.steps, 2000), expected: cleanText(x?.expected, 1000), platforms: list2(x?.platforms).filter((y) => plats.includes(y)), on: x?.on !== false })).filter((x) => x.title);
      const list2 = (v) => (Array.isArray(v) ? v.map((y) => cleanText(y, 30)).filter(Boolean) : []);
      if (d === 'create') {
        const made = [];
        for (const x of clean(body.tests).filter((y) => y.on)) {
          const v = { [tests.primary]: x.title };
          const put = (key, val) => { const f = k(tests, key); if (f && val != null && val !== '' && !(Array.isArray(val) && !val.length)) v[f.id] = val; };
          put('steps', x.steps);
          put('expected', x.expected);
          put('feature', [rec.id]);
          put('release', rec.values[k(feats, 'release')?.id] || null);
          put('platforms', x.platforms.map((l) => choice(k(tests, 'platforms'), l)).filter(Boolean));
          made.push(PJ.createRecord(ws, p, tests, auth, v));
        }
        save();
        return send(res, 200, { tests: made.map(PJ.publicRecord) });
      }
      const items = Object.values(db.records).filter((r) => r.projectId === p.id && r.typeId === work.id && (r.values[k(work, 'feature')?.id] || []).includes(rec.id));
      const acc = (r) => (r.values[k(work, 'acceptance')?.id]?.items || []).map((x) => x.text);
      if (!items.length && !rec.values[k(feats, 'description')?.id]) return send(res, 400, { error: 'Add some work items (with acceptance criteria) or a description to this feature first.' });
      const brief = items.map((r) => `- ${name(work, r)}${r.values[k(work, 'description')?.id] ? ': ' + String(r.values[k(work, 'description').id]).slice(0, 300) : ''}${acc(r).length ? '\n  Acceptance: ' + acc(r).join(' | ') : ''}`).join('\n');
      const have = Object.values(db.records).filter((r) => r.projectId === p.id && r.typeId === tests.id && (r.values[k(tests, 'feature')?.id] || []).includes(rec.id)).map((r) => `- ${name(tests, r)}`).join('\n');
      const system = `You are the QA lead on a small software team, inside Kloomie. Write manual test cases for a feature: each one specific, with numbered steps someone can follow and the exact expected result. Cover every acceptance criterion, the obvious edge cases (empty, invalid, duplicate, offline, slow), and the platforms that matter. Don't repeat tests that already exist.
Platforms you can use: ${plats.join(', ')}.
Reply with JSON only: {"tests":[{"title":"","steps":"1. …\\n2. …","expected":"","platforms":[]}]}`;
      try {
        const out = replyJson(await aiAsk(ws, auth.memberId, system, `Product: ${p.name}\nFeature: ${name(feats, rec)}\n${rec.values[k(feats, 'description')?.id] ? 'What and why: ' + rec.values[k(feats, 'description').id] + '\n' : ''}\nIts work:\n${brief || '(none yet)'}\n\nTests that already exist:\n${have || '(none)'}`, 'plan'));
        return send(res, 200, { tests: clean(out.tests) });
      } catch (e) {
        return send(res, e.status || 502, { error: e.message });
      }
    }
    return null;
  }
  return { route };
}
