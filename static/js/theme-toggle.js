/* VISR theme toggle: flips html[data-theme]; icons and charts react to the attribute. */
(function () {
  'use strict';
  var KEY = 'theme', root = document.documentElement;
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(theme, persist) {
    root.setAttribute('data-theme', theme);
    if (persist) { try { localStorage.setItem(KEY, theme); } catch (e) {} }
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#theme-toggle')) return;
    set(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
  });
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  if (mq && mq.addEventListener) mq.addEventListener('change', function (e) { if (!saved()) set(e.matches ? 'dark' : 'light', false); });
})();
