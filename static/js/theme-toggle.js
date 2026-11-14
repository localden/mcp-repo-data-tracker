/* VISR theme toggle (brief 7.2 D5, D6): flips html[data-theme]; icons, tokens and charts react to the attribute.
   The button is "Dark theme" with aria-pressed. meta[name=theme-color] follows --page on load and on every change.
   A stored choice overrides the system preference; storage access is always guarded. */
(function () {
  'use strict';
  var KEY = 'theme', root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function meta() {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'theme-color'); document.head.appendChild(m); }
    return m;
  }
  function sync() {
    var dark = root.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('#theme-toggle').forEach(function (b) { b.setAttribute('aria-pressed', String(dark)); });
    var c = getComputedStyle(root).getPropertyValue('--page').trim();
    if (c) meta().setAttribute('content', c);
  }
  function set(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (persist) { try { localStorage.setItem(KEY, theme); } catch (e) {} }
    sync();
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#theme-toggle')) return;
    set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
  });
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', function (e) { var s = saved(); if (s !== 'dark' && s !== 'light') set(e.matches ? 'dark' : 'light', false); });
  sync();
})();
