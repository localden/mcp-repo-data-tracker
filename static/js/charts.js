/* VISR charts.js (design system v4 4.19): Chart.js 4.4.1, no date adapter. The canvas draws marks and axis ticks and nothing else:
   every number is HTML (the readout, the notes row, the tooltip, the table view). Loaded only on pages that render a chart.
   Contract (layouts/partials/ui/chart.html and ui/trellis.html, built by ui/chart-canvas.html):
     <canvas data-viz="line|column" data-unit="count|downloads|hours" data-gran="day|week" data-metric="issues" data-scope="TypeScript SDK"
       data-size="main|panel" data-xaxis="on|off" data-polarity-key="open-issues|downloads|..." [data-chart-pin="42"]
       data-series='{"labels":[every date],"series":[{"label":"...","role":"accent|context","data":[n|null]}],
         "marks":[{"date":"YYYY-MM-DD","label":"..."}],"avg":{"value":n,"label":"..."}|null,"reconstructed":[from,to]|null,"metricOne":"issue"}'>
   Card hooks: [data-chart] card ([data-trellis] for small multiples), the Chart and Table segments (ui/tabs.html; ui.js dispatches
   "visr:tabchange"), .v-chart-table (the table host), [data-chart-live] (sr-only mirror of the tooltip).
   Values are formatted by VISR.fmt (format.js). Reads design tokens from CSS, mounts after the font is ready, re-themes on toggle. */
