/* VISR format.js: window.VISR.fmt, the JavaScript mirror of layouts/partials/fmt/*.html (design system v4 3.5). Same names, same
   arguments, same outputs: every function takes the dict its Hugo twin takes (or the bare value) and returns
   {text, long, state, kind, ...}. One format per kind of value; ui.js and charts.js never format a value themselves.
   The as-of date comes from <html data-asof="YYYY-MM-DD">. /styleguide/#formats renders a fixture table through both
   implementations ([data-fmt][data-args] cells are filled here) and CI compares them. */
(function () {
  'use strict';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var NBSP = ' ', MINUS = '−', ENDASH = '–';
  var asof = document.documentElement.getAttribute('data-asof') || '';
  var asofYear = /^\d{4}/.test(asof) ? +asof.slice(0, 4) : new Date().getUTCFullYear();
  var nfs = {};
  function nf(dec, n) {
    if (!nfs[dec]) nfs[dec] = new Intl.NumberFormat('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return nfs[dec].format(n);
  }
  function arg(a, key) { return a !== null && typeof a === 'object' && !(a instanceof Date) ? a : (function () { var o = {}; o[key] = a; return o; })(); }
  function has(v) { return v !== null && v !== undefined && v !== ''; }
  function missing(kind, long) { return { text: '', long: long || 'No data', state: 'na', kind: kind }; }

  var NOUNS = {
    'issue': ['issue', 'issues'], 'pr': ['PR', 'PRs'], 'sep': ['SEP', 'SEPs'], 'repository': ['repository', 'repositories'],
    'maintainer': ['maintainer', 'maintainers'], 'contributor': ['contributor', 'contributors'], 'person': ['person', 'people'],
    'label': ['label', 'labels'], 'version': ['version', 'versions'], 'package': ['package', 'packages'], 'file': ['file', 'files'],
    'directory': ['directory', 'directories'], 'commit': ['commit', 'commits'], 'comment': ['comment', 'comments'],
    'download': ['download', 'downloads'], 'day': ['day', 'days'], 'week': ['week', 'weeks'], 'hour': ['hour', 'hours'],
    'business day': ['business day', 'business days'], 'line': ['line', 'lines'], 'duplicate': ['duplicate', 'duplicates']
  };
  function noun(a) {
    a = arg(a, 'key');
    var key = String(a.key || '').toLowerCase().replace(/-/g, ' '), e = NOUNS[key] || [key, key];
    var one = has(a.n) && Math.abs(+a.n) === 1;
    return { text: one ? e[0] : e[1], one: e[0], other: e[1] };
  }

  function count(a) {
    a = arg(a, 'v');
    if (!has(a.v)) return missing('count');
    var v = +a.v, abs = Math.abs(v), text = nf(0, Math.round(abs));
    if (a.stat) { var r = Math.round(abs * 10) / 10; if (r < 100 && r !== Math.floor(r)) text = nf(1, r); }
    if (v < 0 && text !== '0') text = MINUS + text;
    if (a.noun) text += NBSP + noun({ key: a.noun, n: v }).text;
    return { text: text, long: text, state: v === 0 ? 'zero' : 'value', kind: 'count', v: v };
  }

  function volume(a) {
    a = arg(a, 'v');
    if (!has(a.v)) return missing('volume');
    var v = +a.v, abs = Math.abs(v), exact = nf(0, Math.round(abs)), text = exact;
    if (Math.round(abs) >= 1000) {
      var units = ['K', 'M', 'B'], divs = [1e3, 1e6, 1e9], pow = [1, 10, 100];
      var i = abs >= 1e9 ? 2 : abs >= 1e6 ? 1 : 0, x = abs / divs[i];
      var dec = x < 10 ? 2 : x < 100 ? 1 : 0, r = Math.round(x * pow[dec]) / pow[dec];
      dec = r < 10 ? 2 : r < 100 ? 1 : 0; r = Math.round(x * pow[dec]) / pow[dec];
      if (r >= 1000 && i < 2) { i += 1; x = abs / divs[i]; dec = 2; r = Math.round(x * 100) / 100; }
      var s = nf(dec, r);
      if (a.tick) s = s.replace(/\.0+$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
      text = s + units[i];
    }
    if (v < 0 && text !== '0') text = MINUS + text;
    return { text: text, long: exact + NBSP + noun({ key: a.noun || 'download', n: abs }).text, exact: exact,
      state: v === 0 ? 'zero' : 'value', kind: 'volume', v: v };
  }

  function share(a) {
    a = arg(a, 'v');
    var p = null;
    if (has(a.v)) p = +a.v; else if (has(a.part) && has(a.whole) && +a.whole > 0) p = +a.part / +a.whole * 100;
    if (p === null) return { text: '', long: 'No data', state: 'na', kind: 'share', pct: 0 };
    p = Math.max(0, Math.min(100, p));
    var text = nf(0, Math.round(p)) + '%';
    if (p > 0 && p < 1) text = '<1%'; else if (p > 99 && p < 100) text = '>99%';
    return { text: text, long: text, state: p === 0 ? 'zero' : 'value', kind: 'share', pct: p };
  }

  function dur(a) {
    a = arg(a, 'h');
    var unit = a.unit || 'auto', h = has(a.h) ? +a.h : has(a.d) ? +a.d * 24 : null;
    if (h === null) return { text: '', long: 'No data', state: 'na', kind: 'dur', num: '', unit: '' };
    h = Math.abs(h);
    var rh = Math.floor(h), rd = Math.floor(h / 24), num, u = 'd', long;
    if (unit === 'd' && h < 24) { num = '<1'; long = 'Less than 1 day'; }
    else if (unit !== 'd' && h < 1) { num = '<1'; u = 'h'; long = 'Less than 1 hour'; }
    else if (unit === 'h' || (unit === 'auto' && h < 48)) { num = nf(0, rh); u = 'h'; long = num + NBSP + (rh === 1 ? 'hour' : 'hours'); }
    else { num = nf(0, rd); long = num + NBSP + (rd === 1 ? 'day' : 'days'); }
    return { text: num + u, long: long, state: 'value', kind: 'dur', num: num, unit: u, v: h };
  }

  var BAD = ['open-issues', 'open-prs', 'waiting', 'overdue', 'median', 'closed-unmerged'];
  var GOOD = ['downloads', 'contributors', 'new-contributors', 'maintainers-active', 'merged', 'final'];
  function change(a) {
    a = a || {};
    var unit = a.unit || 'count', d = null;
    if (has(a.d)) d = +a.d;
    else if (has(a.cur) && has(a.prev)) {
      if (unit === 'percent') { if (+a.prev !== 0) d = (+a.cur - +a.prev) / Math.abs(+a.prev) * 100; }
      else d = +a.cur - +a.prev;
    }
    if (d === null) return { text: '', long: 'No baseline', state: 'na', kind: 'change', polarity: 'flat', sr: 'No baseline', d: 0 };
    var abs = Math.abs(d), mag, zero, zt = '0', r;
    if (unit === 'percent') { r = Math.round(abs * 10) / 10; zero = r === 0; zt = '0%'; mag = nf(1, r) + '%'; }
    else if (unit === 'stat') { r = Math.round(abs * 10) / 10; zero = r === 0; mag = count({ v: r, stat: true }).text; }
    else if (unit === 'volume') { zero = Math.round(abs) === 0; mag = volume({ v: abs }).text; }
    else if (unit === 'hours') { zero = abs < 1; mag = dur({ h: abs }).text; }
    else if (unit === 'days') { zero = abs < 1; mag = dur({ d: abs, unit: 'd' }).text; }
    else { r = Math.round(abs); zero = r === 0; mag = nf(0, r); }
    var up = d > 0, metric = String(a.metric || '').toLowerCase(), pol = 'flat';
    if (BAD.indexOf(metric) !== -1) pol = up ? 'bad' : 'good';
    else if (GOOD.indexOf(metric) !== -1) pol = up ? 'good' : 'bad';
    if (pol === 'flat' && a.polarity === 'up') pol = up ? 'good' : 'bad';
    if (pol === 'flat' && a.polarity === 'down') pol = up ? 'bad' : 'good';
    if (zero) return { text: zt, long: 'Unchanged', state: 'zero', kind: 'change', polarity: 'flat', sr: 'Unchanged', d: d };
    var sr = (up ? 'Up ' : 'Down ') + mag + (pol === 'bad' ? ', worsening' : pol === 'good' ? ', improving' : '');
    return { text: (up ? '+' : MINUS) + mag, long: sr, state: 'value', kind: 'change', polarity: pol, sr: sr, d: d };
  }
  function net(a) { a = arg(a, 'v'); return change({ d: a.v, cur: a.cur, prev: a.prev, unit: a.unit || 'count', metric: 'net' }); }

  /* Dates are "YYYY-MM-DD" strings (read as UTC calendar days), ISO timestamps or Date objects. */
  function toDate(x) {
    if (x instanceof Date) return x;
    var s = String(x), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date(s);
  }
  function md(t) { return MONTHS[t.getUTCMonth()] + ' ' + t.getUTCDate(); }
  function mdy(t) { return md(t) + ', ' + t.getUTCFullYear(); }
  function iso(t) { return t.toISOString().slice(0, 10); }
  function date(a) {
    a = arg(a, 'd');
    if (!has(a.d)) return { text: '', long: 'No data', iso: '', state: 'na', kind: 'date' };
    var t = toDate(a.d), text = a.year === true || t.getUTCFullYear() !== asofYear ? mdy(t) : md(t);
    if (a.weekday === true) text = WEEKDAYS[t.getUTCDay()] + ', ' + text;
    if (a.style === 'month') text = MONTHS[t.getUTCMonth()] + ' ' + t.getUTCFullYear();
    return { text: text, long: mdy(t), iso: iso(t), state: 'value', kind: 'date' };
  }
  function range(a) {
    a = a || {};
    if (!has(a.from)) return { text: '', long: 'No data', from: '', to: '', state: 'na', kind: 'range' };
    var x = toDate(a.from), y = toDate(has(a.to) ? a.to : a.from), same = iso(x) === iso(y);
    var yr = a.year === true || y.getUTCFullYear() !== asofYear ? ', ' + y.getUTCFullYear() : '', text;
    if (same) text = md(x) + yr;
    else if (x.getUTCFullYear() !== y.getUTCFullYear()) text = mdy(x) + ' to ' + mdy(y);
    else if (x.getUTCMonth() === y.getUTCMonth()) text = md(x) + ENDASH + y.getUTCDate() + yr;
    else text = md(x) + ' to ' + md(y) + yr;
    return { text: text, long: same ? mdy(x) : md(x) + ' to ' + mdy(y), from: iso(x), to: iso(y), state: 'value', kind: 'range' };
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ts(a) {
    a = arg(a, 't');
    if (!has(a.t)) return { text: '', long: 'No data', iso: '', state: 'na', kind: 'ts' };
    var t = toDate(a.t), text = mdy(t) + ', ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ' UTC';
    return { text: text, long: text, iso: t.toISOString().slice(0, 19) + 'Z', state: 'value', kind: 'ts' };
  }
  function ratio(a) {
    a = a || {};
    if (!has(a.part) || !has(a.whole)) return { text: '', long: 'No data', part: '', whole: '', state: 'na', kind: 'ratio' };
    var p = nf(0, Math.round(+a.part)), w = 'of ' + nf(0, Math.round(+a.whole));
    if (a.noun) w += NBSP + noun({ key: a.noun, n: a.whole }).text;
    return { text: p + ' ' + w, long: p + ' ' + w, part: p, whole: w, state: 'value', kind: 'ratio' };
  }
  function lines(a) {
    a = a || {};
    if (!has(a.adds) && !has(a.dels)) return { text: '', long: 'No data', adds: '', dels: '', state: 'na', kind: 'lines' };
    var x = nf(0, +(a.adds || 0)), y = nf(0, +(a.dels || 0));
    return { text: '+' + x + ' ' + MINUS + y, long: x + ' lines added, ' + y + ' removed', adds: '+' + x, dels: MINUS + y, state: 'value', kind: 'lines' };
  }
  var REASONS = { 'not-sdk': 'Not an SDK repository', 'not-classified': 'Not classified', 'tracking-since': 'Tracking since',
    'tracked-90': 'Tracked for 90 days only', 'no-complete-days': 'No complete days', 'no-baseline': 'No baseline',
    'no-history': 'No history for this measure', 'no-priority-labels': 'No priority labels', 'not-computed': 'Not computed', 'no-data': 'No data' };
  function na(a) {
    a = arg(a, 'reason');
    var key = String(a.reason || 'no-data'), long = REASONS[key] || key;
    if (key === 'tracking-since' && a.since) long = 'Tracking since ' + date(a.since).text;
    return { text: '', long: long, state: 'na', kind: 'na' };
  }
  /* the result count of a list (4.12): "288 PRs" at rest, "249 of 288 PRs" when narrowed */
  function result(matched, total, one, other, narrowed) {
    return { n: narrowed ? nf(0, matched) + ' of ' + nf(0, total) : nf(0, total), word: (narrowed ? total : total) === 1 ? one : other };
  }

  var fmt = { count: count, stat: function (a) { a = arg(a, 'v'); return count({ v: a.v, stat: true }); }, volume: volume, share: share,
    change: change, net: net, dur: dur, date: date, range: range, ts: ts, ratio: ratio, lines: lines, noun: noun, na: na,
    result: result, iso: iso, toDate: toDate };
  window.VISR = Object.assign(window.VISR || {}, { fmt: fmt });

  /* /styleguide/#formats: the JS column of the fixture table */
  function fixtures() {
    document.querySelectorAll('[data-fmt][data-args]').forEach(function (el) {
      var f = fmt[el.getAttribute('data-fmt')], out = '';
      try { out = f ? f(JSON.parse(el.getAttribute('data-args'))).text : ''; } catch (e) { out = 'error'; }
      el.textContent = out;
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixtures); else fixtures();
})();
