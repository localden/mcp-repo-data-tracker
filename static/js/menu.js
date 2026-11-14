/* VISR menu.js: disclosure navigation menus (brief 4.6 q): the header Repositories menu and the scope switcher.
   Markup (layouts/partials/ui/menu.html): [data-menu] > button[aria-expanded][aria-controls] + ul[hidden] of a[href][aria-current].
   Button: Enter/Space/ArrowDown open and focus the current item, ArrowUp opens on the last item.
   List: ArrowUp/Down wrap, Home/End, Escape closes and returns focus. Tab, focusout or an outside click closes. */
(function () {
  'use strict';
  function get(el) {
    var wrap = el && el.closest ? el.closest('[data-menu]') : null; if (!wrap) return null;
    var btn = wrap.querySelector(':scope > button[aria-controls]'); if (!btn) return null;
    var list = document.getElementById(btn.getAttribute('aria-controls'));
    return list ? { wrap: wrap, btn: btn, list: list } : null;
  }
  function items(m) { return Array.prototype.slice.call(m.list.querySelectorAll('a[href]')); }
  function isOpen(m) { return m.btn.getAttribute('aria-expanded') === 'true'; }
  function close(m, refocus) {
    m.btn.setAttribute('aria-expanded', 'false'); m.list.hidden = true;
    if (refocus) m.btn.focus();
  }
  function closeAll(except) {
    document.querySelectorAll('[data-menu] > button[aria-expanded="true"]').forEach(function (b) {
      var m = get(b); if (m && (!except || m.wrap !== except.wrap)) close(m, false);
    });
  }
  function open(m, which) {
    closeAll(m);
    m.btn.setAttribute('aria-expanded', 'true'); m.list.hidden = false;
    var it = items(m); if (!it.length) return;
    var t = which === 'last' ? it[it.length - 1] : (m.list.querySelector('a[aria-current]') || it[0]);
    t.focus();
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-menu] > button[aria-controls]');
    if (b) { var m = get(b); if (m) { if (isOpen(m)) close(m, false); else open(m, 'current'); } return; }
    if (!e.target.closest('[data-menu]')) closeAll(null);
  });

  document.addEventListener('keydown', function (e) {
    var m = get(e.target); if (!m) return;
    if (e.target === m.btn) {
      if (e.key === 'ArrowDown') { open(m, 'current'); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { open(m, 'last'); e.preventDefault(); }
      else if (e.key === 'Escape' && isOpen(m)) { close(m, true); e.preventDefault(); }
      return;
    }
    if (!m.list.contains(e.target)) return;
    var it = items(m), i = it.indexOf(e.target), n = null;
    switch (e.key) {
      case 'ArrowDown': n = it[(i + 1) % it.length]; break;
      case 'ArrowUp': n = it[(i - 1 + it.length) % it.length]; break;
      case 'Home': n = it[0]; break;
      case 'End': n = it[it.length - 1]; break;
      case 'Escape': close(m, true); e.preventDefault(); return;
      default: return;
    }
    if (n) { n.focus(); e.preventDefault(); }
  });

  /* Tab out of the list, or any other focus move outside the menu, closes it without stealing focus */
  document.addEventListener('focusout', function (e) {
    var m = get(e.target); if (!m || !isOpen(m)) return;
    var to = e.relatedTarget; if (to && m.wrap.contains(to)) return;
    close(m, false);
  });
})();
