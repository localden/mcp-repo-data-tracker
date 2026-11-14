/* VISR ui.js: legacy ?repo= redirects, header height, row links, disclosures, Table toggles, tabs, list filtering
   (tabs + chips + search + rule filter + "Show all"; data-url lists keep ?tab=, ?q= and ?chip=a,b in the URL), sortable headers,
   scroll edge fades.
   Data-attribute contracts: build/wp0a-api.md. Never smooth-scrolls (brief 7.3 A8). */
(function () {
  'use strict';
  var root = document.documentElement;
  var nf = (function () { var f = new Intl.NumberFormat('en-US'); return function (n) { return f.format(n); }; })();
  function all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }

  /* ---- legacy ?repo=owner/repo links on /issues/, /pulls/, /health/, /contributors/ (brief 2.1) */
  (function () {
    var m = /\/(issues|pulls|health|contributors)\/?$/.exec(location.pathname); if (!m) return;
    var key = null; try { key = new URLSearchParams(location.search).get('repo'); } catch (e) { return; }
    if (!key || key.indexOf('/') < 1) return;
    var slug = key.split('/').pop();
    if (!/^[A-Za-z0-9._-]+$/.test(slug)) return;
    /* only repos the header menu knows about, so a stale link never lands on a 404 */
    if (!document.querySelector('#nav-repos-list a[href$="/repos/' + esc(slug) + '/"]')) return;
    var kind = (m[1] === 'issues' || m[1] === 'pulls') ? m[1] : 'repos';
    location.replace(location.pathname.slice(0, m.index) + '/' + kind + '/' + slug + '/' + location.hash);
  })();

  /* ---- --header-h from the sticky header (R7): scroll-padding and sticky table heads use it */
  var header = document.querySelector('.v-header');
  function headerH() {
    var h = header && getComputedStyle(header).position === 'sticky' ? header.offsetHeight : 0;
    root.style.setProperty('--header-h', h + 'px');
  }
  headerH();
  if (header && window.ResizeObserver) new ResizeObserver(headerH).observe(header);
  window.addEventListener('resize', headerH);

  /* ---- whole-row links: a click anywhere on tr[data-row-link] follows its a.v-row-link */
  document.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-row-link]');
    if (!tr || e.target.closest('a,button,input,label,select,textarea')) return;
    if (window.getSelection && String(window.getSelection())) return;
    var a = tr.querySelector('a.v-row-link'); if (!a) return;
    if (e.metaKey || e.ctrlKey) window.open(a.href, '_blank', 'noopener'); else a.click();
  });

  /* ---- disclosures: button[data-disclosure][aria-expanded][aria-controls] + panel[hidden]; Escape closes and returns focus */
  function setDisclosure(btn, open) {
    btn.setAttribute('aria-expanded', String(open));
    (btn.getAttribute('aria-controls') || '').split(/\s+/).forEach(function (id) {
      var p = id && document.getElementById(id); if (p) p.hidden = !open;
    });
    var L = lists.get(btn.closest('[data-list]')); if (L) L.apply();
    btn.dispatchEvent(new CustomEvent('visr:disclosure', { bubbles: true, detail: { open: open } }));
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-disclosure]'); if (b) setDisclosure(b, b.getAttribute('aria-expanded') !== 'true');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !e.target.closest) return;
    if (e.target.matches('[data-filter-input]') && e.target.value) return;     /* the search field clears first */
    var btn = e.target.closest('[data-disclosure][aria-expanded="true"]');
    for (var n = e.target; !btn && n && n !== document.body; n = n.parentElement) {
      if (n.id) btn = document.querySelector('[data-disclosure][aria-expanded="true"][aria-controls~="' + esc(n.id) + '"]');
    }
    if (btn) { setDisclosure(btn, false); btn.focus(); e.preventDefault(); }
  });

  /* ---- Table toggle for hand-built plot/table pairs (ui/table-toggle.html); chart cards use charts.js */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-table-toggle]'); if (!b) return;
    var on = b.getAttribute('aria-pressed') !== 'true';
    var t = document.getElementById(b.getAttribute('aria-controls')), p = document.getElementById(b.getAttribute('data-plot'));
    b.setAttribute('aria-pressed', String(on));
    if (t) t.hidden = !on; if (p) p.hidden = on;
    document.dispatchEvent(new CustomEvent('visr:tabletoggle', { detail: { button: b, table: t, plot: p, open: on } }));
  });

  /* ---- lists: one [data-list] scope = rows + optional tabs, chips, search, rule filter, count and "Show all" */
  var lists = new Map();
  function scopeFor(el) {
    var f = el.closest('[data-for]'), id = f && f.getAttribute('data-for');
    return id ? document.getElementById(id) : el.closest('[data-list]');
  }
  function listFor(el) { var s = scopeFor(el); return s ? lists.get(s) || null : null; }
  function List(el) {
    this.el = el;
    this.limit = parseInt(el.getAttribute('data-limit'), 10) || 0;
    this.url = el.hasAttribute('data-url');
    this.rows = all('[data-row]', el);
    this.input = el.querySelector('[data-filter-input]');
    this.rule = ''; this.ruleLabel = ''; this.expanded = false;
    var sel = this.tabs().filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || this.tabs()[0];
    this.tab = sel ? sel.getAttribute('data-tab') : '';
    this.defaultTab = this.tab;
  }
  List.prototype.linked = function (sel) {
    var mine = all(sel, this.el);
    return this.el.id ? mine.concat(all('[data-for="' + esc(this.el.id) + '"] ' + sel + ', ' + sel + '[data-for="' + esc(this.el.id) + '"]')
      .filter(function (x) { return mine.indexOf(x) === -1; })) : mine;
  };
  List.prototype.tabs = function () { return this.linked('[role="tab"][data-tab]'); };
  List.prototype.chips = function () { return this.linked('[data-chip]'); };
  List.prototype.has = function (r, tok) { return (' ' + (r.getAttribute('data-tags') || '') + ' ').indexOf(' ' + tok + ' ') !== -1; };
  List.prototype.inTab = function (r) { return !this.tab || this.tab === 'all' || this.has(r, this.tab); };
  List.prototype.query = function () { return this.input ? this.input.value.trim().toLowerCase() : ''; };
  List.prototype.pressed = function () {
    return this.chips().filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; })
      .map(function (c) { return c.getAttribute('data-chip'); });
  };
  List.prototype.apply = function () {
    var self = this, chips = this.pressed(), q = this.query();
    var active = !!(q || chips.length || this.rule), inTab = 0, matched = 0, groups = new Map();
    this.rows.forEach(function (r) {
      if (self.inTab(r)) inTab++;
      var ok = self.inTab(r) && (!self.rule || self.has(r, self.rule)) &&
        chips.every(function (c) { return self.has(r, c); }) &&
        (!q || (r.getAttribute('data-text') || r.textContent).toLowerCase().indexOf(q) !== -1);
      if (ok) matched++;
      var vis = ok && (self.expanded || !self.limit || matched <= self.limit);
      r.hidden = !vis;
      var g = r.closest('[data-group]');
      if (g) { var s = groups.get(g) || { m: 0, v: 0 }; if (ok) s.m++; if (vis) s.v++; groups.set(g, s); }
    });
    all('[data-group]', this.el).forEach(function (g) {
      var s = groups.get(g) || { m: 0, v: 0 }; g.hidden = s.v === 0;
      var c = g.querySelector('[data-group-count]'); if (c) c.textContent = nf(s.m);
    });
    /* cluster members follow their primary row and its disclosure */
    all('[data-child-of]', this.el).forEach(function (c) {
      var p = document.getElementById(c.getAttribute('data-child-of')), t = p && p.querySelector('[data-disclosure]');
      c.hidden = !p || p.hidden || !(t && t.getAttribute('aria-expanded') === 'true');
    });
    var cnt = this.el.querySelector('[data-filter-count]');
    if (cnt) {
      var noun = inTab === 1 ? (cnt.getAttribute('data-noun-one') || cnt.getAttribute('data-noun') || 'item') : (cnt.getAttribute('data-noun') || 'items');
      cnt.textContent = active ? 'Showing ' + nf(matched) + ' of ' + nf(inTab) + ' ' + noun : nf(inTab) + ' ' + noun;
    }
    all('[data-filter-empty]', this.el).forEach(function (x) { x.hidden = matched !== 0; });
    all('[data-filter-clear]', this.el).forEach(function (x) { x.hidden = !q; });
    var note = this.el.querySelector('[data-rule-note]');
    if (note) { note.hidden = !this.rule; var l = note.querySelector('[data-rule-label]'); if (l) l.textContent = this.ruleLabel; }
    this.linked('[data-more]').forEach(function (b) {
      var need = !!self.limit && matched > self.limit, wrap = b.closest('.v-card-foot') || b;
      wrap.hidden = !need;
      b.setAttribute('aria-expanded', String(self.expanded));
      b.textContent = self.expanded ? 'Show fewer' : 'Show all ' + nf(matched);
    });
    if (this.url) this.writeURL();
  };
  List.prototype.setTab = function (key) { this.tab = key; this.expanded = false; this.apply(); };
  List.prototype.writeURL = function () {
    try {
      var u = new URL(location.href), q = this.input ? this.input.value.trim() : '';
      if (this.tab && this.tab !== this.defaultTab) u.searchParams.set('tab', this.tab); else u.searchParams.delete('tab');
      if (q) u.searchParams.set('q', q); else u.searchParams.delete('q');
      var ch = this.pressed(); if (ch.length) u.searchParams.set('chip', ch.join(',')); else u.searchParams.delete('chip');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  };
  List.prototype.init = function () {
    var self = this;
    /* tab counts always come from the rendered rows (P6) */
    this.tabs().forEach(function (t) {
      var k = t.getAttribute('data-tab'), c = t.querySelector('[data-tab-count]'); if (!c) return;
      c.textContent = nf(self.rows.filter(function (r) { return !k || k === 'all' || self.has(r, k); }).length);
    });
    if (this.url) {
      var p = null; try { p = new URLSearchParams(location.search); } catch (e) {}
      if (p) {
        var t = p.get('tab'), tab = t && this.tabs().filter(function (x) { return x.getAttribute('data-tab') === t; })[0];
        if (tab) { markTab(tab); this.tab = t; }
        if (this.input && p.get('q')) this.input.value = p.get('q');
        /* ?chip=a,b presses those chips (deep links such as Overview "Author waiting on us" -> ?chip=waiting); one per group */
        var want = (p.get('chip') || '').split(',').filter(Boolean), seen = {};
        if (want.length) this.chips().forEach(function (c) {
          var tok = c.getAttribute('data-chip'), g = c.getAttribute('data-chip-group');
          if (want.indexOf(tok) === -1 || (g && seen[g])) return;
          if (g) seen[g] = true;
          c.setAttribute('aria-pressed', 'true');
        });
      }
    }
    this.el.classList.add('is-ready');
    this.apply();
  };

  /* search */
  document.addEventListener('input', function (e) {
    if (!e.target.matches || !e.target.matches('[data-filter-input]')) return;
    var L = listFor(e.target); if (L) { L.expanded = false; L.apply(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !e.target.matches || !e.target.matches('[data-filter-input]') || !e.target.value) return;
    e.target.value = ''; var L = listFor(e.target); if (L) L.apply(); e.preventDefault();
  });
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-filter-clear]'); if (!c) return;
    var L = listFor(c); if (!L || !L.input) return;
    L.input.value = ''; L.apply(); L.input.focus();
  });
  /* chips and filter tiles: button[data-chip][aria-pressed]; one data-chip-group is mutually exclusive */
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-chip]'); if (!c) return;
    var L = listFor(c); if (!L) return;
    var on = c.getAttribute('aria-pressed') !== 'true', g = c.getAttribute('data-chip-group');
    if (on && g) L.chips().forEach(function (o) { if (o !== c && o.getAttribute('data-chip-group') === g) o.setAttribute('aria-pressed', 'false'); });
    c.setAttribute('aria-pressed', String(on));
    L.expanded = false; L.apply();
  });
  /* "Show all N" / "Show fewer" */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-more]'); if (!b) return;
    var L = listFor(b); if (!L) return;
    L.expanded = !L.expanded; L.apply();
    if (!L.expanded) b.scrollIntoView({ block: 'nearest' });
  });
  /* rule filter: [data-show][data-for] switches the list to a tab and keeps only rows tagged data-show-tag (SLA "Show") */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-show]'); if (!b) return;
    var L = listFor(b); if (!L) return;
    L.rule = b.getAttribute('data-show-tag') || ''; L.ruleLabel = b.getAttribute('data-show-label') || '';
    var k = b.getAttribute('data-show-tab'), tab = k && L.tabs().filter(function (x) { return x.getAttribute('data-tab') === k; })[0];
    if (tab) { markTab(tab); L.tab = k; }
    L.expanded = true; L.apply();
    var note = L.el.querySelector('[data-rule-note]');
    L.el.scrollIntoView({ block: 'start' });
    if (note) { if (!note.hasAttribute('tabindex')) note.setAttribute('tabindex', '-1'); note.focus({ preventScroll: true }); }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rule-clear]'); if (!b) return;
    var L = listFor(b); if (!L) return;
    L.rule = ''; L.ruleLabel = ''; L.expanded = false; L.apply();
    var f = L.tabs().filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || L.input; if (f) f.focus();
  });

  /* ---- tabs (brief 4.6 l): list tabs carry data-tab and filter their [data-list]; panel tabs show their aria-controls panel */
  function markTab(tab) {
    var tl = tab.closest('[role="tablist"]');
    all('[role="tab"]', tl).forEach(function (t) {
      var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      if (!t.hasAttribute('data-tab')) { var p = document.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on; }
    });
    if (tab.hasAttribute('data-tab')) { var panel = document.getElementById(tab.getAttribute('aria-controls')); if (panel) panel.setAttribute('aria-labelledby', tab.id); }
    reveal(tl, tab);
  }
  function reveal(tl, tab) {   /* keep the selected tab in view in a scrolling tablist (no scrollIntoView) */
    if (tl.scrollWidth <= tl.clientWidth + 1) return;
    var l = tab.offsetLeft, r = l + tab.offsetWidth;
    if (l < tl.scrollLeft) tl.scrollLeft = Math.max(0, l - 8);
    else if (r > tl.scrollLeft + tl.clientWidth) tl.scrollLeft = r - tl.clientWidth + 8;
  }
  function selectTab(tab) {
    markTab(tab);
    if (tab.hasAttribute('data-tab')) { var L = listFor(tab); if (L) L.setTab(tab.getAttribute('data-tab')); }
    document.dispatchEvent(new CustomEvent('visr:tabchange', { detail: { tab: tab } }));
  }
  document.addEventListener('click', function (e) { var t = e.target.closest('[role="tablist"] [role="tab"]'); if (t) selectTab(t); });
  document.addEventListener('keydown', function (e) {
    var t = e.target.closest && e.target.closest('[role="tablist"] [role="tab"]'); if (!t) return;
    var tabs = all('[role="tab"]', t.closest('[role="tablist"]')), i = tabs.indexOf(t), n = null;
    if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') n = tabs[0];
    else if (e.key === 'End') n = tabs[tabs.length - 1];
    if (!n) return;
    e.preventDefault(); n.focus(); selectTab(n);
  });

  /* ---- sortable headers: th[data-sort] > button; rows sort by each cell's data-v (else its text) inside every tbody */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('th[data-sort] > button'); if (!btn) return;
    var th = btn.parentElement, table = th.closest('table'), idx = th.cellIndex, num = th.getAttribute('data-sort') !== 'text';
    var cur = th.getAttribute('aria-sort');
    var dir = cur ? (cur === 'descending' ? 'ascending' : 'descending') : (num ? 'descending' : 'ascending');
    all('th[aria-sort]', table).forEach(function (h) { h.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', dir);
    function val(r) {
      var c = r.cells[idx]; if (!c) return null;
      var v = c.hasAttribute('data-v') ? c.getAttribute('data-v') : c.textContent.trim();
      if (v === '') return null;
      if (num) { var f = parseFloat(v); return isNaN(f) ? null : f; }
      return v.toLowerCase();
    }
    Array.prototype.slice.call(table.tBodies).forEach(function (tb) {
      var rows = Array.prototype.slice.call(tb.rows).filter(function (r) { return r.hasAttribute('data-row'); });
      rows.sort(function (a, b) {
        var x = val(a), y = val(b);
        if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1;
        var c = x < y ? -1 : x > y ? 1 : 0; return dir === 'ascending' ? c : -c;
      }).forEach(function (r) {
        tb.appendChild(r);
        if (r.id) all('[data-child-of="' + esc(r.id) + '"]', tb).forEach(function (k) { tb.appendChild(k); });
      });
    });
    var L = lists.get(table.closest('[data-list]'));
    if (L) { L.rows = all('[data-row]', L.el); L.apply(); }
  });

  /* ---- phone list tables keep table semantics when CSS turns rows into grids (brief 4.6 f) */
  all('table.v-dt.is-list').forEach(function (t) {
    t.setAttribute('role', 'table');
    all('thead, tbody, tfoot', t).forEach(function (g) { g.setAttribute('role', 'rowgroup'); });
    Array.prototype.slice.call(t.rows).forEach(function (r) {
      r.setAttribute('role', 'row');
      Array.prototype.slice.call(r.cells).forEach(function (c) {
        if (c.hasAttribute('role')) return;
        c.setAttribute('role', c.tagName !== 'TH' ? 'cell' : (c.closest('thead') ? 'columnheader' : 'rowheader'));
      });
    });
  });

  /* ---- right-edge fade while a scroller has more content (.v-scroll, .v-tabs) */
  var ro = window.ResizeObserver ? new ResizeObserver(function (es) { es.forEach(function (x) { edge(x.target); }); }) : null;
  function edge(el) {   /* is-scrollable gates the sticky first column (no rule beside a table that fits); is-clipped the fade */
    el.classList.toggle('is-scrollable', el.scrollWidth > el.clientWidth + 1);
    el.classList.toggle('is-clipped', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }
  all('.v-scroll, .v-tabs').forEach(function (el) {
    edge(el); el.addEventListener('scroll', function () { edge(el); }, { passive: true }); if (ro) ro.observe(el);
  });

  /* ---- init lists, then bring any selected tab into view */
  all('[data-list]').forEach(function (el) { var L = new List(el); lists.set(el, L); L.init(); });
  all('[role="tablist"] [role="tab"][aria-selected="true"]').forEach(function (t) { reveal(t.closest('[role="tablist"]'), t); });
  window.VISR = Object.assign(window.VISR || {}, { list: function (el) { return lists.get(el) || null; } });
})();
