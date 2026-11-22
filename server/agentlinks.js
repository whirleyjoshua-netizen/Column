// What an agent connects to (2026-11-22): every tool sits in one connection, with the name people see for it. Each
// person sets each connection Off, Read or Read + act, per agent. These are the person's choices for their agent;
// what the person may use at all (the team's switches, member access, roles) is checked separately and comes first.
export const CONNECTIONS = [
  { key: 'calendar', name: 'Calendar & bookings',
    read: { look_at_day: 'Your calendar and day', find_bookings: 'Bookings from Calendly and Cal.com' },
    act: { schedule_time: 'Put time on your calendar', move_time: 'Move time it put there' } },
  { key: 'tasks', name: 'Tasks',
    read: { list_tasks: 'Tasks' },
    act: { create_task: 'Make tasks', update_task: 'Reschedule, reassign or finish tasks' } },
  { key: 'jobs', name: 'Jobs & boards',
    read: { list_projects: 'Boards (the setup)', find_records: 'Jobs, leads and deals', read_record: 'A record’s full history', team_schedule: 'The team’s visits', plan_route: 'Routes' },
    act: { create_project: 'Start boards', create_record: 'Add jobs, leads, deals…', update_record: 'Update records', log_note: 'Log calls and notes', book_visit: 'Book visits', send_signoff: 'Sign-offs to customers' } },
  { key: 'contacts', name: 'Contacts',
    read: { find_contacts: 'Contacts', find_customers: 'Past and recent customers' },
    act: { save_contact: 'Save contacts' } },
  { key: 'email', name: 'Email', note: 'It writes and sends with your yes. It can’t read your inbox.',
    read: {},
    act: { draft_email: 'Draft emails', draft_email_campaign: 'Draft email campaigns' } },
  { key: 'money', name: 'Money & numbers',
    read: { look_at_money: 'Budgets and bills', business_numbers: 'Your business’s numbers (Analytics)' },
    act: { set_budget: 'Set budgets', add_bill: 'Add bills', draft_invoice: 'Invoice drafts', send_invoice: 'Sending invoices' } },
  { key: 'campaigns', name: 'Campaigns & SOPs',
    read: { list_campaigns: 'Campaigns', read_sops: 'Your SOPs', marketing_snapshot: 'What’s bringing in work (leads by source, jobs won, campaigns, posts)' },
    act: { create_campaign: 'Start campaigns with goals and tasks', make_list: 'Make lists of people to reach' } },
  { key: 'docs', name: 'Docs & templates',
    read: { find_docs: 'Docs', read_doc: 'A doc’s text', find_templates: 'Templates' },
    act: { write_doc: 'Write docs', save_template: 'Save templates' } },
  { key: 'inventory', name: 'Inventory',
    read: { find_inventory: 'Inventory (what’s on hand where)' },
    act: { use_stock: 'Use stock on jobs' } },
  { key: 'photos', name: 'Photos & pictures',
    read: { find_photos: 'Your photos (Folders, Stacks, job photos, chat)', look_at_photos: 'Look at photos to pick the right ones' },
    act: { make_image: 'Make pictures (on your OpenAI or Gemini key)' } },
  { key: 'social', name: 'Social posts', app: { id: 'postiz', name: 'Postiz' },
    read: { list_channels: 'Your social channels', social_posts: 'Your posts in Postiz' },
    act: { draft_social_post: 'Draft social and Google posts' } },
  { key: 'chat', name: 'Team chat',
    read: {},
    act: { post_to_chat: 'Post in your team’s chat feeds' } },
  { key: 'teams', name: 'Microsoft Teams', app: { id: 'teams', name: 'Microsoft Teams' },
    read: {},
    act: { draft_teams_post: 'Post in your team’s Microsoft Teams channel' } },
  { key: 'github', name: 'GitHub', app: { id: 'github', name: 'GitHub' },
    read: { code_activity: 'Code activity from GitHub' },
    act: {} },
  { key: 'company', name: 'Company profile',
    read: {},
    act: { add_to_company_hq: 'Add to Company HQ', make_proof_link: 'Proof-of-insurance links for customers and GCs' } },
  { key: 'automations', name: 'Automations',
    read: {},
    act: { create_automation: 'Set up automations' } },
];
// Always on: a heads-up to the person it works for, and nobody else.
const ALWAYS = { notify_me: 'Send you a heads-up' };
export const TOOL_NAMES = Object.assign({}, ALWAYS, ...CONNECTIONS.flatMap((c) => [c.read, c.act]));
export const connection = (key) => CONNECTIONS.find((c) => c.key === key) || null;
export const connectionOf = (tool) => CONNECTIONS.find((c) => Object.hasOwn(c.read, tool) || Object.hasOwn(c.act, tool)) || null;
export const modesOf = (c) => ['off', ...(Object.keys(c.read).length ? ['read'] : []), ...(Object.keys(c.act).length ? ['act'] : [])];
const RANK = { off: 0, read: 1, act: 2 };
export function originalMode(tools, c) {
  if (Object.keys(c.act).some((k) => tools.includes(k))) return 'act';
  return Object.keys(c.read).some((k) => tools.includes(k)) ? 'read' : 'off';
}
// The tools of one connection at a mode, for an agent built with `tools`. At its original mode it's exactly what it
// was built with; narrower only takes away; wider adds the rest of that mode.
export function toolsAt(tools, c, mode) {
  const was = originalMode(tools, c);
  const built = [...Object.keys(c.read), ...Object.keys(c.act)].filter((k) => tools.includes(k));
  if (mode === was) return built;
  if (mode === 'off') return [];
  if (RANK[mode] < RANK[was]) return built.filter((k) => Object.hasOwn(c.read, k));
  return [...Object.keys(c.read), ...(mode === 'act' ? Object.keys(c.act) : [])];
}
// An agent's tools with this person's choices, in the order it was built with, anything added after.
export function effectiveTools(tools, chosen = {}) {
  if (!Object.keys(chosen).length) return tools;
  const on = new Set(Object.keys(ALWAYS).filter((k) => tools.includes(k)));
  for (const c of CONNECTIONS) for (const k of toolsAt(tools, c, chosen[c.key] || originalMode(tools, c))) on.add(k);
  return [...tools.filter((k) => on.has(k)), ...[...on].filter((k) => !tools.includes(k))];
}
// The connection an automation step works through, so a drafted automation can't do what the agent itself can't.
export const STEP_CONNECTION = { task: 'tasks', post: 'chat', campaign: 'campaigns', contact: 'contacts', record: 'jobs', create: 'jobs', visit: 'jobs', invoice: 'money', money: 'money', email: 'email', doc: 'docs', stock: 'inventory', teams: 'teams' };
