// Help used to be one long page: an old link to a part of it (/help#mileage) goes to the page that part is on now.
(() => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  let map = {};
  try { map = JSON.parse(document.getElementById('helpAnchors').textContent); } catch { return; }
  const slug = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
  if (slug && /^[a-z0-9-]+$/.test(slug)) location.replace('/help/' + slug + (slug === id || !/^[\w-]+$/.test(id) ? '' : '#' + id));
})();
