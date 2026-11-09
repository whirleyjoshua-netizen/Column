// The website's video gallery: a button for each part of the app swaps what the one player shows.
// A link to /#see-<name> (say /#see-stacks) opens on that video.
(() => {
  const video = document.getElementById('demoVideo');
  const note = document.getElementById('demoNote');
  const tabs = [...document.querySelectorAll('.vid-tabs [role=tab]')];
  if (!video || !tabs.length) return;
  const show = (tab, play) => {
    for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
    video.pause();
    video.poster = tab.dataset.poster;
    video.src = tab.dataset.src;
    note.textContent = tab.dataset.note;
    if (play) video.play().catch(() => {});
  };
  for (const t of tabs) t.addEventListener('click', () => show(t, true));
  const want = /^#see-(.+)$/.exec(location.hash);
  const start = want && tabs.find((t) => t.dataset.v === want[1]);
  if (start) {
    show(start, false);
    document.getElementById('demo').scrollIntoView();
  }
})();
