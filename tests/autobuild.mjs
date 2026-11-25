// Driving the automation builder in a browser test (2026-11-25): small nodes on the canvas, the picked one's fields
// in the panel beside it (Settings | Advanced settings), and the picker for what sets it off and what a step does.
//   const B = autoUI(A);   // A from the test's tab(): { ev, until, tap }
//   await B.when('contact.created'); await B.step(B.act(0), 'task'); await B.adv(); await B.set();
export function autoUI(A) {
  const top = `document.querySelector('#sheet .auto-flow > .auto-steps')`;
  const acts = (list = top) => `[...${list}.children].filter((x) => x.classList.contains('auto-act'))`;
  const B = {
    top, acts,
    panel: `document.querySelector('#sheet .ab-panel')`,
    act: (i, list = top) => `${acts(list)}.at(${i})`,
    // Pick a node (the trigger with null): its fields open in the panel.
    async pick(node) {
      const el = node || `document.querySelector('#sheet .auto-trigger')`;
      await A.until(`!!(${el})`);
      await A.tap(`${el}.querySelector('.an-b')`);
      await A.until(`${el}.classList.contains('sel')`);
    },
    async choose(key) {
      await A.tap(`document.querySelector('#sheet .ab-panel .ab-change')`);
      await A.tap(`document.querySelector('.ap-pop .ap-item[data-key="${key}"]')`);
      await A.until(`!document.querySelector('.ap-pop')`);
    },
    async when(kind) { await B.pick(null); await B.choose(kind); },
    async step(node, kind) { await B.pick(node); await B.choose(kind); },
    // + Another step (or + Step in a branch) with the step picked: it's added and picked.
    async add(kind, list = top) {
      await A.tap(`${list}.querySelector(':scope > .auto-add-step')`);
      await A.tap(`document.querySelector('.ap-pop .ap-item[data-key="${kind}"]')`);
      await A.until(`!document.querySelector('.ap-pop')`);
    },
    async adv() { await A.tap(`document.querySelector('#sheet .ab-tabs [data-tab=adv]')`); await A.until(`document.querySelector('#sheet .ab-tabs [data-tab=adv]').classList.contains('on')`); },
    async set() { if (await A.ev(`!!document.querySelector('#sheet .ab-tabs [data-tab=set]')`)) await A.tap(`document.querySelector('#sheet .ab-tabs [data-tab=set]')`); },
  };
  return B;
}
