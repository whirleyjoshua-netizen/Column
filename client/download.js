// The download page: points each visitor at the build for their device.
(() => {
  const RELEASES = 'https://github.com/whirleyjoshua-netizen/Column/releases/latest/download/';
  const $ = (s) => document.querySelector(s);
  for (const a of document.querySelectorAll('[data-file]')) a.href = RELEASES + a.dataset.file;

  const ua = navigator.userAgent;
  // iPads report themselves as Macs; a touch screen gives them away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = ios ? 'ios' : /Android/.test(ua) ? 'android' : /Mac/.test(ua) ? 'mac' : /Win/.test(ua) ? 'windows' : /Linux/.test(ua) ? 'linux' : '';
  const cta = $('#cta');
  const alt = $('#ctaAlt');
  const show = (id) => $('#' + id)?.classList.remove('hidden');

  if (os === 'ios' || os === 'android') {
    show(os);
    cta.textContent = 'How to install';
    cta.href = '#' + os;
    $('#all').classList.add('hidden');
  } else if (os === 'mac') {
    show('mac');
    cta.textContent = 'Download for Mac';
    cta.href = RELEASES + 'Column-mac-arm64.dmg';
    alt.innerHTML = 'For Apple Silicon. <a href="' + RELEASES + 'Column-mac-x64.dmg">Intel Mac?</a>';
  } else if (os === 'windows') {
    show('windows');
    cta.textContent = 'Download for Windows';
    cta.href = RELEASES + 'Column-windows-setup.exe';
  } else if (os === 'linux') {
    cta.textContent = 'Download for Linux';
    cta.href = RELEASES + 'Column-linux.AppImage';
  }
})();
