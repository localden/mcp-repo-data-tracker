/* VISR charts.js (design system v4 4.19): Chart.js 4.4.1, no date adapter. The canvas draws marks and axis ticks and nothing else:
   every number is HTML (the readout, the notes row, the tooltip, the table view). Loaded only on pages that render a chart.
   Contract (layouts/partials/ui/chart.html and ui/trellis.html, built by ui/chart-canvas.html):
     <canvas data-viz="line|column" data-unit="count|downloads|hours" data-gran="day|week" data-metric="issues" data-scope="TypeScript SDK"
       data-size="main|panel" data-xaxis="on|off" [data-chart-pin="42"]
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
  function periodText(s, gran) { return gran === 'week' ? F.range({ from: s, to: addDays(s, 6) }).text : F.date({ d: s, weekday: true }).text; }
  function cap1(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function value(unit, v) { return unit === 'downloads' ? F.volume(v).text : unit === 'hours' ? F.dur({ h: v }).text : F.count(v).text; }
  function exact(unit, v) { return unit === 'downloads' ? F.volume(v).exact : unit === 'hours' ? F.dur({ h: v }).text : F.count(v).text; }

  /* Tokens (v4 2.1): the subject series is chart-1, a second series is always context grey; gridlines, axis, gap band, crosshair. */
  function tokens() {
    var cs = getComputedStyle(root);
    function g(n) { return cs.getPropertyValue(n).trim(); }
    return { accent: g('--chart-1') || g('--accent'), context: g('--series-context'), grid: g('--chart-grid') || g('--border-subtle'),
      axis: g('--chart-axis') || g('--border'), gap: g('--gap'), surface: g('--surface'), text3: g('--text-3'), strong: g('--border-strong'),
      hover: g('--hover'), font: getComputedStyle(document.body).fontFamily };
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
  /* X labels: 14 slots or fewer use short dates; otherwise month names at month starts, the year on the first tick and each January,
     at a stride of 1, 2, 3 or 6 months. There is no special last-date tick. */
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
    starts.forEach(function (ix, k) {
      if (k % stride) return;
      var q = parts(labels[ix]);
      out[ix] = k === 0 || q.m === 0 ? MONTHS[q.m] + ' ' + q.y : MONTHS[q.m];
    });
    return out;
  }

  /* Per-series facts: null runs, the end point, isolated points. */
  function analyse(data, gran, leading) {
    var n = data.length, minRun = gran === 'day' ? 3 : 1, reach = gran === 'day' ? 2 : 0;
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
  function vline(c, i, stroke, dash, shift) {
    var a = c.chartArea, ctx = c.ctx, x = Math.round(Math.min(c.scales.x.getPixelForValue(i) + (shift || 0), a.right + 6)) + 0.5;
    ctx.save(); ctx.strokeStyle = stroke; ctx.lineWidth = 1; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
  }
  /* Event markers: 1px border-strong, dashed so one is never read as an axis or a plot edge, keyed in the notes row. In a weekly
     chart the marker sits at its day inside the week's slot, so it does not hide behind that week's point. */
  var marks = { id: 'visrMarks', beforeDatasetsDraw: function (c) {
    var st = S(c); if (!st) return;
    var w = slotW(c);
    st.marks.forEach(function (m) { vline(c, m.i, T.strong, [2, 3], st.kind === 'line' ? m.frac * w : 0); });
  } };
  var avgRule = { id: 'visrAvgRule', beforeDatasetsDraw: function (c) {   /* 1px context rule; its value is a readout item */
    var st = S(c), avg = st && st.spec.avg; if (!avg || avg.value == null) return;
    var a = c.chartArea, y = Math.round(c.scales.y.getPixelForValue(avg.value)) + 0.5, ctx = c.ctx;
    ctx.save(); ctx.strokeStyle = T.context; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke(); ctx.restore();
  } };
  /* The hover mark: a crosshair on a line chart, the hovered slot filled with the hover layer on a column chart (drawn in every
     panel of a trellis, so each shows which week is selected). */
  var crosshair = { id: 'visrCrosshair', beforeDatasetsDraw: function (c) {
    var st = S(c); if (!st || st.index == null) return;
    if (st.kind === 'line') { vline(c, st.index, T.strong); return; }
    var a = c.chartArea, w = slotW(c), x = c.scales.x.getPixelForValue(st.index), ctx = c.ctx;
    var l = Math.max(a.left, Math.round(x - w / 2)), r = Math.min(a.right, Math.round(x + w / 2));
    ctx.save(); ctx.fillStyle = T.hover; ctx.fillRect(l, a.top, r - l, a.bottom - a.top); ctx.restore();
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
  function extent(c, st, x0, x1) {   /* the vertical span of the marks between two x pixels: {top, bottom} */
    var a = c.chartArea, pad = slotW(c), top = a.bottom, bottom = a.top, any = false;
    c.data.datasets.forEach(function (ds, d) {
      var m = c.getDatasetMeta(d); if (m.hidden) return;
      m.data.forEach(function (pt, i) {
        if (ds.data[i] == null || pt.x < x0 - pad || pt.x > x1 + pad) return;
        any = true; if (pt.y < top) top = pt.y; if (pt.y > bottom) bottom = pt.y;
      });
    });
    if (!any) return { top: a.bottom, bottom: a.top };
    return { top: top, bottom: st.kind === 'line' ? bottom : a.bottom };
  }
  function tipRow(list, keyCls, valText, name, isNA) {
    var li = el('li'), key = el('span', 'v-key ' + keyCls), val = el('span', 'v-tip-value', isNA ? '' : valText), nm = el('span', 'v-tip-name', name);
    key.setAttribute('aria-hidden', 'true');
    if (isNA) { var na = el('span', 'v-val is-na'); na.title = 'No data'; na.appendChild(el('span', 'sr-only', 'No data')); val.appendChild(na); }
    li.appendChild(key); li.appendChild(val); li.appendChild(nm); list.appendChild(li);
    return (isNA ? 'No data' : valText) + ' ' + name;
  }
  function showTip(c, st, i, announce) {
    var tip = st.tip;
    if (i == null) { if (tip) tip.hidden = true; if (announce && st.live) st.live.textContent = ''; return; }
    tip = tipEl(c, st);
    tip.textContent = '';
    var spoken = [], label = st.labels[i], keyForm = st.kind === 'line' ? 'is-line' : 'is-bar';
    var title = el('p', 'v-tip-title', periodText(label, st.gran)); tip.appendChild(title); spoken.push(title.textContent);
    var list = el('ul', 'v-tip-rows'), rows = 0, others = siblings(c);
    if (others.length) {   /* trellis: one row per panel, labelled by its scope */
      [c].concat(others).sort(function (a, b) { return a.canvas.compareDocumentPosition(b.canvas) & 4 ? -1 : 1; }).forEach(function (o) {
        var os = S(o), v = os.series[0] ? os.series[0].data[i] : null;
        spoken.push(tipRow(list, keyForm + ' is-accent', v == null ? '' : value(os.unit, v), os.scope || (os.series[0] && os.series[0].label) || '', v == null)); rows++;
      });
    } else if (!inBand(st, i)) {
      st.series.forEach(function (s) {
        var v = s.data[i]; if (v == null && st.single) return;
        var name = st.single ? (v === 1 ? st.metricOne : st.metric) : s.label;
        spoken.push(tipRow(list, keyForm + ' is-' + (s.role === 'context' ? 'context' : 'accent'), v == null ? '' : value(st.unit, v), name, v == null)); rows++;
      });
    }
    if (rows) tip.appendChild(list);
    function note(text) { tip.appendChild(el('p', 'v-tip-note', text)); spoken.push(text); }
    function changeRow(ch, base) {   /* a change is the delta badge and its base, never a typed sentence */
      var row = el('p', 'v-tip-change'), badge = el('span', 'v-delta is-' + (ch.polarity || 'flat'));
      badge.appendChild(el('span', 'sr-only', ch.sr));
      var vis = el('span', '', ch.text); vis.setAttribute('aria-hidden', 'true'); badge.appendChild(vis);
      row.appendChild(badge); row.appendChild(el('span', 'v-base', base)); tip.appendChild(row);
      spoken.push(ch.sr + ' ' + base);
    }
    if (!rows) note('No data');
    if (st.single && !others.length && st.kind === 'column' && st.gran === 'week' && i > 0) {   /* change against the prior week */
      var v0 = st.series[0].data[i], v1 = st.series[0].data[i - 1];
      if (v0 != null && v1 != null) {
        var ch = st.unit === 'downloads' ? F.change({ cur: v0, prev: v1, unit: 'percent', metric: 'downloads' }) : F.change({ cur: v0, prev: v1 });
        if (ch.state !== 'na') changeRow(ch, 'vs prior 7 days');
      }
    }
    tip.hidden = false;
    var host = tip.parentNode, a = c.chartArea, x = c.scales.x.getPixelForValue(i), w = tip.offsetWidth, h = tip.offsetHeight;
    var hb = host.getBoundingClientRect(), cb = c.canvas.getBoundingClientRect(), ox = cb.left - hb.left, oy = cb.top - hb.top, hx = ox + x;
    var sides = [];   /* right of the crosshair first, then left; each only when it fits */
    if (hx + 12 + w <= host.clientWidth) sides.push(hx + 12);
    if (hx - 12 - w >= 0) sides.push(hx - 12 - w);
    if (!sides.length) sides.push(Math.max(0, Math.min(host.clientWidth - w, hx + 12)));
    var left = sides[0], top = oy + a.top;
    if (others.length) {   /* trellis: the top of the first panel */
      var firstCv = [c].concat(others).map(function (o) { return o.canvas; }).sort(function (p, q) { return p.compareDocumentPosition(q) & 4 ? -1 : 1; })[0];
      var fc = live.get(firstCv);
      top = firstCv.getBoundingClientRect().top - hb.top + (fc && fc.chartArea ? fc.chartArea.top : 0);
    } else {
      var best = null;
      sides.forEach(function (sx) {
        if (best && best.free) return;
        var e = extent(c, st, sx - ox, sx - ox + w), cand;
        if (a.top + h + 8 <= e.top) cand = { left: sx, top: oy + a.top, free: true, room: e.top };
        else if (a.bottom - h - 8 >= e.bottom && a.bottom - h - 8 >= a.top) cand = { left: sx, top: oy + a.bottom - h - 8, free: true, room: e.top };
        else cand = { left: sx, top: oy + a.top, free: false, room: e.top };
        if (!best || cand.free || cand.room > best.room) best = cand;
      });
      left = best.left; top = best.top;
    }
    tip.style.left = Math.round(left) + 'px'; tip.style.top = Math.round(top) + 'px';
    if (announce && st.live) st.live.textContent = spoken.join('. ');
  }

  function build(canvas) {
    var kind = canvas.dataset.viz === 'column' ? 'column' : 'line', unit = canvas.dataset.unit || 'count', gran = canvas.dataset.gran === 'week' ? 'week' : 'day';
    var panel = canvas.dataset.size === 'panel', xaxis = canvas.dataset.xaxis !== 'off';
    var spec = JSON.parse(canvas.dataset.series), labels = spec.labels || [], series = (spec.series || []).slice(0, 2);
    var line = kind === 'line', single = series.length === 1;
    var info = series.map(function (s) { return analyse(s.data, gran, panel); });
    var bands = !info.length ? [] : info.length < 2 ? mergeRuns(info[0].runs.slice()) : intersectRuns(info.map(function (x) { return x.runs; }), gran === 'day' ? 3 : 1);
    var datasets = series.map(function (s, i) {
      var c = color(s.role), a = info[i], order = s.role === 'context' ? 2 : 1;
      if (line) return { label: s.label, data: s.data, order: order, borderColor: c, backgroundColor: c, fill: false, spanGaps: gran === 'day' ? 3 : false,
        pointRadius: a.radius, pointHoverRadius: 4, pointHitRadius: 0, pointBackgroundColor: c, pointBorderColor: T.surface, pointBorderWidth: 2,
        pointHoverBackgroundColor: c, pointHoverBorderColor: T.surface, pointHoverBorderWidth: 2 };
      return { label: s.label, data: s.data, order: order, backgroundColor: c, hoverBackgroundColor: c, borderWidth: 0, borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: false };
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
      metric: canvas.dataset.metric || '', metricOne: spec.metricOne || canvas.dataset.metric || '' });
    return {
      type: line ? 'line' : 'bar',
      data: { labels: labels, datasets: datasets },
      plugins: [gapBand, marks, avgRule, crosshair, hover],
      options: {
        layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } },
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

  function mount(canvas) {
    try {
      var c = new Chart(canvas, build(canvas)); live.set(canvas, c);
      var pin = canvas.getAttribute('data-chart-pin');
      if (pin !== null && pin !== '') { select(c, Math.max(0, Math.min(c.data.labels.length - 1, parseInt(pin, 10) || 0)), false); c.render(); }
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
     figure in title. A daily series over 90 days is shown as week ranges. A gap is one ordinary row: the range in the date cell,
     the empty mark in each value cell. A trellis row that cannot draw keeps its column. */
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
  function naCell(td) { var s = el('span', 'v-val is-na'); s.title = 'No data'; s.appendChild(el('span', 'sr-only', 'No data')); td.appendChild(s); }
  function buildTable(card, host) {
    var canvases = Array.prototype.slice.call(card.querySelectorAll('canvas[data-viz]')); if (!canvases.length) return;
    var first = canvases[0], spec0 = JSON.parse(first.dataset.series), gran = first.dataset.gran === 'week' ? 'week' : 'day', flow = first.dataset.viz === 'column';
    var labels = spec0.labels || [], cols = [], trellis = card.hasAttribute('data-trellis');
    /* a trellis row that cannot draw still has its column (ui/trellis.html puts its name and series on the pending line) */
    var sources = trellis ? Array.prototype.slice.call(card.querySelectorAll('canvas[data-viz], [data-pending-col]')) : canvases;
    sources.forEach(function (cv) {
      var spec = cv === first ? spec0 : JSON.parse(cv.getAttribute('data-series') || '{}'), unit = cv.getAttribute('data-unit') || 'count', ser = spec.series || [];
      if (trellis) cols.push({ label: cv.getAttribute('data-scope') || cv.getAttribute('data-pending-col') || (ser[0] && ser[0].label) || '', unit: unit, data: ser[0] ? ser[0].data : [] });
      else ser.slice(0, 2).forEach(function (s) { cols.push({ label: (ser.length === 1 ? cap1(cv.dataset.metric || s.label) : s.label), unit: unit, data: s.data }); });
    });
    var gapTitle = first.getAttribute('data-gap-title') || '';
    var g = gran;
    if (gran === 'day' && labels.length > 90) { var wk = toWeekly(labels, cols, flow); labels = wk.labels; cols = wk.cols; g = 'week'; }
    var change = cols.length === 1;
    var tbl = el('table', 'v-dt is-compact'), cap = tbl.createCaption(); cap.className = 'sr-only';
    cap.textContent = cap1(first.dataset.metric || '') + (trellis ? '' : (first.dataset.scope ? ', ' + first.dataset.scope : ''));
    var hr = tbl.createTHead().insertRow();
    function th(text, num) { var h = el('th', num ? 'num' : '', text); h.scope = 'col'; hr.appendChild(h); }
    th(g === 'week' ? 'Week' : 'Date', false);
    cols.forEach(function (c) { th(c.label, true); });
    if (change) th('Change', true);
    var tb = tbl.createTBody();
    function empty(i) { return cols.every(function (c) { return c.data[i] == null; }); }
    /* slots before the first measured one are not rows: nothing was tracked yet */
    var firstData = 0; while (firstData < labels.length && empty(firstData)) firstData++;
    var i = labels.length - 1;
    function gapCells(r) { for (var k = 0; k < cols.length + (change ? 1 : 0); k++) { var c = r.insertCell(); c.className = 'num'; naCell(c); } }
    while (i >= firstData) {
      var r = tb.insertRow(), h = el('th'); h.scope = 'row'; r.appendChild(h);
      if (empty(i)) {
        var j = i; while (j > firstData && empty(j - 1)) j--;
        h.textContent = F.range({ from: labels[j], to: periodEnd(labels[i], g) }).text;
        if (gapTitle) h.title = gapTitle;   /* the row keeps its bins; the title names the outage's own dates */
        gapCells(r);
        i = j - 1;
      } else {
        h.textContent = g === 'week' ? F.range({ from: labels[i], to: addDays(labels[i], 6) }).text : F.date({ d: labels[i] }).text;
        cols.forEach(function (c) {
          var td = r.insertCell(); td.className = 'num';
          if (c.data[i] == null) { naCell(td); return; }
          /* one format per kind here too: a volume prints as on every other surface ("88.2M"), the exact figure in its title */
          var s = el('span', 'v-val', value(c.unit, c.data[i])), ex = exact(c.unit, c.data[i]);
          if (c.unit === 'downloads' && ex !== s.textContent) s.title = F.volume(c.data[i]).long;
          s.setAttribute('data-kind', c.unit === 'downloads' ? 'volume' : c.unit === 'hours' ? 'dur' : 'count'); td.appendChild(s);
        });
        if (change) {
          var td = r.insertCell(), prev = i > 0 ? cols[0].data[i - 1] : null, cur = cols[0].data[i]; td.className = 'num';
          var ch = prev == null || cur == null ? null : cols[0].unit === 'downloads' ? F.change({ cur: cur, prev: prev, unit: 'percent', metric: 'downloads' })
            : cols[0].unit === 'hours' ? F.change({ cur: cur, prev: prev, unit: 'hours' }) : F.change({ cur: cur, prev: prev });
          if (!ch || ch.state === 'na') { var m = el('span', 'v-val is-na'); m.title = 'No baseline'; m.appendChild(el('span', 'sr-only', 'No baseline')); td.appendChild(m); }
          else { var d = el('span', 'v-delta is-' + (ch.polarity || 'flat')); d.appendChild(el('span', 'sr-only', ch.sr)); var vis = el('span', '', ch.text); vis.setAttribute('aria-hidden', 'true'); d.appendChild(vis); td.appendChild(d); }
        }
        i--;
      }
    }
    host.setAttribute('aria-label', cap1(first.dataset.metric || '') + ' table');
    host.appendChild(tbl);
    function clip() { host.classList.toggle('is-clipped', host.scrollTop + host.clientHeight < host.scrollHeight - 1); }
    host.addEventListener('scroll', clip, { passive: true });
    host._clip = clip;
  }
  document.addEventListener('visr:tabchange', function (e) {
    var panel = e.detail && e.detail.panel; if (!panel) return;
    var card = panel.closest('[data-chart]'); if (!card) return;
    var host = card.querySelector('.v-chart-table');
    card.setAttribute('data-view', panel === host ? 'table' : 'chart');   /* CSS drops the keyed notes row in table view */
    if (panel === host) {
      if (!host.hasAttribute('data-built')) { buildTable(card, host); host.setAttribute('data-built', ''); }
      if (host._clip) host._clip();
      card.querySelectorAll('canvas[data-viz]').forEach(function (cv) { if (live.has(cv) && !cv.hasAttribute('data-chart-pin')) { var c = live.get(cv); setIndex(c, null); var st = state.get(cv); if (st) hideTip(st); } });
    }
  });

  function boot() {
    T = tokens(); applyDefaults();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting && !live.has(en.target)) { mount(en.target); io.unobserve(en.target); } });
    }, { rootMargin: '200px' });
    document.querySelectorAll('canvas[data-viz]').forEach(function (c) { io.observe(c); });   /* a hidden panel never intersects until shown */
    new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function start() {   /* mount only after the shipped font is ready, so axis ticks are measured in Inter */
    if (document.fonts && document.fonts.load) document.fonts.load('400 12px "Inter Variable"').then(boot, boot); else boot();
  }
  window.VISR = Object.assign(window.VISR || {}, { niceScale: niceScale, durationScale: durationScale });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
