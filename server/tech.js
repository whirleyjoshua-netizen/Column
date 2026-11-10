// Technology & software: the Jobs & projects engine set up for a small team building a product. Work items (a
// story, a bug or a task) move across a development board from Backlog to Done; features make the roadmap, by
// phase and target date; releases gather what ships together. Same records, fields and views as any project,
// with a few things only a software team needs: severity apart from priority, story points, acceptance criteria,
// the branch or pull request, and the bug-only details (steps to reproduce, expected, actual) shown on bugs.

const c = (label, color) => ({ label, color });
export const TECH_STATUS = ['Backlog', 'Ready', 'In progress', 'Code review', 'Testing', 'Ready to release', 'Done'];
const STATUS_COLORS = ['gray', 'blue', 'amber', 'violet', 'teal', 'rose', 'green'];
const bugOnly = { showIf: { field: 'type', is: ['Bug'] } };

export const TECH_TEMPLATE = {
  name: 'Technology & software', icon: '💻', about: 'Work items on a development board, features on a roadmap, releases',
  types: [
    { key: 'work', name: 'Work items', singular: 'Work item', icon: '🧩', primary: 'title', fields: [
      { key: 'title', name: 'Title', type: 'text' },
      { key: 'number', name: 'Key', type: 'autonumber', prefix: 'APP-', start: 1 },
      { key: 'type', name: 'Type', type: 'select', choices: [c('Story', 'blue'), c('Bug', 'rose'), c('Task', 'gray')] },
      { key: 'status', name: 'Status', type: 'select', choices: TECH_STATUS.map((s, i) => c(s, STATUS_COLORS[i])) },
      { key: 'assignee', name: 'Assignee', type: 'person' },
      { key: 'priority', name: 'Priority', type: 'select', choices: [c('Urgent', 'rose'), c('High', 'amber'), c('Medium', 'blue'), c('Low', 'gray')] },
      { key: 'estimate', name: 'Estimate', type: 'number', hint: 'Story points' },
      { key: 'feature', name: 'Feature', type: 'link', target: 'features' },
      { key: 'release', name: 'Release', type: 'link', target: 'releases' },
      { key: 'sprint', name: 'Sprint', type: 'link', target: 'sprints' },
      { key: 'labels', name: 'Labels', type: 'multi', choices: [c('Frontend', 'blue'), c('Backend', 'violet'), c('Design', 'rose'), c('DevOps', 'teal'), c('Docs', 'gray')] },
      { key: 'due', name: 'Due', type: 'date' },
      { key: 'severity', name: 'Severity', type: 'select', choices: [c('Critical', 'rose'), c('High', 'amber'), c('Medium', 'blue'), c('Low', 'gray')], hint: 'How bad it is, apart from how soon to fix it', ...bugOnly },
      { key: 'description', name: 'Description', type: 'text', long: true },
      { key: 'steps', name: 'Steps to reproduce', type: 'text', long: true, ...bugOnly },
      { key: 'expected', name: 'Expected', type: 'text', long: true, ...bugOnly },
      { key: 'actual', name: 'Actual', type: 'text', long: true, ...bugOnly },
      { key: 'version', name: 'Found in version', type: 'text', ...bugOnly },
      { key: 'pr', name: 'Branch or pull request', type: 'url' },
      { key: 'acceptance', name: 'Acceptance criteria', type: 'checklist', list: [] },
      { key: 'subtasks', name: 'Subtasks', type: 'checklist', list: [] },
      { key: 'files', name: 'Attachments', type: 'files' },
    ], views: [
      { name: 'Board', kind: 'board', groupBy: 'status' },
      { name: 'Sprint', kind: 'sprint', sprint: 'sprint' },
      { name: 'All work', kind: 'table', sortBy: 'number' },
      { name: 'Bugs', kind: 'table', sortBy: 'number', filter: { field: 'type', is: ['Bug'] } },
    ] },
    { key: 'features', name: 'Features', singular: 'Feature', icon: '🗺️', primary: 'title', fields: [
      { key: 'title', name: 'Feature', type: 'text' },
      { key: 'phase', name: 'Phase', type: 'select', choices: [c('Foundation', 'gray'), c('Core product', 'blue'), c('Collaboration', 'violet'), c('Launch', 'green'), c('Later', 'amber')] },
      { key: 'status', name: 'Status', type: 'select', choices: [c('Idea', 'gray'), c('Planned', 'blue'), c('In progress', 'amber'), c('Shipped', 'green')] },
      { key: 'start', name: 'Start', type: 'date' },
      { key: 'target', name: 'Target date', type: 'date' },
      { key: 'owner', name: 'Owner', type: 'person' },
      { key: 'priority', name: 'Priority', type: 'select', choices: [c('Must have', 'rose'), c('Should have', 'amber'), c('Nice to have', 'gray')] },
      { key: 'release', name: 'Release', type: 'link', target: 'releases' },
      { key: 'depends', name: 'Depends on', type: 'link', target: 'features', many: true },
      { key: 'description', name: 'What and why', type: 'text', long: true },
    ], views: [
      { name: 'Roadmap', kind: 'timeline', start: 'start', end: 'target', groupBy: 'phase' },
      { name: 'By phase', kind: 'board', groupBy: 'phase' },
      { name: 'All features', kind: 'table', sortBy: 'target' },
    ] },
    { key: 'sprints', name: 'Sprints', singular: 'Sprint', icon: '🏃', primary: 'name', fields: [
      { key: 'name', name: 'Sprint', type: 'text' },
      { key: 'status', name: 'Status', type: 'select', choices: [c('Planned', 'gray'), c('Active', 'amber'), c('Done', 'green')] },
      { key: 'start', name: 'Start', type: 'date' },
      { key: 'end', name: 'End', type: 'date' },
      { key: 'goal', name: 'Sprint goal', type: 'text', long: true },
      { key: 'capacity', name: 'Points per person', type: 'number', hint: 'What one person can finish in this sprint' },
    ], views: [
      { name: 'All sprints', kind: 'table', sortBy: 'start' },
    ] },
    { key: 'releases', name: 'Releases', singular: 'Release', icon: '🚀', primary: 'name', fields: [
      { key: 'name', name: 'Version', type: 'text' },
      { key: 'status', name: 'Status', type: 'select', choices: [c('Planned', 'gray'), c('In testing', 'amber'), c('Released', 'green')] },
      { key: 'date', name: 'Release date', type: 'date' },
      { key: 'checklist', name: 'Release checklist', type: 'checklist', list: ['All work items done', 'No open critical bugs', 'Tests passed', 'Release notes written', 'Deployed'] },
      { key: 'notes', name: 'Release notes', type: 'text', long: true },
    ], views: [
      { name: 'All releases', kind: 'table', sortBy: 'date' },
    ] },
  ],
};

// The key prefix from the project's name: "Kloomie Mobile" → KM-, "Atlas" → ATL-.
export function techPrefix(name) {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'APP-';
  const p = words.length > 1 ? words.slice(0, 3).map((w) => w[0]).join('') : words[0].slice(0, 3);
  return (p.length >= 2 ? p : 'APP') + '-';
}

// Projects made from step 1 of this template, before sprints and the roadmap timeline: what to add to them.
export const TECH_LATER = { types: ['sprints'], fields: { work: ['sprint'] }, views: { work: ['Sprint'], features: ['Roadmap'] } };
