/* VISR ui.js: row links, sorting, tabs, show-more, filters. */
(function () {
  'use strict';
  var root = document.documentElement;
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function activeRoot() { return document.querySelector('.repo-content[data-repo="' + esc(root.getAttribute('data-scope') || '') + '"]') || document; }
  window.VISR = Object.assign(window.VISR || {}, { activeRoot: activeRoot });

  /* whole-row links */
  document.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-row-link]');
    if (!tr || e.target.closest('a,button,input,summary,label')) return;
    if (window.getSelection && String(window.getSelection())) return;
    var a = tr.querySelector('a.v-row-link');
    if (a) a.click();
  });

  /* sortable tables */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('table[data-sortable] th[data-sort] > button');
    if (!btn) return;
    var th = btn.parentElement, table = th.closest('table'), tbody = table.tBodies[0];
    if (!tbody) return;
    var idx = Array.prototype.indexOf.call(th.parentElement.children, th);
    var dir = th.getAttribute('aria-sort') === 'descending' ? 'ascending' : 'descending';
    th.parentElement.querySelectorAll('th[data-sort]').forEach(function (h) { h.setAttribute('aria-sort', 'none'); });
    th.setAttribute('aria-sort', dir);
    function val(r) {
      var c = r.cells[idx]; if (!c) return null;
      var v = c.getAttribute('data-v'); if (v === null || v === '') return null;
      var n = parseFloat(v); return isNaN(n) ? v.toLowerCase() : n;
    }
    Array.prototype.slice.call(tbody.rows).sort(function (a, b) {
      var x = val(a), y = val(b);
      if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1;
      var c = x < y ? -1 : x > y ? 1 : 0; return dir === 'ascending' ? c : -c;
    }).forEach(function (r) { tbody.appendChild(r); });
  });

  /* tabs */
  function selectTab(tab) {
    tab.closest('[role=tablist]').querySelectorAll('[role=tab]').forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      var p = document.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on;
    });
    document.dispatchEvent(new CustomEvent('visr:tabchange', { detail: { tab: tab.id } }));
  }
  document.addEventListener('click', function (e) { var t = e.target.closest('[role=tablist] [role=tab]'); if (t) selectTab(t); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var t = e.target.closest && e.target.closest('[role=tablist] [role=tab]'); if (!t) return;
    var tabs = Array.prototype.slice.call(t.closest('[role=tablist]').querySelectorAll('[role=tab]'));
    var n = tabs[(tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    n.focus(); selectTab(n); e.preventDefault();
  });

  /* show more */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-more-for]'); if (!b) return;
    var tb = document.getElementById(b.getAttribute('data-more-for')); if (!tb) return;
    var open = tb.getAttribute('data-expanded') !== 'true';
    tb.setAttribute('data-expanded', String(open));
    tb.querySelectorAll('tr[data-more]').forEach(function (r) { r.hidden = !open; });
    b.textContent = open ? 'Show fewer' : b.getAttribute('data-label');
  });

  /* filters */
  var KEYS = { author: 'author', label: 'labels', type: 'type', status: 'status', tier: 'tier', priority: 'priority',
               sla: 'sla', badge: 'badges', state: 'state', stage: 'stage' };
  function parse(q) {
    return q.trim().toLowerCase().split(/\s+/).filter(Boolean).map(function (t) {
      var m = /^([a-z]+):(.+)$/.exec(t);
      return (m && KEYS[m[1]]) ? { k: KEYS[m[1]], v: m[2].split(',') } : { k: null, v: [t] };
    });
  }
  function match(tr, toks) {
    return toks.every(function (t) {
      if (!t.k) return (tr.getAttribute('data-text') || tr.textContent).toLowerCase().indexOf(t.v[0]) !== -1;
      var list = (tr.getAttribute('data-' + t.k) || '').toLowerCase().split(',');
      return t.v.some(function (v) { return list.indexOf(v) !== -1; });
    });
  }
  function run(scope) {
    var input = scope.querySelector('[data-filter-input]'); if (!input) return;
    var toks = parse(input.value), active = toks.length > 0, shown = 0;
    var rows = scope.querySelectorAll('tr[data-row]');
    rows.forEach(function (tr) {
      var ok = match(tr, toks);
      var tb = tr.closest('tbody');
      var collapsed = tr.hasAttribute('data-more') && !(tb && tb.getAttribute('data-expanded') === 'true');
      tr.hidden = active ? !ok : collapsed;
      if (ok) shown++;
    });
    /* cluster sub-headers (tr[data-subhead]) follow their member rows: shown while any member is shown */
    scope.querySelectorAll('tr[data-subhead]').forEach(function (h) {
      if (!active) { var tb = h.closest('tbody'); h.hidden = h.hasAttribute('data-more') && !(tb && tb.getAttribute('data-expanded') === 'true'); return; }
      var n = h.nextElementSibling, any = false;
      while (n && n.hasAttribute('data-row')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
      h.hidden = !any;
    });
    scope.querySelectorAll('tr.v-more').forEach(function (r) { r.hidden = active; });
    scope.querySelectorAll('[data-filter-section],[data-filter-group]').forEach(function (s) {
      s.hidden = active && !s.querySelector('tr[data-row]:not([hidden])');
    });
    var cnt = scope.querySelector('[data-filter-count]');
    if (cnt) { var noun = cnt.getAttribute('data-noun') || 'items';
      cnt.textContent = active ? 'Showing ' + shown + ' of ' + rows.length + ' ' + noun : rows.length + ' ' + noun; }
    var empty = scope.querySelector('[data-filter-empty]'); if (empty) empty.hidden = !(active && shown === 0);
    var norm = input.value.trim().toLowerCase().replace(/\s+/g, ' ');
    scope.querySelectorAll('[data-filter]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(norm !== '' && b.getAttribute('data-filter').toLowerCase() === norm));
    });
    scope.querySelectorAll('.v-field [data-filter-clear]').forEach(function (c) { c.hidden = !active; });
  }
  document.addEventListener('input', function (e) {
    if (!e.target.matches('[data-filter-input]')) return;
    var s = e.target.closest('[data-filter-scope]'); if (s) run(s);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.target.matches && e.target.matches('[data-filter-input]')) {
      e.target.value = ''; var s = e.target.closest('[data-filter-scope]'); if (s) run(s);
    }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter-scope] [data-filter]'), c = e.target.closest('[data-filter-scope] [data-filter-clear]');
    if (!b && !c) return;
    var s = (b || c).closest('[data-filter-scope]'), input = s.querySelector('[data-filter-input]'); if (!input) return;
    input.value = c ? '' : (b.getAttribute('aria-pressed') === 'true' ? '' : b.getAttribute('data-filter'));
    run(s);
    if (b && input.value) { var r = s.querySelector('[data-filter-results]'); if (r) r.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  });
  function init() { document.querySelectorAll('[data-filter-scope]').forEach(function (s) { var i = s.querySelector('[data-filter-input]'); if (i && i.value) run(s); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
