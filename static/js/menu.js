/* VISR menu.js: the one popover (design system v4 4.9). The header Repositories menu, the scope switcher, select chips and, below
   64rem, the view and sort menus.
   Markup (layouts/partials/ui/menu.html): [data-menu] holds a trigger [aria-haspopup="menu"][aria-expanded][aria-controls] and the
   list ul.v-menu[role=menu][hidden]; rows are .v-menu-opt: a[role=menuitem] (navigates), button[role=menuitemcheckbox] (toggles and
   stays open) or button[role=menuitemradio] (selects and closes).
   Keys: Enter, Space or ArrowDown on the trigger opens on the current or first row, ArrowUp on the last; in the list arrows wrap,
   Home and End jump, letters type ahead, Escape closes and returns focus. One menu is open at a time; Tab, a focus move outside or an
   outside click closes it. A list that would pass the right viewport edge (minus 16px) is end-aligned (.is-end).
   Option rows dispatch "visr:menuchange" on the wrap: detail {wrap, trigger, list, item, value, checked, multi}. */
(function () {
  'use strict';
  function get(el) {
    var wrap = el && el.closest ? el.closest('[data-menu]') : null; if (!wrap) return null;
    var btn = wrap.querySelector('[aria-haspopup="menu"][aria-controls]'); if (!btn) return null;
    var list = document.getElementById(btn.getAttribute('aria-controls'));
    return list ? { wrap: wrap, btn: btn, list: list } : null;
  }
  function items(m) {
    return Array.prototype.slice.call(m.list.querySelectorAll('.v-menu-opt')).filter(function (x) { return x.getAttribute('aria-disabled') !== 'true'; });
  }
  function isOpen(m) { return m.btn.getAttribute('aria-expanded') === 'true'; }
  function close(m, refocus) {
    m.btn.setAttribute('aria-expanded', 'false'); m.list.hidden = true;
    if (refocus) m.btn.focus();
  }
  function closeAll(except) {
    document.querySelectorAll('[data-menu] [aria-haspopup="menu"][aria-expanded="true"]').forEach(function (b) {
      var m = get(b); if (!m || m.list.hasAttribute('data-menu-pinned')) return;
      if (!except || m.wrap !== except.wrap) close(m, false);
    });
  }
  function place(m) {   /* start-aligned unless the template asked for the end or the right edge would leave the viewport */
    var l = m.list;
    if (!l.hasAttribute('data-end')) l.setAttribute('data-end', l.classList.contains('is-end') ? '1' : '0');
    l.classList.toggle('is-end', l.getAttribute('data-end') === '1');
    var r = l.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    if (r.right > vw - 16) l.classList.add('is-end');
    else if (r.left < 16 && l.classList.contains('is-end')) l.classList.remove('is-end');
  }
  function open(m, which) {
    closeAll(m);
    m.list.removeAttribute('data-menu-pinned');
    m.btn.setAttribute('aria-expanded', 'true'); m.list.hidden = false;
    place(m);
    var it = items(m); if (!it.length) return;
    var cur = m.list.querySelector('.v-menu-opt[aria-current], .v-menu-opt[aria-checked="true"]');
    var t = which === 'last' ? it[it.length - 1] : (cur && it.indexOf(cur) !== -1 ? cur : it[0]);
    t.focus();
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest('[data-menu] [aria-haspopup="menu"]');
    if (b) {
      var m = get(b);
      if (m && !b.disabled) { if (isOpen(m) && !m.list.hasAttribute('data-menu-pinned')) close(m, false); else open(m, 'current'); }
      return;
    }
    var opt = e.target.closest('.v-menu .v-menu-opt');
    if (opt) {
      var mm = get(opt), role = opt.getAttribute('role');
      if (opt.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
      if (role === 'menuitemcheckbox' || role === 'menuitemradio') {
        var multi = role === 'menuitemcheckbox', on = multi ? opt.getAttribute('aria-checked') !== 'true' : true;
        if (!multi) Array.prototype.forEach.call(opt.closest('.v-menu').querySelectorAll('[role="menuitemradio"]'), function (o) { o.setAttribute('aria-checked', 'false'); });
        opt.setAttribute('aria-checked', String(on));
        var host = mm ? mm.wrap : opt.closest('.v-menu');
        host.dispatchEvent(new CustomEvent('visr:menuchange', { bubbles: true, detail: {
          wrap: mm ? mm.wrap : null, trigger: mm ? mm.btn : null, list: opt.closest('.v-menu'), item: opt,
          value: opt.getAttribute('data-value'), checked: on, multi: multi } }));
        if (!multi && mm) close(mm, true);
      }
      return;
    }
    if (!e.target.closest('[data-menu]')) closeAll(null);
  });

  var typed = '', typedAt = 0;
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
      case 'Escape': close(m, true); e.preventDefault(); e.stopPropagation(); return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {   /* type-ahead */
          var now = Date.now(); typed = now - typedAt > 600 ? e.key.toLowerCase() : typed + e.key.toLowerCase(); typedAt = now;
          for (var k = 1; k <= it.length; k++) {
            var c = it[(i + (typed.length > 1 ? k - 1 : k) + it.length) % it.length];
            var label = c.querySelector('.v-menu-text');
            if ((label ? label.textContent : c.textContent).trim().toLowerCase().indexOf(typed) === 0) { n = c; break; }
          }
        }
        if (!n) return;
    }
    if (n) { n.focus(); e.preventDefault(); }
  });

  /* Tab out of the list, or any other focus move outside the menu, closes it without stealing focus */
  document.addEventListener('focusout', function (e) {
    var m = get(e.target); if (!m || !isOpen(m) || m.list.hasAttribute('data-menu-pinned')) return;
    var to = e.relatedTarget; if (to && m.wrap.contains(to)) return;
    if (!to) return;   /* a click on a non-focusable area is handled by the click listener */
    close(m, false);
  });
})();
