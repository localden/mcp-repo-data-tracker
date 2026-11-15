/* VISR ui.js (design system v4 4.10 to 4.16): legacy ?repo= redirects, row links, disclosures, tabs, and the list card:
   views, search, facets with live counts, sort, the list foot, URL state, drill-down, first-paint hand-over, label-tag folding,
   the Overdue cell swap under the SLA rule filter, and the forms below 64rem (view menu, Filters panel, result band, sort menu).
   Contracts: build/wp0-api.md. Every number goes through VISR.fmt (format.js). Never smooth-scrolls. */
(function () {
  'use strict';
  var root = document.documentElement, F = window.VISR && window.VISR.fmt;
  function all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function n0(n) { return F ? F.count(n).text : String(n); }
  function mq(q) { return window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener: function () {} }; }
  var wide = mq('(min-width: 64rem)'), phone = mq('(max-width: 39.99rem)');
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }

  /* ---- legacy ?repo=owner/repo links on /issues/, /pulls/, /health/, /contributors/ (the v4 facet is ?repo=<slug>, no slash) */
  (function () {
    var m = /\/(issues|pulls|health|contributors)\/?$/.exec(location.pathname); if (!m) return;
    var key = null; try { key = new URLSearchParams(location.search).get('repo'); } catch (e) { return; }
    if (!key || key.indexOf('/') < 1) return;
    var slug = key.split('/').pop();
    if (!/^[A-Za-z0-9._-]+$/.test(slug)) return;
    if (!document.querySelector('#nav-repos-list a[href$="/repos/' + esc(slug) + '/"]')) return;
    var kind = (m[1] === 'issues' || m[1] === 'pulls') ? m[1] : 'repos';
    location.replace(location.pathname.slice(0, m.index) + '/' + kind + '/' + slug + '/' + location.hash);
  })();

  /* ---- whole-row links: a click anywhere on tr[data-row-link] follows its a.v-row-link; a cell link keeps its own target */
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var tr = e.target.closest('tr[data-row-link]');
    if (!tr || e.target.closest('a,button,input,label,select,textarea')) return;
    if (window.getSelection && String(window.getSelection())) return;
    var a = tr.querySelector('a.v-row-link'); if (!a) return;
    if (e.metaKey || e.ctrlKey) window.open(a.href, '_blank', 'noopener'); else a.click();
  });
  /* a truncated row title gets its full text as title on hover (rows carry no title attribute: page weight) */
  document.addEventListener('mouseover', function (e) {
    var a = e.target.closest && e.target.closest('.v-item > .v-row-link, .v-detail-text'); if (!a || a.hasAttribute('title')) return;
    if (a.scrollWidth > a.clientWidth + 1) a.setAttribute('title', a.textContent.replace(/\s*\(opens [^)]*\)\s*$/, '').trim());
  });

  /* ---- disclosures: button[data-disclosure][aria-expanded][aria-controls] + panel[hidden]; Escape closes and returns focus */
  function setDisclosure(btn, open) {
    btn.setAttribute('aria-expanded', String(open));
    (btn.getAttribute('aria-controls') || '').split(/\s+/).forEach(function (id) { var p = id && document.getElementById(id); if (p) p.hidden = !open; });
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var b = e.target.closest('[data-disclosure]'); if (b) { setDisclosure(b, b.getAttribute('aria-expanded') !== 'true'); return; }
    /* the Filters button below 64rem: the panel's visibility follows aria-expanded in CSS, so the facets stay visible from 64rem */
    var f = e.target.closest('[data-facets-toggle]'); if (f) { f.setAttribute('aria-expanded', String(f.getAttribute('aria-expanded') !== 'true')); return; }
    /* the row expander of a duplicate cluster */
    var x = e.target.closest('[data-expander]');
    if (x) { x.setAttribute('aria-expanded', String(x.getAttribute('aria-expanded') !== 'true')); var L = listOf(x); if (L) L.apply(); else syncChildren(document); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !e.target.closest) return;
    if (e.target.matches('[data-filter-input]')) return;
    var btn = e.target.closest('[data-disclosure][aria-expanded="true"]');
    for (var n = e.target; !btn && n && n !== document.body; n = n.parentElement) {
      if (n.id) btn = document.querySelector('[data-disclosure][aria-expanded="true"][aria-controls~="' + esc(n.id) + '"]');
    }
    if (btn) { setDisclosure(btn, false); btn.focus(); e.preventDefault(); }
  });
  function syncChildren(scope) {   /* cluster members follow their primary row and its expander */
    all('tr[data-child-of]', scope).forEach(function (c) {
      var id = c.getAttribute('data-child-of'), p = document.getElementById(id);
      var x = p && p.querySelector('[data-expander]'), open = !!(p && !p.hidden && x && x.getAttribute('aria-expanded') === 'true');
      if (open) c.setAttribute('data-open', ''); else c.removeAttribute('data-open');
      c.hidden = !open;
    });
  }

  /* ---- cells take their column's record label for the forms below 64rem (th[data-record], else the header text) */
  function headText(th) {
    var c = th.cloneNode(true); all('.sr-only, .v-th-sub, .v-th-short, svg', c).forEach(function (x) { x.remove(); }); return c.textContent.trim();
  }
  all('table.v-dt').forEach(function (t) {
    var heads = all('thead tr:last-child > th', t); if (!heads.length) return;
    var labels = heads.map(function (th) { return th.getAttribute('data-record') || headText(th); });
    var listForm = t.classList.contains('is-list');
    all('tbody > tr', t).forEach(function (r) {
      if (r.classList.contains('v-group')) return;
      Array.prototype.forEach.call(r.cells, function (c, i) {
        if (i === 0 || c.hasAttribute('data-label') || !labels[i]) return;
        if (listForm && c.matches('.v-item, .v-c-status, .v-sla-cell, .v-c-detail, .v-c-repo, .v-c-bar, .v-c-spark')) return;
        c.setAttribute('data-label', labels[i]);
      });
    });
  });
  /* list-form tables keep table semantics when CSS turns rows into grids */
  all('table.v-dt.is-list, table.v-dt.is-matrix').forEach(function (t) {
    t.setAttribute('role', 'table');
    all('thead, tbody, tfoot', t).forEach(function (g) { g.setAttribute('role', 'rowgroup'); });
    Array.prototype.forEach.call(t.rows, function (r) {
      r.setAttribute('role', 'row');
      Array.prototype.forEach.call(r.cells, function (c) {
        if (!c.hasAttribute('role')) c.setAttribute('role', c.tagName !== 'TH' ? 'cell' : (c.closest('thead') ? 'columnheader' : 'rowheader'));
      });
    });
  });

  /* ---- lists: one article[data-list] = rows + optional views, search, facets, sort, foot */
  var lists = new Map(), owner = null;
  function listOf(node) { var s = node && node.closest ? node.closest('[data-list]') : null; return s ? lists.get(s) || null : null; }
  function tokens(s) { return (s || '').split(/\s+/).filter(Boolean); }

  function List(node) {
    var self = this;
    this.el = node;
    this.table = node.querySelector('table.v-dt');
    this.limit = parseInt(node.getAttribute('data-limit'), 10) || 0;
    this.limitPhone = parseInt(node.getAttribute('data-limit-phone'), 10) || this.limit;
    this.step = parseInt(node.getAttribute('data-step'), 10) || 50;
    this.input = node.querySelector('[data-filter-input]');
    this.tabs = all('[role="tab"][data-view]', node);
    this.checks = all('button.v-chip[data-facet]', node);
    this.selects = all('.v-menu-wrap[data-facet]', node);
    this.viewMenu = node.querySelector('[data-view-menu]');
    this.sortMenu = node.querySelector('[data-sort-menu]');
    this.sel = {};   /* select facet key -> array of chosen values */
    this.selects.forEach(function (w) { self.sel[w.getAttribute('data-facet')] = []; });
    var on = this.tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || this.tabs[0];
    this.view = on ? on.getAttribute('data-view') : '';
    this.defaultView = this.view;
    var th = this.table && this.table.querySelector('th[data-sort][aria-sort]');
    this.defaultSort = th ? { key: th.getAttribute('data-sort'), dir: th.getAttribute('aria-sort') === 'ascending' ? 'asc' : 'desc' } : null;
    this.sort = this.defaultSort;
    this.more = 0;        /* rows revealed past the first step; Infinity = all */
    this.readRows();
  }
  List.prototype.readRows = function () {
    this.rows = all('tr[data-row]', this.el).filter(function (r) { return !r.hasAttribute('data-child-of'); });
    this.rows.forEach(function (r) {
      if (r._v) return;
      r._v = tokens(r.getAttribute('data-views')); r._f = tokens(r.getAttribute('data-facets')); r._t = null;
    });
  };
  List.prototype.first = function () { var l = phone.matches ? this.limitPhone : this.limit; return l > 0 ? l : Infinity; };
  List.prototype.text = function (r) {   /* the search index: the item cell (title, id, author, labels) and the repository cell */
    if (r._t === null) {
      var s = ''; all('.v-item, .v-c-repo, .v-name', r).forEach(function (c) { s += ' ' + c.textContent; });
      all('.v-tag[title]', r).forEach(function (t) { s += ' ' + t.getAttribute('title'); });
      r._t = (s || r.textContent).toLowerCase();
    }
    return r._t;
  };
  List.prototype.inView = function (r) { return !this.tabs.length || !this.view || this.view === 'all' || r._v.indexOf(this.view) !== -1; };
  List.prototype.pressed = function () {
    return this.checks.filter(function (c) { return c.getAttribute('aria-pressed') === 'true'; }).map(function (c) { return c.getAttribute('data-facet'); });
  };
  List.prototype.narrowed = function () {
    var self = this;
    return !!(this.query().length || this.pressed().length || Object.keys(this.sel).some(function (k) { return self.sel[k].length; }));
  };
  List.prototype.query = function () { return this.input ? this.input.value.trim().toLowerCase().split(/\s+/).filter(Boolean) : []; };
  List.prototype.viewLabel = function () {
    var self = this, t = this.tabs.filter(function (x) { return x.getAttribute('data-view') === self.view; })[0];
    if (!t) return '';
    var c = t.cloneNode(true); all('.v-count', c).forEach(function (x) { x.remove(); }); return c.textContent.trim();
  };

  List.prototype.apply = function () {
    var self = this, q = this.query(), pressed = this.pressed(), selKeys = Object.keys(this.sel);
    var facets = pressed.map(function (k) { return { key: k, test: function (r) { return r._f.indexOf(k) !== -1; } }; });
    selKeys.forEach(function (k) {
      var vals = self.sel[k]; if (!vals.length) return;
      facets.push({ key: k, test: function (r) { return vals.some(function (v) { return r._f.indexOf(k + ':' + v) !== -1; }); } });
    });
    var first = this.first(), limit = this.more === Infinity ? Infinity : first + this.more;
    var matched = 0, shown = 0, inAll = 0, last = null, groups = new Map(), firsts = [];
    var chipN = {}, optN = {};
    this.checks.forEach(function (c) { chipN[c.getAttribute('data-facet')] = 0; });
    this.rows.forEach(function (r) {
      var hit = !q.length || (function () { var t = self.text(r); return q.every(function (w) { return t.indexOf(w) !== -1; }); })();
      var fails = 0, failKey = null;
      if (hit) facets.forEach(function (f) { if (!f.test(r)) { fails++; failKey = f.key; } });
      if (hit && !fails) inAll++;
      var inView = self.inView(r), ok = inView && hit && !fails;
      /* live counts: rows that would match with the current view, search and the OTHER filters applied */
      if (inView && hit && fails <= 1) {
        self.checks.forEach(function (c) {
          var k = c.getAttribute('data-facet');
          if ((fails === 0 || failKey === k) && r._f.indexOf(k) !== -1) chipN[k]++;
        });
        selKeys.forEach(function (k) {
          if (fails === 1 && failKey !== k) return;
          r._f.forEach(function (tok) { if (tok.indexOf(k + ':') === 0) optN[tok] = (optN[tok] || 0) + 1; });
        });
      }
      if (ok) matched++;
      var vis = ok && matched <= limit;
      if (vis) { shown++; last = r; if (firsts.indexOf(r.parentNode) === -1) { firsts.push(r.parentNode); firsts.push(r); } }
      r.hidden = !vis;
      r.removeAttribute('data-off'); r.removeAttribute('data-over'); r.removeAttribute('data-over-phone'); r.removeAttribute('data-last'); r.removeAttribute('data-first');
      var g = r.closest('tbody[data-group]');
      if (g) { var s = groups.get(g) || { m: 0, v: 0 }; if (ok) s.m++; if (vis) s.v++; groups.set(g, s); }
    });
    if (last) last.setAttribute('data-last', '');
    /* the first visible row of each tbody: in list form it drops its top rule, so a band or group row above it has one rule */
    firsts.forEach(function (x) { if (x.tagName === 'TR') x.setAttribute('data-first', ''); });
    this._matched = matched; this._shown = shown;
    all('tbody[data-group]', this.el).forEach(function (g) {
      var s = groups.get(g) || { m: 0, v: 0 }; g.hidden = s.v === 0;
      var c = g.querySelector('[data-group-count]'); if (c) c.textContent = n0(s.m);
    });
    syncChildren(this.el);

    /* chips and options: live counts; zero disables while not pressed or checked */
    this.checks.forEach(function (c) {
      var k = c.getAttribute('data-facet'), on = c.getAttribute('aria-pressed') === 'true', n = chipN[k] || 0;
      var b = c.querySelector('[data-facet-count]'); if (b) b.textContent = n0(n);
      c.disabled = !on && n === 0;
    });
    this.selects.forEach(function (w) {
      var k = w.getAttribute('data-facet');
      all('.v-menu-opt[data-value]', w).forEach(function (o) {
        var n = optN[k + ':' + o.getAttribute('data-value')] || 0, on = o.getAttribute('aria-checked') === 'true';
        var b = o.querySelector('[data-opt-count]'); if (b) b.textContent = n0(n);
        if (!on && n === 0) o.setAttribute('aria-disabled', 'true'); else o.removeAttribute('aria-disabled');
      });
    });

    /* result count: "288 PRs" at rest, "249 of 288 PRs" when narrowed */
    var narrowed = this.narrowed(), inViewN = this.rows.filter(function (r) { return self.inView(r); }).length;
    all('[data-filter-count]', this.el).forEach(function (p) {
      var one = p.getAttribute('data-noun-one') || self.el.getAttribute('data-noun-one') || 'item';
      var other = p.getAttribute('data-noun') || self.el.getAttribute('data-noun') || 'items';
      p.textContent = '';
      if (narrowed) { p.appendChild(el('span', 'v-filter-n', n0(matched))); p.appendChild(document.createTextNode(' of ')); }
      p.appendChild(el('span', 'v-filter-n', n0(inViewN)));
      p.appendChild(document.createTextNode(' ' + (inViewN === 1 ? one : other)));
    });
    var active = pressed.length + selKeys.filter(function (k) { return self.sel[k].length; }).length;
    all('[data-facets-n]', this.el).forEach(function (b) { b.textContent = n0(active); b.hidden = active === 0; });
    all('[data-filter-reset]', this.el).forEach(function (b) { if (!b.closest('[data-filter-empty]')) b.hidden = !narrowed; });
    all('[data-filter-clear]', this.el).forEach(function (b) { b.hidden = !q.length; });

    /* empty result, in place of the rows */
    var empty = this.el.querySelector('[data-filter-empty]');
    if (empty) {
      empty.hidden = matched !== 0;
      if (this.table) this.table.hidden = matched === 0;
      var body = empty.querySelector('[data-empty-body]'), vl = this.viewLabel();
      if (body) body.textContent = vl && this.view !== 'all' ? 'Nothing in ' + vl + ' matches the search and filters.' : 'Nothing matches the search and filters.';
      var sa = empty.querySelector('[data-search-all]');
      if (sa) {
        var can = this.tabs.length && this.view !== 'all' && inAll > 0 && this.tabs.some(function (t) { return t.getAttribute('data-view') === 'all'; });
        sa.hidden = !can;
        if (can) sa.textContent = 'Search all ' + n0(this.rows.length) + ' ' + (this.el.getAttribute('data-noun') || 'items');
      }
    }

    /* list foot: "Showing 25 of 249", one step of 50 at every width */
    var foot = this.el.querySelector('[data-list-foot]');
    if (foot) {
      var rest = matched - shown, expanded = shown > first;
      foot.hidden = matched === 0 || (rest <= 0 && !expanded);
      var range = foot.querySelector('[data-list-range]');
      if (range) {
        range.textContent = 'Showing ';
        range.appendChild(el('span', 'v-list-n', n0(shown))); range.appendChild(document.createTextNode(' of ')); range.appendChild(el('span', 'v-list-n', n0(matched)));
      }
      var moreB = foot.querySelector('[data-more]'), colB = foot.querySelector('[data-collapse]');
      if (moreB) {
        moreB.hidden = rest <= 0;
        moreB.setAttribute('aria-expanded', String(expanded));
        moreB.textContent = matched <= 100 ? 'Show all ' + n0(matched) : rest > this.step ? 'Show ' + n0(this.step) + ' more' : 'Show remaining ' + n0(rest);
      }
      if (colB) colB.hidden = !expanded;
    }
    this.syncSortLabel();
    this.swapRules();
    if (wide.matches) this.fold();
    if (owner === this) this.writeURL(false);
  };

  /* ---- views */
  List.prototype.setView = function (key, quiet) {
    var self = this;
    if (!this.tabs.some(function (t) { return t.getAttribute('data-view') === key; })) return false;
    this.view = key; this.more = 0;
    this.tabs.forEach(function (t) {
      var on = t.getAttribute('data-view') === key; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      if (on) { var p = document.getElementById(t.getAttribute('aria-controls')); if (p) p.setAttribute('aria-labelledby', t.id); }
    });
    if (this.viewMenu) {
      all('.v-menu-opt[data-value]', this.viewMenu).forEach(function (o) { o.setAttribute('aria-checked', String(o.getAttribute('data-value') === key)); });
      var tab = this.tabs.filter(function (t) { return t.getAttribute('data-view') === key; })[0], c = tab && tab.querySelector('.v-count');
      var lab = this.viewMenu.querySelector('[data-view-label]'), cnt = this.viewMenu.querySelector('[data-view-n]');
      if (lab) lab.textContent = this.viewLabel();
      if (cnt) { cnt.textContent = c ? c.textContent : ''; cnt.hidden = !c; }
    }
    this.syncSla();
    if (!quiet) this.apply();
    return true;
  };
  /* ---- a view in which nothing can be overdue has no Overdue column (4.14 rule 8, per view): the table takes data-no-sla, CSS
     drops the column, and while it is gone the rows sort by the primary time instead; the stored sort and the URL do not change */
  List.prototype.syncSla = function () {
    var t = this.table, self = this; if (!t) return;
    if (this._slaTh === undefined) {
      var cell = t.querySelector('tbody td.v-sla-cell'), head = cell && t.querySelector('thead tr:last-child');
      this._slaTh = (head && head.cells[cell.cellIndex]) || null;
      if (this._slaTh) {
        this._slaTh.setAttribute('data-sla-col', '');
        var col = all('colgroup > col', t)[cell.cellIndex]; if (col) col.setAttribute('data-sla-col', '');
      }
    }
    if (!this._slaTh) return;
    var off = !this.rows.some(function (r) { return self.inView(r) && r.querySelector('td.v-sla-cell > *'); });
    if (off === t.hasAttribute('data-no-sla')) return;
    if (off) t.setAttribute('data-no-sla', ''); else t.removeAttribute('data-no-sla');
    var heads = all('th[data-sort]', t).filter(function (h) { return h !== self._slaTh; }), fallback = heads[heads.length - 1];
    if (off && this._slaTh.hasAttribute('aria-sort') && fallback) { sortTable(t, fallback, 'descending'); this._slaSwap = true; this.readRows(); }
    else if (!off && this._slaSwap) {
      this._slaSwap = false;
      var th = this.sort && t.querySelector('th[data-sort="' + esc(this.sort.key) + '"]');
      if (th) { sortTable(t, th, this.sort.dir === 'asc' ? 'ascending' : 'descending'); this.readRows(); }
    }
  };

  /* ---- sort: rows sort inside each tbody by the cell's data-v (else its text); cluster members follow their primary row */
  List.prototype.sortBy = function (key, dir, quiet) {
    var t = this.table, th = t && t.querySelector('th[data-sort="' + esc(key) + '"]'); if (!th) return false;
    sortTable(t, th, dir === 'asc' ? 'ascending' : 'descending');
    this.sort = { key: key, dir: dir }; this.more = 0;
    this.readRows();
    if (!quiet) this.apply();
    return true;
  };
  function sortTable(table, th, dir) {
    var idx = th.cellIndex, num = th.getAttribute('data-sort-type') !== 'text';
    all('th[aria-sort]', table).forEach(function (h) { h.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', dir);
    function val(r) {
      var c = r.cells[idx]; if (!c) return null;
      var v = c.hasAttribute('data-v') ? c.getAttribute('data-v') : c.textContent.trim();
      if (v === '') return null;
      if (num) { var f = parseFloat(v); return isNaN(f) ? null : f; }
      return v.toLowerCase();
    }
    Array.prototype.forEach.call(table.tBodies, function (tb) {
      var rows = Array.prototype.filter.call(tb.rows, function (r) { return !r.classList.contains('v-group') && !r.hasAttribute('data-child-of'); });
      rows.map(function (r, i) { return { r: r, i: i, v: val(r) }; }).sort(function (a, b) {
        if (a.v === null && b.v === null) return a.i - b.i; if (a.v === null) return 1; if (b.v === null) return -1;
        var c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0; return c === 0 ? a.i - b.i : (dir === 'ascending' ? c : -c);
      }).forEach(function (x) {
        tb.appendChild(x.r);
        if (x.r.id) all('tr[data-child-of="' + esc(x.r.id) + '"]', tb).forEach(function (k) { tb.appendChild(k); });
      });
    });
  }
  function firstDir(th) { return th.getAttribute('data-sort-type') === 'num' || !th.getAttribute('data-sort-type') ? 'desc' : 'asc'; }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('th[data-sort] > .v-th-btn'); if (!btn) return;
    var th = btn.parentElement, cur = th.getAttribute('aria-sort');
    var dir = cur ? (cur === 'descending' ? 'asc' : 'desc') : firstDir(th);
    var L = listOf(th);
    if (L && L.table === th.closest('table')) L.sortBy(th.getAttribute('data-sort'), dir);
    else sortTable(th.closest('table'), th, dir === 'asc' ? 'ascending' : 'descending');
  });
  List.prototype.buildSortMenu = function () {
    var m = this.sortMenu, ul = m && m.querySelector('.v-menu'); if (!ul || !this.table) return;
    var heads = all('th[data-sort]', this.table);
    if (!heads.length) { m.hidden = true; return; }
    heads.forEach(function (th) {
      var label = headText(th), text = th.getAttribute('data-sort-type') === 'text';
      [['desc', th.getAttribute('data-desc') || (label + (text ? ', Z to A' : ', highest first'))],
       ['asc', th.getAttribute('data-asc') || (label + (text ? ', A to Z' : ', lowest first'))]].forEach(function (o) {
        var li = el('li'); li.setAttribute('role', 'none');
        var b = el('button', 'v-menu-opt'); b.type = 'button'; b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', 'false');
        b.setAttribute('data-value', th.getAttribute('data-sort') + ':' + o[0]);
        var mark = el('span', 'v-menu-mark'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        svg.setAttribute('class', 'v-icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); p.setAttribute('d', 'M20 6 9 17l-5-5');
        svg.appendChild(p); mark.appendChild(svg); b.appendChild(mark); b.appendChild(el('span', 'v-menu-text', o[1]));
        li.appendChild(b); ul.appendChild(li);
      });
    });
  };
  List.prototype.syncSortLabel = function () {
    if (!this.sortMenu || !this.table) return;
    var th = this.table.querySelector('th[data-sort][aria-sort]'), lab = this.sortMenu.querySelector('[data-sort-label]');
    if (lab) lab.textContent = th ? headText(th) : 'Sort';
    var cur = th ? th.getAttribute('data-sort') + ':' + (th.getAttribute('aria-sort') === 'ascending' ? 'asc' : 'desc') : '';
    all('.v-menu-opt[data-value]', this.sortMenu).forEach(function (o) { o.setAttribute('aria-checked', String(o.getAttribute('data-value') === cur)); });
  };

  /* ---- the Overdue cell names the chosen rule while the SLA rule filter is active (data-rules="p1:514,follow-up:12") */
  List.prototype.swapRules = function () {
    var vals = this.sel.rule; if (!vals) return;
    var names = {};
    this.selects.forEach(function (w) {
      if (w.getAttribute('data-facet') !== 'rule') return;
      all('.v-menu-opt[data-value]', w).forEach(function (o) { var t = o.querySelector('.v-menu-text'); names[o.getAttribute('data-value')] = t ? t.textContent : o.getAttribute('data-value'); });
    });
    all('td.v-sla-cell[data-rules]', this.el).forEach(function (td) {
      var rule = td.querySelector('.v-sla-rule'), valEl = td.querySelector('.v-over .v-val'), more = td.querySelector('.v-tag.is-more');
      if (!rule) return;
      if (!td.hasAttribute('data-rule0')) { td.setAttribute('data-rule0', rule.textContent); td.setAttribute('data-days0', valEl && valEl.firstChild ? valEl.firstChild.nodeValue : ''); }
      var pick = null;
      if (vals.length) td.getAttribute('data-rules').split(',').forEach(function (pair) {
        var kv = pair.split(':'), d = parseFloat(kv[1]);
        if (vals.indexOf(kv[0]) !== -1 && (pick === null || (d || 0) > (pick.d || 0))) pick = { key: kv[0], d: isNaN(d) ? null : d };
      });
      rule.textContent = pick ? (names[pick.key] || pick.key) : td.getAttribute('data-rule0');
      if (valEl && valEl.firstChild && valEl.firstChild.nodeType === 3) valEl.firstChild.nodeValue = pick && pick.d !== null ? n0(pick.d) : td.getAttribute('data-days0');
      if (more) more.hidden = !!pick;
    });
  };

  /* ---- label tags that do not fit the meta line fold into the +N tag (from 64rem; below, the tag line wraps) */
  List.prototype.fold = function () {
    this.rows.forEach(function (r) {
      if (r.hidden || r._folded) return;
      var box = r.querySelector('.v-tags'); if (!box) { r._folded = true; return; }
      if (box.clientWidth === 0) return;
      var labels = all('.v-tag.is-label', box), more = box.querySelector('.v-tag.is-more');
      if (!box._more0) box._more0 = more ? { text: more.textContent, title: more.getAttribute('title') || '' } : { text: '', title: '' };
      var n = parseInt(box._more0.text.replace(/\D/g, ''), 10) || 0, names = box._more0.title ? [box._more0.title] : [];
      while (box.scrollWidth > box.clientWidth + 1 && labels.length) {
        var t = labels.pop(); names.unshift(t.textContent.trim()); t.hidden = true; t.setAttribute('data-folded', ''); n++;
        if (!more) { more = el('span', 'v-tag is-more'); more.setAttribute('data-made', ''); box.appendChild(more); }
        more.textContent = '+' + n; more.setAttribute('title', names.join(', '));
      }
      r._folded = true;
    });
  };
  List.prototype.unfold = function () {   /* back to the server-rendered tags, before a new layout is measured */
    this.rows.forEach(function (r) {
      r._folded = false;
      var box = r.querySelector('.v-tags'); if (!box || !box._more0) return;
      all('.v-tag[data-folded]', box).forEach(function (t) { t.hidden = false; t.removeAttribute('data-folded'); });
      var more = box.querySelector('.v-tag.is-more'); if (!more) return;
      if (more.hasAttribute('data-made')) more.remove();
      else { more.textContent = box._more0.text; more.setAttribute('title', box._more0.title); }
    });
  };

  /* ---- URL state (4.15): the first [data-list][data-url] owns the query string */
  List.prototype.writeURL = function (push) {
    var self = this, p = new URLSearchParams(), q = this.input ? this.input.value.trim() : '';
    if (this.view && this.view !== this.defaultView) p.set('view', this.view);
    if (q) p.set('q', q);
    this.pressed().forEach(function (k) { p.set(k, '1'); });
    Object.keys(this.sel).forEach(function (k) { if (self.sel[k].length) p.set(k, self.sel[k].join(',')); });
    if (this.sort && (!this.defaultSort || this.sort.key !== this.defaultSort.key || this.sort.dir !== this.defaultSort.dir)) { p.set('sort', this.sort.key); p.set('dir', this.sort.dir); }
    var s = p.toString().replace(/%2C/g, ','), url = location.pathname + (s ? '?' + s : '') + location.hash;
    try { if (push) history.pushState(null, '', url); else if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', url); } catch (e) {}
  };
  List.prototype.readState = function (params) {   /* resets every control, then applies the parameters; legacy ?tab= and ?chip= are read */
    var self = this;
    if (this.input) this.input.value = params.get('q') || '';
    var legacy = (params.get('chip') || '').split(',').filter(Boolean);
    this.checks.forEach(function (c) {
      var k = c.getAttribute('data-facet'); c.setAttribute('aria-pressed', String(params.get(k) === '1' || legacy.indexOf(k) !== -1));
    });
    this.selects.forEach(function (w) {
      var k = w.getAttribute('data-facet'), want = (params.get(k) || '').split(',').filter(Boolean), have = [];
      all('.v-menu-opt[data-value]', w).forEach(function (o) {
        var on = want.indexOf(o.getAttribute('data-value')) !== -1; o.setAttribute('aria-checked', String(on)); if (on) have.push(o.getAttribute('data-value'));
      });
      self.sel[k] = have; self.syncSelect(w);
    });
    var v = params.get('view') || params.get('tab') || this.defaultView;
    if (!this.setView(v, true)) this.setView(this.defaultView, true);
    var sk = params.get('sort'), sd = params.get('dir') === 'asc' ? 'asc' : 'desc';
    if (sk) this.sortBy(sk, sd, true);
    else if (this.defaultSort && this.sort && (this.sort.key !== this.defaultSort.key || this.sort.dir !== this.defaultSort.dir)) this.sortBy(this.defaultSort.key, this.defaultSort.dir, true);
    this.more = 0;
  };
  List.prototype.syncSelect = function (w) {   /* the chip shows the chosen value in accent-text, or "2 selected" */
    var k = w.getAttribute('data-facet'), vals = this.sel[k] || [], chip = w.querySelector('.v-chip'), out = w.querySelector('[data-facet-value]');
    if (!chip) return;
    var text = '';
    if (vals.length === 1) { var o = w.querySelector('.v-menu-opt[data-value="' + esc(vals[0]) + '"] .v-menu-text'); text = o ? o.textContent : vals[0]; }
    else if (vals.length > 1) text = n0(vals.length) + ' selected';
    if (out) { out.textContent = text; out.hidden = !text; }
    if (text) chip.setAttribute('data-active', ''); else chip.removeAttribute('data-active');
  };
  List.prototype.reveal = function (row) {   /* a :target row: switch view when needed and step far enough to show it */
    if (!row || this.rows.indexOf(row) === -1) return;
    if (!this.inView(row)) this.setView(row._v[0] && this.tabs.some(function (t) { return t.getAttribute('data-view') === row._v[0]; }) ? row._v[0] : 'all', true);
    this.more = Infinity; this.apply();
    if (row.hidden) { this.readState(new URLSearchParams()); this.more = Infinity; this.apply(); }
    row.scrollIntoView({ block: 'center' });
  };
  List.prototype.init = function () {
    this.buildSortMenu();
    if (owner === this) { var p = null; try { p = new URLSearchParams(location.search); } catch (e) {} if (p) this.readState(p); }
    this.syncSla();
    this.apply();
    this.el.setAttribute('data-ready', '');
  };

  /* ---- list events */
  document.addEventListener('input', function (e) {
    if (!e.target.matches || !e.target.matches('[data-filter-input]')) return;
    var L = listOf(e.target); if (L) { L.more = 0; L.apply(); }
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !(t.matches && t.matches('input, textarea, select, [contenteditable]'))) {
      var inp = document.querySelector('[data-list] [data-filter-input]'); if (inp) { inp.focus(); inp.select(); e.preventDefault(); }
      return;
    }
    if (!t.matches || !t.matches('[data-filter-input]')) return;
    var L = listOf(t);
    if (e.key === 'Escape') { if (t.value) { t.value = ''; if (L) { L.more = 0; L.apply(); } } else t.blur(); e.preventDefault(); }
    else if (e.key === 'ArrowDown' && L) {
      var r = L.rows.filter(function (x) { return !x.hidden; })[0], a = r && r.querySelector('a.v-row-link'); if (a) { a.focus(); e.preventDefault(); }
    }
  });
  function reset(L) {   /* "Clear filters": clears the search and every facet, keeps the view and the sort, returns focus to search */
    var p = new URLSearchParams();
    if (L.view !== L.defaultView) p.set('view', L.view);
    if (L.sort) { p.set('sort', L.sort.key); p.set('dir', L.sort.dir); }
    L.readState(p); L.apply();
    if (L.input) L.input.focus();
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var t = e.target, L = listOf(t); if (!L) return;
    var c;
    if ((c = t.closest('[data-filter-clear]'))) { if (L.input) { L.input.value = ''; L.more = 0; L.apply(); L.input.focus(); } return; }
    if ((c = t.closest('button.v-chip[data-facet]'))) { c.setAttribute('aria-pressed', String(c.getAttribute('aria-pressed') !== 'true')); L.more = 0; L.apply(); return; }
    if ((c = t.closest('[data-filter-reset]'))) { reset(L); return; }
    if ((c = t.closest('[data-search-all]'))) { L.checks.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); L.selects.forEach(function (w) { all('.v-menu-opt', w).forEach(function (o) { o.setAttribute('aria-checked', 'false'); }); L.sel[w.getAttribute('data-facet')] = []; L.syncSelect(w); }); L.setView('all'); return; }
    if ((c = t.closest('[data-more]'))) {
      var rest = (L._matched || 0) - (L._shown || 0);
      L.more = ((L._matched || 0) <= 100 || rest <= L.step) ? Infinity : L.more + L.step;
      freeze(L.el, true); L.apply(); return;
    }
    if ((c = t.closest('[data-collapse]'))) { L.more = 0; freeze(L.el, false); L.apply(); L.el.scrollIntoView({ block: 'start' }); return; }
  });
  /* a pair's sibling keeps its resting height while this card is expanded (4.4) */
  function freeze(card, on) {
    var grid = card.parentElement; if (!grid || !grid.classList.contains('v-grid')) return;
    Array.prototype.forEach.call(grid.children, function (s) {
      if (s === card || !s.classList.contains('v-card')) return;
      if (on) { if (s.offsetTop !== card.offsetTop || s.classList.contains('is-rest')) return; s.style.setProperty('--rest-h', s.offsetHeight + 'px'); s.classList.add('is-rest'); }
      else { s.classList.remove('is-rest'); s.style.removeProperty('--rest-h'); }
    });
  }
  /* select facets, the view menu and the sort menu (menu.js dispatches visr:menuchange) */
  document.addEventListener('visr:menuchange', function (e) {
    var d = e.detail || {}, L = listOf(e.target); if (!L || !d.item) return;
    var w = d.item.closest('[data-facet], [data-view-menu], [data-sort-menu]'); if (!w) return;
    if (w.hasAttribute('data-view-menu')) { L.setView(d.value); return; }
    if (w.hasAttribute('data-sort-menu')) { var kv = String(d.value).split(':'); L.sortBy(kv[0], kv[1] === 'asc' ? 'asc' : 'desc'); return; }
    var k = w.getAttribute('data-facet');
    L.sel[k] = all('.v-menu-opt[aria-checked="true"]', w).map(function (o) { return o.getAttribute('data-value'); });
    L.syncSelect(w); L.more = 0; L.apply();
  });

  /* ---- tabs: view tabs carry data-view and switch their list's view; segments show their own panel */
  function selectTab(tab) {
    if (tab.getAttribute('aria-disabled') === 'true') return;
    if (tab.hasAttribute('data-view')) { var L = listOf(tab); if (L) L.setView(tab.getAttribute('data-view')); }
    else {
      all('[role="tab"]', tab.closest('[role="tablist"]')).forEach(function (t) {
        var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
        var p = document.getElementById(t.getAttribute('aria-controls')); if (p) p.hidden = !on;
      });
    }
    document.dispatchEvent(new CustomEvent('visr:tabchange', { detail: { tab: tab, panel: document.getElementById(tab.getAttribute('aria-controls')) } }));
  }
  document.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[role="tablist"] [role="tab"]'); if (t) selectTab(t); });
  document.addEventListener('keydown', function (e) {
    var t = e.target.closest && e.target.closest('[role="tablist"] [role="tab"]'); if (!t) return;
    var tabs = all('[role="tab"]', t.closest('[role="tablist"]')).filter(function (x) { return x.getAttribute('aria-disabled') !== 'true'; }), i = tabs.indexOf(t), n = null;
    if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') n = tabs[0];
    else if (e.key === 'End') n = tabs[tabs.length - 1];
    if (!n) return;
    e.preventDefault(); n.focus(); selectTab(n);
  });

  /* ---- drill-down (4.15): a[data-drill] to the list on this page applies the state in place, with one history entry */
  function samePage(u) { return u.origin === location.origin && u.pathname.replace(/\/?$/, '/') === location.pathname.replace(/\/?$/, '/'); }
  function land(hash, focus) {
    var target = null; try { target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null; } catch (e) {}
    var node = target || (owner && owner.el);
    if (target && owner && target.matches('tr[data-row]')) { owner.reveal(target); return; }
    if (node) node.scrollIntoView({ block: 'start' });
    if (focus && owner) {
      var f = owner.el.querySelector('button.v-chip[aria-pressed="true"], .v-chip[data-active]') ||
        (wide.matches ? owner.el.querySelector('[role="tab"][aria-selected="true"]') : owner.el.querySelector('[data-view-menu] .v-btn')) || owner.input;
      if (f) f.focus({ preventScroll: true });
    }
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-drill]'); if (!a || !owner || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    var u; try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (!samePage(u)) return;
    e.preventDefault();
    owner.readState(u.searchParams);
    try { history.pushState(null, '', u.pathname + u.search + u.hash); } catch (err) {}
    owner.apply();
    land(u.hash, true);
  });
  window.addEventListener('popstate', function () {
    if (!owner) return;
    var p; try { p = new URLSearchParams(location.search); } catch (e) { return; }
    owner.readState(p); owner.apply(); if (location.hash) land(location.hash, false);
  });

  /* ---- init lists; the first one with data-url owns the query string; reveal a :target row */
  all('[data-list]').forEach(function (node) { var L = new List(node); lists.set(node, L); if (!owner && node.hasAttribute('data-url')) owner = L; });
  lists.forEach(function (L) { L.init(); });
  syncChildren(document);
  if (location.hash) {
    var hit = null; try { hit = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
    if (hit && hit.matches('tr[data-row]')) { var HL = listOf(hit); if (HL) HL.reveal(hit); }
    else if (hit && hit.closest('[data-list]')) hit.scrollIntoView({ block: 'start' });
  }
  function relayout() { lists.forEach(function (L) { L.unfold(); L.more = 0; L.apply(); }); }
  if (wide.addEventListener) { wide.addEventListener('change', relayout); phone.addEventListener('change', relayout); }

  /* ---- styleguide: each swatch prints its token's computed value (the active theme only) */
  function swatches() {
    var cs = getComputedStyle(root);
    all('[data-token]').forEach(function (s) {
      var tok = s.getAttribute('data-token'), box = s.querySelector('.v-sg-chipbox'), out = s.querySelector('.v-sg-value');
      if (box) box.style.background = 'var(' + tok + ')';
      if (out) out.textContent = cs.getPropertyValue(tok).trim();
    });
  }
  if (document.querySelector('[data-token]')) {
    swatches();
    new MutationObserver(swatches).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }

  window.VISR = Object.assign(window.VISR || {}, { list: function (node) { return lists.get(node) || null; } });
})();