(function () {
  'use strict';
  if (!window.Chart || !window.VISR || !window.VISR.fmt) return;
  var F = window.VISR.fmt, root = document.documentElement, T = null, live = new Map(), state = new Map();
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function el(tag, cls, text) { var x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; }

  /* Dates are "YYYY-MM-DD" strings, read as UTC calendar days. */
  function parts(s) { var p = String(s).split('-'); return { y: +p[0], m: +p[1] - 1, d: +(p[2] || 1) }; }
  function addDays(s, n) { var p = parts(s), t = new Date(Date.UTC(p.y, p.m, p.d + n)); return t.toISOString().slice(0, 10); }
  function periodEnd(s, gran) { return gran === 'week' ? addDays(s, 6) : s; }
  /* a week never ends after the as-of day: the newest week of a level series reads "Nov 9–14" on a page updated Nov 14 */
  var ASOF = (root.getAttribute('data-asof') || '').slice(0, 10);
  function weekEnd(s, clamp) { var e = addDays(s, 6); return clamp && ASOF && e > ASOF && s <= ASOF ? ASOF : e; }
  function periodText(s, gran, clamp) { return gran === 'week' ? F.range({ from: s, to: weekEnd(s, clamp) }).text : F.date({ d: s, weekday: true }).text; }
  /* a change of the chart's first series: a delta toned by the metric's polarity key (ui/chart.html data-polarity-key), in the
     unit's form. Without a key the measure is neutral and the change is a plain signed number, never a grey badge. */
  function changeOf(unit, key, cur, prev) {
    if (cur == null || prev == null) return null;
    var a = { cur: cur, prev: prev }; if (key) a.metric = key;
    if (unit === 'downloads') a.unit = 'percent'; else if (unit === 'hours') a.unit = 'hours';
    var ch = F.change(a); return ch.state === 'na' ? null : ch;
  }
  function changeEl(ch, key) {
    if (!key && ch.state !== 'zero') { var p = el('span', 'v-val', ch.text); p.setAttribute('data-kind', 'net'); p.title = ch.sr; return p; }
    var d = el('span', 'v-delta is-' + (ch.polarity || 'flat')); d.appendChild(el('span', 'sr-only', ch.sr));
    var vis = el('span', '', ch.text); vis.setAttribute('aria-hidden', 'true'); d.appendChild(vis); return d;
  }
  function cap1(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function value(unit, v) { return unit === 'downloads' ? F.volume(v).text : unit === 'hours' ? F.dur({ h: v }).text : F.count(v).text; }
  function exact(unit, v) { return unit === 'downloads' ? F.volume(v).exact : unit === 'hours' ? F.dur({ h: v }).text : F.count(v).text; }

  /* Tokens (v4 2.1): the subject series is chart-1, a second series is always context grey; gridlines, axis, gap band, crosshair. */
  function tokens() {
    var cs = getComputedStyle(root);
    function g(n) { return cs.getPropertyValue(n).trim(); }
    return { accent: g('--chart-1') || g('--accent'), context: g('--series-context'), grid: g('--chart-grid') || g('--border-subtle'),
      axis: g('--chart-axis') || g('--border'), gap: g('--gap'), surface: g('--surface'), text3: g('--text-3'), strong: g('--border-strong'),
      accentStrong: g('--chart-1-strong') || g('--accent-text'), font: getComputedStyle(document.body).fontFamily };
  }
  /* Columns are 40% of their slot, between 16 and 40px, so a 12-slot chart reads the same at 6 and at 12 grid columns. */
  function barMax(width, n) { return Math.max(16, Math.min(40, Math.round((Math.max(0, width - 52) / Math.max(1, n)) * 0.4))); }
  function color(role) { return role === 'context' ? T.context : T.accent; }
  function applyDefaults() {
    var d = Chart.defaults;
    d.font.family = T.font; d.font.size = 12; d.font.weight = 400; d.font.lineHeight = 16 / 12;
    d.color = T.text3; d.borderColor = T.grid;
    d.responsive = true; d.maintainAspectRatio = false; d.animation = false;
    d.interaction.mode = 'visrIndex'; d.interaction.intersect = false;
    Object.assign(d.elements.line, { borderWidth: 2, tension: 0, fill: false, borderCapStyle: 'round', borderJoinStyle: 'round' });
    Object.assign(d.elements.point, { radius: 0, hoverRadius: 4, hitRadius: 0, hoverBorderWidth: 2 });
    if (d.datasets.bar) Object.assign(d.datasets.bar, { maxBarThickness: 16, categoryPercentage: 0.8, barPercentage: 0.9 });
    d.plugins.legend.display = false;    /* the readout row is the legend */
    d.plugins.tooltip.enabled = false;   /* the HTML tooltip below */
  }

  /* Y axis: starts at 0; step in {1, 2, 2.5, 5} x 10^n with 3 to 5 steps, the smallest top above the maximum. */
  function niceScale(max, integer) {
    var target = Math.max(+max || 0, 0) * 1.01; if (!(target > 0)) target = 1;
    var best = null, p0 = Math.floor(Math.log10(target)) - 2;
    for (var p = p0; p <= p0 + 3; p++) {
      [1, 2, 2.5, 5].forEach(function (m) {
        var step = Math.round(m * Math.pow(10, p) * 1e6) / 1e6;
        if (integer && (step < 1 || step % 1)) return;
        [3, 4, 5].forEach(function (k) { var top = step * k; if (top >= target && (!best || top < best.max)) best = { max: top, step: step }; });
      });
    }
    return best || { max: Math.ceil(target), step: Math.ceil(target / 4) };
  }
  function durationScale(maxH) {   /* hours below 72 hours, else days; ticks print whole units */
    var target = Math.max(+maxH || 0, 0) * 1.01, hours = maxH < 72, u = hours ? 1 : 24, best = null;
    if (!(target > 0)) target = 1;
    (hours ? [1, 2, 4, 6, 12, 24] : [1, 2, 5, 7, 14, 30, 60, 90, 180]).forEach(function (s) {
      [3, 4, 5].forEach(function (k) { var top = s * u * k; if (top >= target && (!best || top < best.max)) best = { max: top, step: s * u }; });
    });
    if (!best) { var n = niceScale(target / 24 / 1.01, true); best = { max: n.max * 24, step: n.step * 24 }; }
    best.u = u; best.unit = hours ? 'h' : 'd';
    return best;
  }
  /* Axis text: counts in full digits; volumes in ONE unit for the whole axis ("2M, 1.5M, 1M, 0.5M, 0"); durations in whole units. */
  function axisText(unit, sc) {
    if (unit === 'hours') return function (v) { return v === 0 ? '0' : F.count(Math.round(v / sc.u)).text + sc.unit; };
    if (unit === 'downloads' && sc.max >= 1000) {
      var div = sc.max >= 1e9 ? 1e9 : sc.max >= 1e6 ? 1e6 : 1e3, suffix = div === 1e9 ? 'B' : div === 1e6 ? 'M' : 'K';
      return function (v) { return v === 0 ? '0' : String(Math.round(v / div * 100) / 100) + suffix; };
    }
    return function (v) { return F.count(v).text; };
  }
  /* X labels: 14 slots or fewer use short dates; otherwise month names at month starts, at a stride of 1, 2, 3 or 6 months. The
     date rule of 3.2 holds here too: a year is printed only when it differs from the as-of year, on the first tick of that year
     ("Dec 2025, Jan, Feb"); a window inside the as-of year shows none. There is no special last-date tick. */
  function xTicks(scale, labels, gran) {
    var n = labels.length, out = {}, w = scale.width || 600, i;
    if (!n) return out;
    var slot = w / Math.max(1, scale.options.offset ? n : n - 1);
    if (n <= 14) {
      var every = Math.max(1, Math.ceil(56 / slot));
      for (i = n - 1; i >= 0; i -= every) out[i] = F.date({ d: labels[i] }).text;
      return out;
    }
    var starts = [];
    for (i = 0; i < n; i++) {
      var p = parts(labels[i]);
      if (i === 0 ? (gran === 'day' ? p.d === 1 : p.d <= 7) : parts(labels[i - 1]).m !== p.m) starts.push(i);
    }
    if (!starts.length) return out;
    var per = starts.length > 1 ? (starts[starts.length - 1] - starts[0]) / (starts.length - 1) * slot : w, stride = 6;
    [1, 2, 3, 6].some(function (s) { if (per * s >= 64) { stride = s; return true; } return false; });
    var asofY = ASOF ? parts(ASOF).y : parts(labels[n - 1]).y, seen = {};
    starts.forEach(function (ix, k) {
      if (k % stride) return;
      var q = parts(labels[ix]), year = q.y !== asofY && !seen[q.y];
      seen[q.y] = true;
      out[ix] = year ? MONTHS[q.m] + ' ' + q.y : MONTHS[q.m];
    });
    return out;
  }

  /* Per-series facts: null runs, the end point, isolated points. */
  function analyse(data, gran, leading, bridge) {
    var n = data.length, minRun = gran === 'day' ? 3 : 1, reach = gran === 'day' ? (bridge || 2) : 0;
    var first = -1, last = -1, runs = [], s = leading ? 0 : -1, i;
    for (i = 0; i < n; i++) {
      if (data[i] != null) {
        if (first < 0) first = i;
        if (s >= 0 && i - s >= minRun) runs.push([s, i - 1]);
        s = -1; last = i;
      } else if ((first >= 0 || leading) && s < 0) s = i;
    }
    if (s >= 0 && n - s >= minRun && (first >= 0 || leading)) runs.push([s, n - 1]);
    var radius = data.map(function (v, k) {
      if (v == null) return 0; if (k === last) return 4;
      for (var j = 1; j <= reach + 1; j++) if (data[k - j] != null || data[k + j] != null) return 0;
      return 3;   /* isolated: no neighbour the line would reach */
    });
    return { first: first, last: last, runs: runs, radius: radius };
  }
  function mergeRuns(runs) {
    runs.sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    runs.forEach(function (r) { var p = out[out.length - 1]; if (p && r[0] <= p[1] + 1) p[1] = Math.max(p[1], r[1]); else out.push([r[0], r[1]]); });
    return out;
  }
  /* A gap band only where NO series has a value: a hole in one of two series breaks that line and reads "No data" in the tooltip. */
  function intersectRuns(lists, minRun) {
    var out = lists[0].slice();
    for (var k = 1; k < lists.length; k++) {
      var next = [];
      out.forEach(function (r) { lists[k].forEach(function (q) { var s = Math.max(r[0], q[0]), e = Math.min(r[1], q[1]); if (e - s + 1 >= minRun) next.push([s, e]); }); });
      out = next;
    }
    return mergeRuns(out);
  }
  function inBand(st, i) { return st.bands.some(function (b) { return i >= b[0] && i <= b[1]; }); }

  /* Plugins. State lives in a Map keyed by canvas, set before the chart is constructed. Rectangles and lines only: no canvas text. */
  function S(c) { return state.get(c.canvas); }
  var gapBand = { id: 'visrGapBand', beforeDatasetsDraw: function (c) {
    var st = S(c); if (!st || !st.bands.length) return;
    var a = c.chartArea, x = c.scales.x, ctx = c.ctx, n = st.labels.length;
    var half = n > 1 ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) / 2 : a.width / 2;
    ctx.save(); ctx.fillStyle = T.gap;
    st.bands.forEach(function (b) {
      var l = Math.max(a.left, x.getPixelForValue(b[0]) - half), r = Math.min(a.right, x.getPixelForValue(b[1]) + half);
      if (r > l) ctx.fillRect(l, a.top, r - l, a.bottom - a.top);
    });
    ctx.restore();
  } };
  function slotW(c) { var n = c.data.labels.length, x = c.scales.x; return n > 1 ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) : c.chartArea.width; }
  function vline(c, i, stroke, dash, shift) {   /* never on or outside the plot's right edge, where it would read as a border */
    var a = c.chartArea, ctx = c.ctx, x = Math.round(Math.max(a.left, Math.min(c.scales.x.getPixelForValue(i) + (shift || 0), a.right - 1))) + 0.5;
    ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
    return x;
  }
  /* Event markers: 1px border-strong, dashed so one is never read as an axis or a plot edge, capped by a 6px diamond (the mark
     the notes row keys). A point of a weekly line chart stands at the centre of its week's slot, the geometry the gap band uses,
     so the marker sits at its day inside that slot: [x - w/2, x + w/2]. An event one day into a week lands just after the band
     that ends the week before and before that week's point, never past it. */
  var marks = { id: 'visrMarks', beforeDatasetsDraw: function (c) {
    var st = S(c); if (!st) return;
    var w = slotW(c), a = c.chartArea, ctx = c.ctx;
    /* the latest reading: a marker that falls within 12px of it is only its diamond and a 6px tick, so the full-height line never
       crowds the end dot, the most important point of the chart */
    var lastX = null;
    st.info.forEach(function (info, d) { var p = info.last >= 0 && c.getDatasetMeta(d).data[info.last]; if (p && (lastX === null || p.x > lastX)) lastX = p.x; });
    st.marks.forEach(function (m) {
      var shift = st.kind === 'line' ? (m.frac - 0.5) * w : 0, x, y = a.top - 4;
      if (lastX !== null && Math.abs(c.scales.x.getPixelForValue(m.i) + shift - lastX) < 12) {
        x = Math.round(Math.max(a.left, Math.min(c.scales.x.getPixelForValue(m.i) + shift, a.right - 1))) + 0.5;
        ctx.save(); ctx.strokeStyle = T.strong; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.top + 6); ctx.stroke(); ctx.restore();
      } else x = vline(c, m.i, T.strong, [2, 3], shift);
      ctx.save(); ctx.fillStyle = T.text3; ctx.beginPath();
      ctx.moveTo(x, y - 3); ctx.lineTo(x + 3, y); ctx.lineTo(x, y + 3); ctx.lineTo(x - 3, y); ctx.closePath(); ctx.fill(); ctx.restore();
    });
  } };
  /* A hole in one of two series (the other has values, so there is no gap band): up to 7 days are bridged by the line itself
     (spanGaps), so a short hole never reads as a break; a longer one is joined by a 1px connector in the context colour, which
     is visible over its span, and the notes row keys it. Nothing crosses a gap band. */
  var bridges = { id: 'visrBridges', beforeDatasetsDraw: function (c) {
    var st = S(c); if (!st || st.kind !== 'line' || st.series.length < 2) return;
    var ctx = c.ctx;
    st.info.forEach(function (info, d) {
      var meta = c.getDatasetMeta(d), data = st.series[d].data;
      info.runs.forEach(function (r) {
        var s = r[0], e = r[1], i;
        if (st.gran === 'day' && e - s + 1 < 8) return;   /* the line spans it */
        if (s <= info.first || e >= info.last || data[s - 1] == null || data[e + 1] == null) return;
        for (i = s; i <= e; i++) if (inBand(st, i)) return;
        var p = meta.data[s - 1], q = meta.data[e + 1]; if (!p || !q) return;
        ctx.save(); ctx.strokeStyle = T.context; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.restore();
      });
    });
  } };
  var avgRule = { id: 'visrAvgRule', beforeDatasetsDraw: function (c) {   /* 1px context rule; its value is a readout item */
    var st = S(c), avg = st && st.spec.avg; if (!avg || avg.value == null) return;
    var a = c.chartArea, y = Math.round(c.scales.y.getPixelForValue(avg.value)) + 0.5, ctx = c.ctx;
    ctx.save(); ctx.strokeStyle = T.context; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke(); ctx.restore();
  } };
  /* The hover mark: a crosshair on a line chart. On a column chart the hovered column takes the strong series colour (the
     dataset's hover colour) and a 2px tick marks its slot on the x axis; a full-height fill would be the gap band's mark. Drawn
     in every panel of a trellis, so each shows which week is selected. */
  var crosshair = { id: 'visrCrosshair', afterDatasetsDraw: function (c) {
    var st = S(c); if (!st || st.index == null || st.kind === 'line') return;
    var a = c.chartArea, w = slotW(c), x = c.scales.x.getPixelForValue(st.index), ctx = c.ctx;
    var l = Math.max(a.left, Math.round(x - w / 2) + 1), r = Math.min(a.right, Math.round(x + w / 2) - 1);
    ctx.save(); ctx.fillStyle = T.text3; ctx.fillRect(l, Math.round(a.bottom) - 1, r - l, 2); ctx.restore();
  }, beforeDatasetsDraw: function (c) {
    var st = S(c); if (st && st.index != null && st.kind === 'line') vline(c, st.index, T.strong);
  } };

  /* Hover, touch and keyboard share one index. A tap pins the nearest slot; a horizontal drag scrubs (touch-action: pan-y in CSS). */
  function indexAt(c, x) { var n = c.data.labels.length; return Math.max(0, Math.min(n - 1, Math.round(c.scales.x.getValueForPixel(x)))); }
  function elementsAt(c, i) {
    var out = [];
    c.data.datasets.forEach(function (ds, d) { var m = c.getDatasetMeta(d); if (!m.hidden && m.data[i] && ds.data[i] != null) out.push({ datasetIndex: d, index: i, element: m.data[i] }); });
    return out;
  }
  Chart.Interaction.modes.visrIndex = function (c, e) {
    var a = c.chartArea; return a && e.x >= a.left && e.x <= a.right ? elementsAt(c, indexAt(c, e.x)) : [];
  };
  var hover = { id: 'visrHover', afterEvent: function (c, args) {
    var st = S(c), e = args.event; if (!st || e.type === 'click') return;
    var i = e.type !== 'mouseout' && args.inChartArea ? indexAt(c, e.x) : (e.type === 'mouseout' ? null : st.index);
    if (i !== st.index) { select(c, i, false); args.changed = true; }
  } };
  function siblings(c) {   /* the other live charts of a trellis card */
    var card = c.canvas.closest('[data-trellis]'); if (!card) return [];
    return Array.prototype.slice.call(card.querySelectorAll('canvas[data-viz]')).filter(function (cv) { return cv !== c.canvas && live.has(cv); })
      .map(function (cv) { return live.get(cv); });
  }
  function setIndex(c, i) {
    var st = S(c); if (!st) return;
    st.index = i; c.setActiveElements(i == null ? [] : elementsAt(c, i));
  }
  function select(c, i, announce) {
    var st = S(c); if (!st) return;
    setIndex(c, i);
    siblings(c).forEach(function (o) { var os = S(o); if (os && os.index !== i) { setIndex(o, i); hideTip(os); o.render(); } });
    showTip(c, st, i, announce);
  }
  function hideTip(st) { if (st.tip) st.tip.hidden = true; }

  /* The HTML tooltip: beside the crosshair, on the side and at the edge (top or bottom of the plot) where it covers no mark of the
     series within its width. A trellis has ONE tooltip for the whole card, anchored to the trellis at the top of its first panel and
     listing every panel. Title (the period), then a three-column grid of key, right-aligned value, label; a change is the delta
     badge with its base, as everywhere. Built with textContent. */
  function tipHost(c) { var t = c.canvas.closest('[data-trellis]'); return (t && t.querySelector('.v-trellis')) || c.canvas.parentNode; }
  function tipEl(c, st) {
    var host = tipHost(c), tip = host._visrTip;
    if (!tip || !tip.isConnected) { tip = host._visrTip = el('div', 'v-tip'); tip.setAttribute('aria-hidden', 'true'); host.appendChild(tip); }
    st.tip = tip;
    return tip;
  }
  /* how many pixels of a box (x0..x1, y0..y1) the marks of one dataset cover vertically: a line's span between its points in
     that x range, a column from its top to the axis */
  function overlap(c, st, d, x0, x1, y0, y1) {
    var a = c.chartArea, pad = slotW(c), ds = c.data.datasets[d], m = c.getDatasetMeta(d), top = Infinity, bottom = -Infinity;
    if (m.hidden) return 0;
    m.data.forEach(function (pt, i) {
      if (ds.data[i] == null || pt.x < x0 - pad || pt.x > x1 + pad) return;
      if (pt.y < top) top = pt.y; if (pt.y > bottom) bottom = pt.y;
    });
    if (top === Infinity) return 0;
    if (st.kind !== 'line') bottom = a.bottom;
    return Math.max(0, Math.min(y1, bottom + 6) - Math.max(y0, top - 6));
  }
  /* a tooltip row: key (omitted in a trellis, where every row is the same series), name, then the value on the right edge: the
     order of the readout above the plot, of a pair and of a stat-list row */
  function tipRow(list, keyCls, valText, name) {
    var li = el('li');
    if (keyCls) { var key = el('span', 'v-key ' + keyCls); key.setAttribute('aria-hidden', 'true'); li.appendChild(key); }
    li.appendChild(el('span', 'v-tip-name', name)); li.appendChild(el('span', 'v-tip-value', valText)); list.appendChild(li);
    return name + ' ' + valText;
  }
  /* Trellis, from 64rem: no floating tooltip. Every drawn row's label cell holds a hidden pair (.v-pair.is-scrub, ui/trellis.html);
     it is filled with the selected period and that row's value, and .is-scrub on the trellis shows it in place of the row's
     resting fact and notes, so nothing covers a label or a column. Returns the spoken line, or null when this is not a trellis
     at that width. */
  var WIDE = window.matchMedia ? window.matchMedia('(min-width: 64rem)') : { matches: true };
  function scrub(c, i) {
    var card = c.canvas.closest('[data-trellis]'), host = card && card.querySelector('.v-trellis');
    if (!host || !WIDE.matches) return null;
    if (i == null) { host.classList.remove('is-scrub'); return ''; }
    var spoken = [];
    [c].concat(siblings(c)).sort(function (a, b) { return a.canvas.compareDocumentPosition(b.canvas) & 4 ? -1 : 1; }).forEach(function (o, k) {
      var os = S(o), row = o.canvas.closest('.v-trellis-row'), pair = row && row.querySelector('.v-pair.is-scrub'); if (!os || !pair) return;
      var v = os.series[0] ? os.series[0].data[i] : null, period = periodText(os.labels[i], os.gran, os.kind === 'line'), out;
      if (!k) spoken.push(period);
      pair.textContent = '';
      pair.appendChild(el('span', 'v-pair-label', period));
      if (v == null) {
        var why = inBand(os, i) ? 'Data gap' : 'No data';
        out = el('span', 'v-val is-na'); out.title = why; out.appendChild(el('span', 'sr-only', why));
        spoken.push((os.scope || '') + ' ' + why);
      } else {
        out = el('span', 'v-val', value(os.unit, v)); out.setAttribute('data-kind', os.unit === 'downloads' ? 'volume' : os.unit === 'hours' ? 'dur' : 'count');
        spoken.push((os.scope || '') + ' ' + out.textContent);
      }
      pair.appendChild(out);
    });
    host.classList.add('is-scrub');
    return spoken.join('. ');
  }
  function showTip(c, st, i, announce) {
    var tip = st.tip, line = scrub(c, i);
    if (line !== null) { if (tip) tip.hidden = true; if (announce && st.live) st.live.textContent = line; return; }
    if (i == null) { if (tip) tip.hidden = true; if (announce && st.live) st.live.textContent = ''; return; }
    tip = tipEl(c, st);
    tip.textContent = '';
    var spoken = [], label = st.labels[i], keyForm = st.kind === 'line' ? 'is-line' : 'is-bar';
    /* the period: a week of a level series ends on the as-of day at the latest */
    var title = el('p', 'v-tip-title', periodText(label, st.gran, st.kind === 'line')); tip.appendChild(title); spoken.push(title.textContent);
    var others = siblings(c), list = el('ul', 'v-tip-rows' + (others.length ? ' is-plain' : '')), rows = 0, missing = [];
    if (others.length) {   /* trellis: one row per panel, named by its scope; every row is the same series, so there is no key */
      [c].concat(others).sort(function (a, b) { return a.canvas.compareDocumentPosition(b.canvas) & 4 ? -1 : 1; }).forEach(function (o) {
        var os = S(o), v = os.series[0] ? os.series[0].data[i] : null, name = os.scope || (os.series[0] && os.series[0].label) || '';
        if (v == null) { if (!inBand(os, i)) missing.push(name); return; }
        spoken.push(tipRow(list, '', value(os.unit, v), name)); rows++;
      });
    } else if (!inBand(st, i)) {
      /* the name is the series label, exactly as the readout and the card title print it ("949" "Open issues") */
      st.series.forEach(function (s) {
        var v = s.data[i]; if (v == null) { if (!st.single) missing.push(s.label); return; }
        spoken.push(tipRow(list, keyForm + ' is-' + (s.role === 'context' ? 'context' : 'accent'), value(st.unit, v), s.label)); rows++;
      });
    }
    if (rows) tip.appendChild(list);
    function note(text) { tip.appendChild(el('p', 'v-tip-note', text)); spoken.push(text); }
    function changeRow(ch, base) {   /* a change is the delta badge and its base, never a typed sentence */
      var row = el('p', 'v-tip-change');
      row.appendChild(changeEl(ch, st.polarity)); row.appendChild(el('span', 'v-base', base)); tip.appendChild(row);
      spoken.push(ch.sr + ' ' + base);
    }
    /* a series with no value at this slot has no row: one caption line says so, in the words of the notes key ("Data gap" inside
       a gap band; "No data" is the reason of a single missing reading) */
    if (!rows) note(others.length || inBand(st, i) ? 'Data gap' : 'No data');
    else if (missing.length) note(missing.join(', ') + ' not recorded');
    if (st.single && !others.length && st.kind === 'column' && st.gran === 'week' && i > 0) {   /* change against the prior week */
      var ch = changeOf(st.unit, st.polarity, st.series[0].data[i], st.series[0].data[i - 1]);
      if (ch) changeRow(ch, F.base('prior-week').text);
    }
    tip.hidden = false;
    var host = tip.parentNode, a = c.chartArea, x = c.scales.x.getPixelForValue(i), w = tip.offsetWidth, h = tip.offsetHeight;
    var hb = host.getBoundingClientRect(), cb = c.canvas.getBoundingClientRect(), ox = cb.left - hb.left, oy = cb.top - hb.top, hx = ox + x;
    var sides = [];   /* right of the crosshair first, then left; each only when it fits */
    if (hx + 12 + w <= host.clientWidth) sides.push(hx + 12);
    if (hx - 12 - w >= 0) sides.push(hx - 12 - w);
    if (!sides.length) sides.push(Math.max(0, Math.min(host.clientWidth - w, hx + 12)));
    var left = sides[0], top = oy + a.top;
    if (others.length) {
      /* trellis below 64rem (from 64rem the label cells carry the reading, see scrub): beside the selected slot, at the top of
         that panel */
      top = Math.max(0, Math.min(host.clientHeight - h, oy + a.top));
    } else {
      /* candidates: the bottom edge, then the top edge, each right then left of the crosshair. The first that covers no mark of
         any series wins; otherwise the one that covers least, the subject series counting far more than the context series */
      var best = null;
      [oy + a.bottom - h - 8, oy + a.top].forEach(function (ty) {
        if (ty < oy + a.top) return;
        sides.forEach(function (sx) {
          var score = 0;
          c.data.datasets.forEach(function (ds, d) {
            score += overlap(c, st, d, sx - ox, sx - ox + w, ty - oy, ty - oy + h) * (st.series[d] && st.series[d].role === 'context' ? 1 : 1000);
          });
          if (!best || score < best.score) best = { left: sx, top: ty, score: score };
        });
      });
      if (best) { left = best.left; top = best.top; }
    }
    tip.style.left = Math.round(left) + 'px'; tip.style.top = Math.round(top) + 'px';
    if (announce && st.live) st.live.textContent = spoken.join('. ');
  }

  function build(canvas) {
    var kind = canvas.dataset.viz === 'column' ? 'column' : 'line', unit = canvas.dataset.unit || 'count', gran = canvas.dataset.gran === 'week' ? 'week' : 'day';
    /* below 64rem a trellis panel sits under its own label block, so every panel carries its dates, not only the last one */
    var panel = canvas.dataset.size === 'panel', xaxis = canvas.dataset.xaxis !== 'off' || (panel && !WIDE.matches);
    var spec = JSON.parse(canvas.dataset.series), labels = spec.labels || [], series = (spec.series || []).slice(0, 2);
    var line = kind === 'line', single = series.length === 1;
    var info = series.map(function (s) { return analyse(s.data, gran, panel, single ? 2 : 7); });
    var bands = !info.length ? [] : info.length < 2 ? mergeRuns(info[0].runs.slice()) : intersectRuns(info.map(function (x) { return x.runs; }), gran === 'day' ? 3 : 1);
    /* a daily line bridges a hole of up to 7 days itself, except across a gap band: nothing crosses a band */
    function crossesBand(ctx) {
      for (var k = ctx.p0DataIndex + 1; k < ctx.p1DataIndex; k++) if (bands.some(function (b) { return k >= b[0] && k <= b[1]; })) return true;
      return false;
    }
    var datasets = series.map(function (s, i) {
      var c = color(s.role), a = info[i], order = s.role === 'context' ? 2 : 1;
      if (line) return { label: s.label, data: s.data, order: order, borderColor: c, backgroundColor: c, fill: false, spanGaps: gran === 'day' ? 8 : false,
        segment: { borderColor: function (ctx) { return ctx.p1DataIndex - ctx.p0DataIndex > 1 && crossesBand(ctx) ? 'transparent' : undefined; } },
        pointRadius: a.radius, pointHoverRadius: 4, pointHitRadius: 0, pointBackgroundColor: c, pointBorderColor: T.surface, pointBorderWidth: 2,
        pointHoverBackgroundColor: c, pointHoverBorderColor: T.surface, pointHoverBorderWidth: 2 };
      return { label: s.label, data: s.data, order: order, backgroundColor: c, hoverBackgroundColor: s.role === 'context' ? c : T.accentStrong, borderWidth: 0, borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: false };
    });
    var max = 0;
    series.forEach(function (s) { s.data.forEach(function (v) { if (v != null && v > max) max = v; }); });
    if (spec.avg && spec.avg.value > max) max = spec.avg.value;
    var sc = unit === 'hours' ? durationScale(max) : niceScale(max, true), tick = axisText(unit, sc);
    var marksAt = [];
    (spec.marks || []).forEach(function (m) {   /* the slot that holds the date (for weeks: the week that contains it, and how far into it) */
      var ix = -1; labels.forEach(function (l, i) { if (l <= m.date) ix = i; });
      if (ix < 0 || m.date > periodEnd(labels[ix], gran)) return;
      var p = parts(labels[ix]), q = parts(m.date), days = Math.round((Date.UTC(q.y, q.m, q.d) - Date.UTC(p.y, p.m, p.d)) / 864e5);
      marksAt.push({ i: ix, frac: gran === 'week' ? Math.max(0, Math.min(6, days)) / 7 : 0 });
    });
    var host = canvas.closest('[data-chart]');
    var boxW = canvas.parentNode ? canvas.parentNode.clientWidth : 0;
    if (!line) datasets.forEach(function (ds) { ds.maxBarThickness = barMax(boxW, labels.length); });
    state.set(canvas, { kind: kind, unit: unit, gran: gran, spec: spec, labels: labels, series: series, info: info, bands: bands, marks: marksAt,
      single: single, index: null, tip: null, live: host && host.querySelector('[data-chart-live]'), scope: canvas.dataset.scope || '',
      metric: canvas.dataset.metric || '', metricOne: spec.metricOne || canvas.dataset.metric || '', polarity: canvas.getAttribute('data-polarity-key') || '' });
    return {
      type: line ? 'line' : 'bar',
      data: { labels: labels, datasets: datasets },
      plugins: [gapBand, marks, bridges, avgRule, crosshair, hover],
      options: {
        layout: { padding: { top: 8, right: 12, bottom: 0, left: 0 } },   /* the end dot (radius 4, 2px ring) clears the plot's right edge */
        onResize: function (chart, size) {   /* column width follows the slot width */
          if (line) return;
          chart.data.datasets.forEach(function (ds) { ds.maxBarThickness = barMax(size.width, labels.length); });
        },
        interaction: { mode: 'visrIndex', intersect: false },
        hover: { mode: 'visrIndex', intersect: false },
        scales: {
          x: { type: 'category', offset: !line, border: { color: T.axis }, grid: { display: false, tickLength: 0 },
               ticks: { display: xaxis, autoSkip: false, maxTicksLimit: labels.length + 1, maxRotation: 0, color: T.text3, padding: 8,
                        callback: function (v, i) { if (i === 0 || !this._visr) this._visr = xTicks(this, labels, gran); var t = this._visr[i]; return t == null ? '' : t; } },
               afterFit: function (s) { s.height = xaxis ? 24 : 0; } },
          y: { min: 0, max: sc.max, beginAtZero: true, border: { display: false }, grid: { color: T.grid, drawTicks: false },
               ticks: { stepSize: panel ? sc.max : sc.step, autoSkip: false, color: T.text3, padding: 8, callback: tick },
               afterFit: function (s) { s.width = 44; } }   /* plots in one row, and every panel of a trellis, share a left edge */
        }
      }
    };
  }

  /* A chart must fill its plot. Chart.js sizes the canvas from its container at construction; when that happens while the
     container is still narrower than it will be (a grid row that has not settled, a font swap), the canvas keeps the transient
     size. refit() re-measures one chart and re-places a selected slot's tooltip; it runs a frame after mount, whenever a plot
     box changes size (ResizeObserver, boot), and once more after load and after the fonts are ready. */
  function refit(canvas) {
    var c = live.get(canvas), host = canvas.parentNode, st = state.get(canvas); if (!c || !host || !host.clientWidth) return;
    if (Math.abs(canvas.clientWidth - host.clientWidth) > 1 || Math.abs(canvas.clientHeight - host.clientHeight) > 1 || Math.abs(c.width - host.clientWidth) > 1) c.resize();
    if (st && st.index != null) { c.setActiveElements(elementsAt(c, st.index)); showTip(c, st, st.index, false); c.render(); }
  }
  function refitAll() { Array.from(live.keys()).forEach(refit); }
  var plotRO = window.ResizeObserver ? new ResizeObserver(function (entries) {
    entries.forEach(function (en) { var cv = en.target.querySelector('canvas[data-viz]'); if (cv && live.has(cv)) refit(cv); });
  }) : null;
  function mount(canvas) {
    try {
      var c = new Chart(canvas, build(canvas)); live.set(canvas, c);
      var pin = canvas.getAttribute('data-chart-pin');
      if (pin !== null && pin !== '') { select(c, Math.max(0, Math.min(c.data.labels.length - 1, parseInt(pin, 10) || 0)), false); c.render(); }
      if (plotRO && canvas.parentNode) plotRO.observe(canvas.parentNode);
      requestAnimationFrame(function () { if (live.get(canvas) === c) refit(canvas); });
    } catch (e) { state.delete(canvas); if (window.console) console.error('VISR chart failed', canvas.id, e); }
  }
  function unmount(canvas) {
    var c = live.get(canvas), st = state.get(canvas);
    if (st && st.tip) st.tip.remove();
    if (c) c.destroy();
    live.delete(canvas); state.delete(canvas);
  }
  function retheme() {
    T = tokens(); applyDefaults();
    Array.from(live.keys()).forEach(function (cv) { unmount(cv); mount(cv); });   /* copy first: the map changes while re-mounting */
  }

  /* Keyboard: the canvas is focusable; arrows step, Home and End jump, Escape clears; the sr-only live line mirrors the tooltip. */
  document.addEventListener('keydown', function (e) {
    var cv = e.target; if (!cv || cv.tagName !== 'CANVAS' || !live.has(cv)) return;
    var c = live.get(cv), st = state.get(cv), n = st.labels.length, i = st.index, k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      var lastData = Math.max.apply(null, st.info.map(function (x) { return x.last; }).concat([-1]));
      i = i == null ? (lastData >= 0 ? lastData : n - 1) : Math.max(0, Math.min(n - 1, i + (k === 'ArrowRight' ? 1 : -1)));
    } else if (k === 'Home') i = 0;
    else if (k === 'End') i = n - 1;
    else if (k === 'Escape' && i != null) i = null;
    else return;
    e.preventDefault(); select(c, i, true); c.render();
  });
  function clear(cv) { var c = live.get(cv), st = state.get(cv); if (c && st && st.index != null && !cv.hasAttribute('data-chart-pin')) { select(c, null, true); c.render(); } }
  document.addEventListener('focusout', function (e) { var cv = e.target; if (cv && cv.tagName === 'CANVAS' && live.has(cv)) clear(cv); });
  /* a tap outside the plot clears a pinned slot */
  document.addEventListener('touchstart', function (e) {
    var plot = e.target.closest && e.target.closest('.v-plot, .v-trellis-panel'), card = plot && plot.closest('[data-chart]');
    Array.from(live.keys()).forEach(function (cv) { if (!card || cv.closest('[data-chart]') !== card) clear(cv); });
  }, { passive: true });

  /* Table view: the switch swaps the plot for a flush compact table in the same box, newest first, across the full card width (CSS:
     a fixed period column, the value columns share the rest). Values use the one format of their kind; a volume carries its exact
     figure in title. A column of weeks shows each week by its Monday, as a date under the header "Week of", with the range of the
     week in title: one form down the column, never ranges that alternate between "Nov 2–8" and "Oct 26 to Nov 1". A daily series
     over 90 days is shown as weeks, and the header says so. A gap is one ordinary row: it is a span, so its first cell is a range,
     and each value cell holds the empty mark. A "Change" column (one series) carries its base as the sub line of its header, like
     every Change column on the site. A series with no value anywhere has no column (4.14 rule 8); a trellis row that cannot draw
     is named under the table by ui/trellis.html. The box shows the header and whole rows; the fade appears only after scrolling. */
  function weekStart(s) { var p = parts(s), t = new Date(Date.UTC(p.y, p.m, p.d)); return addDays(s, -((t.getUTCDay() + 6) % 7)); }
  function toWeekly(labels, cols, flow) {
    var keys = [], at = {};
    labels.forEach(function (l) { var k = weekStart(l); if (!(k in at)) { at[k] = keys.length; keys.push(k); } });
    return { labels: keys, cols: cols.map(function (col) {
      var bins = keys.map(function () { return { sum: 0, n: 0, last: null }; });
      col.data.forEach(function (v, i) { if (v == null) return; var b = bins[at[weekStart(labels[i])]]; b.sum += v; b.n++; b.last = v; });
      return { label: col.label, unit: col.unit, data: bins.map(function (b) { return flow ? (b.n === 7 ? b.sum : null) : b.last; }) };
    }) };
  }
  function naCell(td, reason) { var s = el('span', 'v-val is-na'); s.title = reason || 'No data'; s.appendChild(el('span', 'sr-only', reason || 'No data')); td.appendChild(s); }
  function buildTable(card, host) {
    var canvases = Array.prototype.slice.call(card.querySelectorAll('canvas[data-viz]')); if (!canvases.length) return;
    var first = canvases[0], spec0 = JSON.parse(first.dataset.series), gran = first.dataset.gran === 'week' ? 'week' : 'day', flow = first.dataset.viz === 'column';
    var labels = spec0.labels || [], cols = [], trellis = card.hasAttribute('data-trellis'), key = first.getAttribute('data-polarity-key') || '';
    canvases.forEach(function (cv) {
      var spec = cv === first ? spec0 : JSON.parse(cv.getAttribute('data-series') || '{}'), unit = cv.getAttribute('data-unit') || 'count', ser = spec.series || [];
      if (trellis) cols.push({ label: cv.getAttribute('data-scope') || (ser[0] && ser[0].label) || '', unit: unit, data: ser[0] ? ser[0].data : [] });
      else ser.slice(0, 2).forEach(function (s) { cols.push({ label: s.label, unit: unit, data: s.data }); });
    });
    /* a column whose every cell would be the empty mark is omitted */
    cols = cols.filter(function (c) { return c.data.some(function (v) { return v != null; }); });
    if (!cols.length) return;
    var gapTitle = first.getAttribute('data-gap-title') || '';
    var g = gran, binned = false;
    if (gran === 'day' && labels.length > 90) { var wk = toWeekly(labels, cols, flow); labels = wk.labels; cols = wk.cols; g = 'week'; binned = true; }
    var change = cols.length === 1;
    var tbl = el('table', 'v-dt is-compact'), cap = tbl.createCaption(); cap.className = 'sr-only';
    var how = binned ? (flow ? 'Weekly totals' : 'Weekly, last reading of each week') : '';
    cap.textContent = cap1(first.dataset.metric || '') + (trellis ? '' : (first.dataset.scope ? ', ' + first.dataset.scope : '')) + (how ? '. ' + how : '');
    var hr = tbl.createTHead().insertRow();
    function th(text, num, sub) { var h = el('th', num ? 'num' : '', text); h.scope = 'col'; if (sub) h.appendChild(el('span', 'v-th-sub', sub)); hr.appendChild(h); return h; }
    var ph = th(g === 'week' ? 'Week of' : 'Date', false);
    if (how) ph.title = how;
    /* a daily level shown as weeks: each value column says which reading a week shows (fmt/label.html reading "week-end") */
    cols.forEach(function (c) { th(c.label, true, binned && !flow ? 'End of week' : ''); });
    if (change) th('Change', true, F.base(g === 'week' ? 'prior-week' : 'prior-day').text);
    var tb = tbl.createTBody();
    function empty(i) { return cols.every(function (c) { return c.data[i] == null; }); }
    /* slots before the first measured one are not rows: nothing was tracked yet */
    var firstData = 0; while (firstData < labels.length && empty(firstData)) firstData++;
    var i = labels.length - 1;
    /* a gap is one band row across the table (the group-row look): the gap key, the words "Data gap" and its range. One outage
       has one range on a page: a run that overlaps the collection outage prints the outage's own dates (data-gap-from, -to) */
    var gapFrom = first.getAttribute('data-gap-from') || '', gapTo = first.getAttribute('data-gap-to') || '';
    while (i >= firstData) {
      var r = tb.insertRow(), h = el('th'); h.scope = 'row'; r.appendChild(h);
      if (empty(i)) {
        var j = i; while (j > firstData && empty(j - 1)) j--;
        var from = labels[j], to = periodEnd(labels[i], g);
        if (gapFrom && gapTo && from <= gapTo && to >= gapFrom) { from = gapFrom; to = gapTo; }
        r.className = 'v-gap'; h.colSpan = cols.length + 1 + (change ? 1 : 0);
        var box = el('span', 'v-gap-row'), gk = el('span', 'v-key is-gap'), gr = el('span', 'v-val', F.range({ from: from, to: to }).text);
        gk.setAttribute('aria-hidden', 'true'); gr.setAttribute('data-kind', 'range');
        box.appendChild(gk); box.appendChild(el('span', '', 'Data gap')); box.appendChild(gr); h.appendChild(box);
        if (gapTitle) h.title = gapTitle;   /* the cause of the gap (a collection outage) */
        i = j - 1;
      } else {
        h.textContent = F.date({ d: labels[i] }).text;
        if (g === 'week') h.title = F.range({ from: labels[i], to: weekEnd(labels[i], !flow) }).text;
        cols.forEach(function (c) {
          var td = r.insertCell(); td.className = 'num';
          if (c.data[i] == null) { naCell(td); return; }
          /* one format per kind here too: a volume prints as on every other surface ("88.2M"), the exact figure in its title */
          var s = el('span', 'v-val', value(c.unit, c.data[i])), ex = exact(c.unit, c.data[i]);
          if (c.unit === 'downloads' && ex !== s.textContent) s.title = F.volume(c.data[i]).long;
          s.setAttribute('data-kind', c.unit === 'downloads' ? 'volume' : c.unit === 'hours' ? 'dur' : 'count'); td.appendChild(s);
        });
        if (change) {
          var td = r.insertCell(), ch = changeOf(cols[0].unit, key, cols[0].data[i], i > 0 ? cols[0].data[i - 1] : null); td.className = 'num';
          if (!ch) naCell(td, 'No baseline'); else td.appendChild(changeEl(ch, key));
        }
        i--;
      }
    }
    host.setAttribute('aria-label', cap1(first.dataset.metric || '') + ' table');
    host.appendChild(tbl);
    /* the fade only once the reader has scrolled and rows remain below: at rest the box ends on a whole row */
    function clip() { host.classList.toggle('is-clipped', host.scrollTop > 0 && host.scrollTop + host.clientHeight < host.scrollHeight - 1); }
    host.addEventListener('scroll', clip, { passive: true });
  }
  /* The table box shows its header and whole rows: the height CSS gives it is trimmed to the last full row and the remainder
     becomes its bottom margin, so the card keeps its height. --sbw is the width a classic scrollbar takes from the box, so the
     values of the last column still end on the card inset. */
  function fitTable(host) {
    var tbl = host.querySelector('table'); if (!tbl || !tbl.tHead || !tbl.tBodies[0] || !tbl.tBodies[0].rows.length) return;
    host.style.height = ''; host.style.maxHeight = ''; host.style.marginBottom = '';
    var cs = getComputedStyle(host), auto = host.classList.contains('v-trellis-table');
    var box = auto ? parseFloat(cs.maxHeight) : host.offsetHeight; if (!(box > 0)) return;
    var edge = host.offsetHeight - host.clientHeight, head = tbl.tHead.offsetHeight, row = tbl.tBodies[0].rows[0].offsetHeight || 36;
    var n = Math.max(1, Math.floor((box - edge - head) / row)), fit = edge + head + n * row;
    if (auto) host.style.maxHeight = fit + 'px';
    else if (tbl.offsetHeight + edge > box) { host.style.height = fit + 'px'; host.style.marginBottom = (box - fit) + 'px'; }
    host.style.setProperty('--sbw', (host.offsetWidth - host.clientWidth) + 'px');
  }
  document.addEventListener('visr:tabchange', function (e) {
    var panel = e.detail && e.detail.panel; if (!panel) return;
    var card = panel.closest('[data-chart]'); if (!card) return;
    var host = card.querySelector('.v-chart-table');
    card.setAttribute('data-view', panel === host ? 'table' : 'chart');   /* CSS drops the keyed notes row in table view */
    if (panel === host) {
      if (!host.hasAttribute('data-built')) { buildTable(card, host); host.setAttribute('data-built', ''); }
      fitTable(host);
      card.querySelectorAll('canvas[data-viz]').forEach(function (cv) { if (live.has(cv) && !cv.hasAttribute('data-chart-pin')) { var c = live.get(cv); setIndex(c, null); var st = state.get(cv); if (st) hideTip(st); } });
      card.querySelectorAll('.v-trellis.is-scrub').forEach(function (t) { t.classList.remove('is-scrub'); });
    } else requestAnimationFrame(function () { card.querySelectorAll('canvas[data-viz]').forEach(refit); });   /* back from the table: the plot was hidden */
  });
  window.addEventListener('resize', function () {
    document.querySelectorAll('[data-chart][data-view="table"] > .v-chart-table').forEach(fitTable);
  });

  function boot() {
    T = tokens(); applyDefaults();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting && !live.has(en.target)) { mount(en.target); io.unobserve(en.target); } });
    }, { rootMargin: '200px' });
    document.querySelectorAll('canvas[data-viz]').forEach(function (c) { io.observe(c); });   /* a hidden panel never intersects until shown */
    new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    if (document.readyState === 'complete') refitAll(); else window.addEventListener('load', refitAll);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitAll);
    /* crossing 64rem changes a trellis (x labels on every panel, tooltip or scrub): its panels are rebuilt */
    if (WIDE.addEventListener) WIDE.addEventListener('change', function () {
      document.querySelectorAll('.v-trellis.is-scrub').forEach(function (t) { t.classList.remove('is-scrub'); });
      Array.from(live.keys()).forEach(function (cv) { if (cv.dataset.size === 'panel') { unmount(cv); mount(cv); } });
    });
  }
  function start() {   /* mount only after the shipped font is ready, so axis ticks are measured in Inter */
    if (document.fonts && document.fonts.load) document.fonts.load('400 12px "Inter Variable"').then(boot, boot); else boot();
  }
  window.VISR = Object.assign(window.VISR || {}, { niceScale: niceScale, durationScale: durationScale });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
