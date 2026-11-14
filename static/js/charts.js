/* VISR charts.js: Chart.js 4.4.1, no date adapter. Reads design tokens from CSS, mounts visible canvases lazily, re-themes on toggle.
   Contract (emitted by layouts/partials/ui/chart.html, brief §5.11):
     <canvas data-viz="line|column|stack" data-unit="count|downloads|hours|percent" data-metric="open issues" data-scope="TypeScript SDK"
       data-gran="day|week|month" data-agg="last|sum"
       data-series='{"labels":[every date],"series":[{"label":"…","role":"accent|series-N|spark|other|seg-neutral|ord-N","data":[n|null]}],
         "outage":["YYYY-MM-DD","YYYY-MM-DD"],"reconstructed":["from","to"]|null,"metricOne":"open issue",
         "avg":{"value":n,"label":"12-wk avg 22.8"}|null,"capLabel":false,"ticks":"auto|all","fill":true}'>
   Card hooks: [data-chart] card, [data-chart-toggle] Table button (aria-controls = table host), [data-chart-live] sr-only mirror,
   [data-chart-legend] HTML legend. Every data string goes into the DOM through textContent. */
(function () {
  'use strict';
  if (!window.Chart) return;
  var root = document.documentElement, T = null, live = new Map(), state = new Map();
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var cf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
  var cf3 = new Intl.NumberFormat('en-US', { notation: 'compact', minimumSignificantDigits: 3, maximumSignificantDigits: 3 });
  var mctx = document.createElement('canvas').getContext('2d');   /* text measuring for end-label padding */
  function fix(n, d) { return String(Number(n.toFixed(d))); }
  var FMT = {   /* mirrors layouts/partials/ui/{num,dur,pct}.html (brief §6.3) */
    number: function (v) { return v == null ? '—' : Math.abs(v) >= 1e3 ? cf.format(v) : nf.format(v); },   /* axes: compact from 1,000 */
    count: function (v) { return v == null ? '—' : Math.abs(v) >= 1e4 ? cf.format(v) : nf.format(v); },    /* tiles, tooltips */
    downloads: function (v) { return v == null ? '—' : Math.abs(v) >= 1e3 ? cf3.format(v) : nf.format(v); }, /* 3 significant figures */
    full: function (v) { return v == null ? '—' : nf.format(v); },                                           /* table view */
    hours: function (h) {
      if (h == null) return '—'; var a = Math.abs(h), s = h < 0 ? '−' : '';
      if (a < 1) return '<1h'; if (a < 10) return s + fix(a, 1) + 'h'; if (a < 48) return s + Math.round(a) + 'h';
      var d = a / 24; return s + (d < 10 ? fix(d, 1) : String(Math.round(d))) + 'd';
    },
    percent: function (v) { if (v == null) return '—'; var a = Math.abs(v); return (a > 0 && a < 0.1 ? '<0.1' : a < 10 ? fix(v, 1) : String(Math.round(v))) + '%'; }
  };
  function valueFmt(unit) { return unit === 'hours' ? FMT.hours : unit === 'percent' ? FMT.percent : unit === 'downloads' ? FMT.downloads : FMT.count; }

  /* Dates are "YYYY-MM-DD" strings, read as UTC calendar days. */
  function parts(s) { var p = String(s).split('-'); return { y: +p[0], m: +p[1] - 1, d: +(p[2] || 1) }; }
  function utc(s) { var p = parts(s); return new Date(Date.UTC(p.y, p.m, p.d)); }
  function shortDate(s) { var p = parts(s); return MONTHS[p.m] + ' ' + p.d; }
  function longDate(s) { var p = parts(s); return MONTHS[p.m] + ' ' + p.d + ', ' + p.y; }
  function monthYear(s) { var p = parts(s); return MONTHS[p.m] + ' ' + p.y; }
  function addDays(s, n) { var t = utc(s); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function periodEnd(s, gran) {
    if (gran === 'week') return addDays(s, 6);
    if (gran === 'month') { var p = parts(s); return new Date(Date.UTC(p.y, p.m + 1, 0)).toISOString().slice(0, 10); }
    return s;
  }
  function dateRange(a, b) {   /* "Nov 6–12, 2026", "Oct 8 – Nov 9, 2026", "Dec 30, 2025 – Jan 4, 2026" */
    if (a === b) return longDate(a); var p = parts(a), q = parts(b);
    if (p.y !== q.y) return longDate(a) + ' – ' + longDate(b);
    if (p.m === q.m) return MONTHS[p.m] + ' ' + p.d + '–' + q.d + ', ' + p.y;
    return shortDate(a) + ' – ' + longDate(b);
  }
  function periodTitle(s, gran) {   /* §5.7 */
    if (gran === 'week') return 'Week of ' + longDate(s);
    if (gran === 'month') return monthYear(s);
    return WEEKDAYS[utc(s).getUTCDay()] + ', ' + longDate(s);
  }
  var wkCache = {};
  function weekStart(s) { if (!wkCache[s]) wkCache[s] = addDays(s, -((utc(s).getUTCDay() + 6) % 7)); return wkCache[s]; }
  function cap1(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function tokens() {
    var cs = getComputedStyle(root);
    function g(n, fb) { var v = cs.getPropertyValue(n).trim(); return v || (fb ? cs.getPropertyValue(fb).trim() : ''); }
    var t = { surface: g('--surface', '--color-base-100'), ink: g('--ink', '--color-base-content'), muted: g('--muted', '--ink-3'),
      line: g('--line'), strong: g('--line-strong', '--axis'), gap: g('--gap'), font: getComputedStyle(document.body).fontFamily, roles: {} };
    if (!t.gap) t.gap = t.line;
    t.roles.accent = g('--chart-1'); t.roles.spark = g('--spark'); t.roles.other = g('--other'); t.roles['seg-neutral'] = g('--seg-neutral', '--other');
    for (var i = 1; i <= 8; i++) t.roles['series-' + i] = g('--chart-' + i);
    for (var j = 1; j <= 5; j++) t.roles['ord-' + j] = g('--ord-' + j);
    return t;
  }
  function color(role) { return T.roles[role] || T.roles.accent; }
  function hoverColor(role, c) { return role === 'accent' || role === 'series-1' ? (T.roles['ord-4'] || c) : c; }   /* next ord step of the blue */
  function wash(c) { return /^#[0-9a-f]{6}$/i.test(c) ? c + '1a' : 'color-mix(in srgb, ' + c + ' 10%, transparent)'; }   /* 10% */

  function applyDefaults() {
    var d = Chart.defaults;
    d.font.family = T.font; d.font.size = 12; d.color = T.muted; d.borderColor = T.line;
    d.responsive = true; d.maintainAspectRatio = false; d.animation = false;
    d.interaction.mode = 'visrIndex'; d.interaction.intersect = false;
    Object.assign(d.elements.line, { borderWidth: 2, tension: 0, borderCapStyle: 'round', borderJoinStyle: 'round' });
    Object.assign(d.elements.point, { radius: 0, hoverRadius: 4, hitRadius: 0, hoverBorderWidth: 2 });
    /* Chart.js 4 reads bar sizing from the dataset defaults, not elements.bar. */
    if (d.datasets.bar) Object.assign(d.datasets.bar, { maxBarThickness: 24, categoryPercentage: 0.7, barPercentage: 0.9 });
    d.plugins.legend.display = false;    /* the HTML legend above the plot (§5.8) */
    d.plugins.tooltip.enabled = false;   /* the external HTML tooltip below (§5.7) */
  }

  /* Axes (§5.2) */
  function niceScale(max, integer) {   /* step ∈ {1, 2, 2.5, 5} × 10ⁿ, k ∈ {3, 4, 5}: the smallest step × k above max (1% headroom) */
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
  function durationScale(maxH) {   /* hours below 72h, else days; ticks print whole units */
    var target = Math.max(+maxH || 0, 0) * 1.01, hours = maxH < 72, u = hours ? 1 : 24, best = null;
    if (!(target > 0)) target = 1;
    (hours ? [1, 2, 4, 6, 12, 24] : [1, 2, 5, 7, 14, 30, 60, 90, 180]).forEach(function (s) {
      [3, 4, 5].forEach(function (k) { var top = s * u * k; if (top >= target && (!best || top < best.max)) best = { max: top, step: s * u }; });
    });
    if (!best) { var n = niceScale(target / 24 / 1.01, true); best = { max: n.max * 24, step: n.step * 24 }; }
    best.u = u; best.unit = hours ? 'h' : 'd';
    return best;
  }
  function textWidth(t) { mctx.font = '12px ' + T.font; return mctx.measureText(t).width; }
  /* x labels: month names at month boundaries (with the year on the first one and on January), always the last label, first and
     last only for 21 days or less; "all" puts a label on every bar that fits. Overlaps are dropped, the last label wins. */
  function xTicks(scale, labels, gran, mode) {
    var n = labels.length, out = {}, last = n - 1; if (!n) return out;
    var w = scale.width || 600, slot = w / Math.max(1, scale.options.offset ? n : n - 1);
    out[last] = gran === 'month' ? monthYear(labels[last]) : shortDate(labels[last]);
    var lastW = textWidth(out[last]), i;
    if (mode === 'all') {
      var every = Math.max(1, Math.ceil((lastW + 12) / slot));
      for (i = last - every; i >= 0; i -= every) out[i] = shortDate(labels[i]);
      return out;
    }
    if (gran === 'day' && n <= 21) { if (last > 0 && last * slot >= lastW + 12) out[0] = shortDate(labels[0]); return out; }
    var prevX = -Infinity, prevW = 0, first = true;
    for (i = 0; i < last; i++) {
      var p = parts(labels[i]);
      var boundary = i === 0 ? (gran === 'day' ? p.d === 1 : gran === 'week' ? p.d <= 7 : true) : parts(labels[i - 1]).m !== p.m;
      if (!boundary) continue;
      var text = first || p.m === 0 ? MONTHS[p.m] + ' ' + p.y : MONTHS[p.m], x = i * slot, tw = textWidth(text);
      if (x - prevX < (prevW + tw) / 2 + 12 || last * slot - x < (lastW + tw) / 2 + 12) continue;
      out[i] = text; prevX = x; prevW = tw; first = false;
    }
    return out;
  }

  /* Per-series facts: null runs (gap bands), end point, isolated points, fill eligibility (§5.3). */
  function analyse(data, gran) {
    var n = data.length, minRun = gran === 'day' ? 3 : 1, reach = gran === 'day' ? 3 : 1;
    var first = -1, last = -1, runs = [], s = -1, segs = [], seg = 0, prev = -1, i;
    for (i = 0; i < n; i++) {
      if (data[i] != null) {
        if (first < 0) first = i;
        if (s >= 0 && i - s >= minRun) runs.push([s, i - 1]);
        s = -1;
        if (prev >= 0 && i - prev > reach) { segs.push(seg); seg = 0; }
        seg++; prev = i; last = i;
      } else if (first >= 0 && s < 0) s = i;
    }
    if (s >= 0 && n - s >= minRun) runs.push([s, n - 1]);
    if (seg) segs.push(seg);
    var radius = data.map(function (v, k) {
      if (v == null) return 0; if (k === last) return 4;
      for (var j = 1; j <= reach; j++) if (data[k - j] != null || data[k + j] != null) return 0;
      return 4;   /* isolated: nothing within spanGaps reach on either side */
    });
    return { first: first, last: last, runs: runs, radius: radius, shortSeg: segs.some(function (c) { return c < 7; }) };
  }
  function mergeRuns(runs) {
    runs.sort(function (a, b) { return a[0] - b[0]; });
    var out = [];
    runs.forEach(function (r) { var p = out[out.length - 1]; if (p && r[0] <= p[1] + 1) p[1] = Math.max(p[1], r[1]); else out.push([r[0], r[1]]); });
    return out;
  }
  function bandText(st, b) {
    var from = st.labels[b[0]], to = periodEnd(st.labels[b[1]], st.gran), o = st.spec.outage;
    if (o && o.length === 2 && from <= o[1] && to >= o[0]) return 'No data · ' + dateRange(o[0], o[1]) + ' (collection outage)';
    return 'No data · ' + dateRange(from, to);
  }

  /* Plugins (§5.11-3). State lives in a Map keyed by canvas, set before the chart is constructed. */
  function S(c) { return state.get(c.canvas); }
  var gapBand = { id: 'visrGapBand', beforeDatasetsDraw: function (c) {
    var st = S(c); if (!st || !st.bands.length) return;
    var a = c.chartArea, x = c.scales.x, ctx = c.ctx, n = st.labels.length;
    var half = n > 1 ? Math.abs(x.getPixelForValue(1) - x.getPixelForValue(0)) / 2 : a.width / 2;
    ctx.save();
    st.bands.forEach(function (b) {
      var l = Math.max(a.left, x.getPixelForValue(b[0]) - half), r = Math.min(a.right, x.getPixelForValue(b[1]) + half);
      if (r <= l) return;
      ctx.fillStyle = T.gap; ctx.fillRect(l, a.top, r - l, a.bottom - a.top);
      if (r - l >= 40) {
        ctx.fillStyle = T.muted; ctx.font = '12px ' + T.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('No data', (l + r) / 2, (a.top + a.bottom) / 2);
      }
    });
    ctx.restore();
  } };
  var crosshair = { id: 'visrCrosshair', beforeDatasetsDraw: function (c) {   /* lines only; bars are their own hit target */
    var st = S(c); if (!st || st.index == null || st.kind !== 'line') return;
    var x = Math.round(c.scales.x.getPixelForValue(st.index)) + 0.5, a = c.chartArea, ctx = c.ctx;
    ctx.save(); ctx.strokeStyle = T.strong; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
  } };
  var endLabel = { id: 'visrEndLabel', afterDatasetsDraw: function (c) {   /* last non-null value, right of the end dot (§5.8) */
    var st = S(c); if (!st || st.kind !== 'line') return;
    var ctx = c.ctx, placed = [];
    ctx.save(); ctx.font = '12px ' + T.font; ctx.fillStyle = T.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    st.info.forEach(function (inf, d) {
      var meta = c.getDatasetMeta(d), el = inf.last >= 0 && meta.data[inf.last]; if (!el || meta.hidden) return;
      if (placed.some(function (y) { return Math.abs(y - el.y) < 14; })) return;   /* colliding labels fall back to legend + tooltip */
      placed.push(el.y); ctx.fillText(st.endText[d], el.x + 8, el.y);
    });
    ctx.restore();
  } };
  var capLabel = { id: 'visrCapLabel', afterDatasetsDraw: function (c) {   /* value on the latest column's cap */
    var st = S(c); if (!st || !st.spec.capLabel || st.kind === 'line') return;
    var inf = st.info[0], el = inf && inf.last >= 0 && c.getDatasetMeta(0).data[inf.last]; if (!el) return;
    var ctx = c.ctx; ctx.save(); ctx.font = '12px ' + T.font; ctx.fillStyle = T.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(st.endText[0], el.x, el.y - 4); ctx.restore();
  } };
  var avgRule = { id: 'visrAvgRule', afterDatasetsDraw: function (c) {   /* 1px --line-strong rule, labeled (commits, §5.1) */
    var st = S(c), avg = st && st.spec.avg; if (!avg || avg.value == null) return;
    var a = c.chartArea, y = Math.round(c.scales.y.getPixelForValue(avg.value)) + 0.5, ctx = c.ctx, label = String(avg.label || '');
    ctx.save(); ctx.strokeStyle = T.strong; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
    if (label) {
      ctx.font = '12px ' + T.font; var w = ctx.measureText(label).width;
      ctx.fillStyle = T.surface; ctx.fillRect(a.left, y - 18, w + 8, 16);
      ctx.fillStyle = T.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(label, a.left + 4, y - 3);
    }
    ctx.restore();
  } };

  /* Hover and keyboard share one index (§5.7). */
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
    var st = S(c), e = args.event; if (!st) return;
    var i = e.type !== 'mouseout' && args.inChartArea ? indexAt(c, e.x) : null;
    if (i !== st.index) { select(c, i, false); args.changed = true; }
  } };
  function select(c, i, announce) {
    var st = S(c); if (!st) return;
    st.index = i;
    c.setActiveElements(i == null ? [] : elementsAt(c, i));
    showTip(c, st, i, announce);
  }

  /* External HTML tooltip: --surface-raised card built with textContent, above the hovered x, flipped below when it would leave the plot. */
  function showTip(c, st, i, announce) {
    var box = c.canvas.parentNode, el = st.tip;
    if (i == null) { if (el) el.hidden = true; if (announce && st.live) st.live.textContent = ''; return; }
    if (!el) { el = st.tip = document.createElement('div'); el.className = 'v-tip'; el.setAttribute('aria-hidden', 'true'); box.appendChild(el); }
    el.textContent = '';
    var spoken = [], label = st.labels[i], band = null, total = 0, shown = 0;
    st.bands.forEach(function (b) { if (i >= b[0] && i <= b[1]) band = b; });
    var head = document.createElement('p'); head.className = 'v-tip-title'; head.textContent = periodTitle(label, st.gran); el.appendChild(head);
    spoken.push(head.textContent);
    var list = document.createElement('ul'); list.className = 'v-tip-rows';
    st.series.forEach(function (s, d) {
      var v = s.data[i]; if (v == null) return;
      total += v; shown++;
      var li = document.createElement('li'), key = document.createElement('span'), val = document.createElement('span'), noun = document.createElement('span');
      key.className = 'v-tip-key ' + (st.kind === 'line' ? 'is-line' : 'is-bar'); key.style.backgroundColor = color(s.role);
      val.className = 'v-tip-value'; val.textContent = st.f(v);
      noun.className = 'v-tip-noun'; noun.textContent = st.single ? (v === 1 ? st.metricOne : st.metric) : s.label;
      li.appendChild(key); li.appendChild(val); li.appendChild(document.createTextNode(' ')); li.appendChild(noun); list.appendChild(li);
      spoken.push(val.textContent + ' ' + noun.textContent);
    });
    if (shown) el.appendChild(list);
    function note(text) { var p = document.createElement('p'); p.className = 'v-tip-note'; p.textContent = text; el.appendChild(p); spoken.push(text); }
    if (st.kind === 'stack' && shown > 1) note('Total ' + st.f(total));
    if (st.unit === 'downloads' && st.single && st.gran === 'week') {   /* "+1.7% vs prior week" */
      var v0 = st.series[0].data[i], v1 = i > 0 ? st.series[0].data[i - 1] : null;
      if (v0 != null && v1 != null && v1 > 0) { var pc = (v0 - v1) / v1 * 100; note((pc > 0 ? '+' : pc < 0 ? '−' : '±') + FMT.percent(Math.abs(pc)) + ' vs prior week'); }
    }
    if (band) note(bandText(st, band));
    el.hidden = false;
    var a = c.chartArea, x = c.scales.x.getPixelForValue(i), act = elementsAt(c, i), y = a.top;
    if (act.length) y = Math.min.apply(null, act.map(function (e) { return e.element.y; }));
    var w = el.offsetWidth, h = el.offsetHeight, left = Math.min(Math.max(x - w / 2, a.left), box.clientWidth - w), top = y - h - 12;
    if (left < 0) left = 0;
    if (top < 0) top = y + 12;
    el.style.left = Math.round(left) + 'px'; el.style.top = Math.round(top) + 'px';
    if (announce && st.live) st.live.textContent = spoken.join('. ');
  }

  function build(canvas) {
    var kind = canvas.dataset.viz || 'line', unit = canvas.dataset.unit || 'count', gran = canvas.dataset.gran || 'day';
    var spec = JSON.parse(canvas.dataset.series), labels = spec.labels || [], series = spec.series || [];
    var line = kind === 'line', stack = kind === 'stack', single = series.length === 1, f = valueFmt(unit);
    var info = series.map(function (s) { return analyse(s.data, gran); });
    var bands = mergeRuns([].concat.apply([], info.map(function (x) { return x.runs; })));
    var datasets = series.map(function (s, i) {
      var role = s.role || (i ? 'series-2' : 'accent'), c = color(role), a = info[i];
      if (line) {
        var fill = single && spec.fill !== false && !a.runs.length && !a.shortSeg;   /* §5.3: no wash over gaps or short segments */
        return { label: s.label, data: s.data, borderColor: c, backgroundColor: fill ? wash(c) : c, fill: fill ? 'origin' : false,
          spanGaps: gran === 'day' ? 3 : false, pointRadius: a.radius, pointHoverRadius: 4, pointHitRadius: 0,
          pointBackgroundColor: c, pointBorderColor: T.surface, pointBorderWidth: 2,
          pointHoverBackgroundColor: c, pointHoverBorderColor: T.surface, pointHoverBorderWidth: 2 };
      }
      var ds = { label: s.label, data: s.data, backgroundColor: c, hoverBackgroundColor: hoverColor(role, c), borderWidth: 0, borderRadius: 4, borderSkipped: 'start' };
      if (stack) {   /* 2px surface gap between stacked segments; rounded data end on the top segment only */
        ds.stack = 'all'; ds.borderSkipped = false; ds.borderColor = T.surface; ds.hoverBorderColor = T.surface;
        ds.borderWidth = i ? { bottom: 2 } : 0; ds.borderRadius = i === series.length - 1 ? { topLeft: 4, topRight: 4 } : 0;
      }
      return ds;
    });

    var max = 0;
    if (stack) labels.forEach(function (_, x) { var t = 0; series.forEach(function (s) { t += s.data[x] || 0; }); if (t > max) max = t; });
    else series.forEach(function (s) { s.data.forEach(function (v) { if (v != null && v > max) max = v; }); });
    if (spec.avg && spec.avg.value > max) max = spec.avg.value;
    var sc = unit === 'hours' ? durationScale(max) : niceScale(max, unit !== 'percent');
    var tick = unit === 'hours' ? function (v) { return v === 0 ? '0' : Math.round(v / sc.u) + sc.unit; }
      : unit === 'percent' ? function (v) { return v === 0 ? '0' : FMT.percent(v); }
      : sc.max >= 1000 ? function (v) { return v === 0 ? '0' : cf.format(v); }   /* one format per axis */
      : function (v) { return nf.format(v); };

    var endText = series.map(function (s, i) { var l = info[i].last; return l < 0 ? '' : f(s.data[l]); });
    var padRight = 4;
    if (line) { var tw = 0; endText.forEach(function (t) { tw = Math.max(tw, textWidth(t)); }); padRight = Math.max(36, Math.ceil(tw) + 12); }
    var host = canvas.closest('[data-chart]');
    state.set(canvas, { kind: kind, unit: unit, gran: gran, spec: spec, labels: labels, series: series, info: info, bands: bands,
      endText: endText, f: f, single: single, index: null, tip: null, live: host && host.querySelector('[data-chart-live]'),
      metric: canvas.dataset.metric || '', metricOne: spec.metricOne || canvas.dataset.metric || '' });
    var all = spec.ticks === 'all';
    return {
      type: line ? 'line' : 'bar',
      data: { labels: labels, datasets: datasets },
      plugins: [gapBand, crosshair, endLabel, capLabel, avgRule, hover],
      options: {
        layout: { padding: { top: spec.capLabel ? 20 : 8, right: padRight } },
        interaction: { mode: 'visrIndex', intersect: false },
        hover: { mode: 'visrIndex', intersect: false },
        scales: {
          x: { type: 'category', stacked: stack, offset: !line, border: { color: T.line },
               grid: { display: all, drawOnChartArea: false, drawTicks: true, tickLength: 4, color: T.line },
               /* every label is a tick (no autoSkip, no maxTicksLimit thinning of tick marks); '' keeps the tick, hides the text */
               ticks: { autoSkip: false, maxTicksLimit: labels.length + 1, maxRotation: 0, color: T.muted, padding: 4,
                        callback: function (v, i) { if (i === 0 || !this._visr) this._visr = xTicks(this, labels, gran, spec.ticks); var t = this._visr[i]; return t == null ? '' : t; } } },
          y: { stacked: stack, min: 0, max: sc.max, beginAtZero: true, border: { display: false }, grid: { color: T.line, drawTicks: false },
               ticks: { stepSize: sc.step, autoSkip: false, color: T.muted, padding: 8, callback: tick },
               afterFit: function (s) { s.width = 44; } }   /* plots in one row share a left edge */
        }
      }
    };
  }

  function mount(canvas) {
    try { live.set(canvas, new Chart(canvas, build(canvas))); } catch (e) { state.delete(canvas); console.error('VISR chart failed', canvas.id, e); }
  }
  function unmount(canvas) {
    var c = live.get(canvas), st = state.get(canvas);
    if (st && st.tip) st.tip.remove();
    if (c) c.destroy();
    live.delete(canvas); state.delete(canvas);
  }
  function retheme() {
    T = tokens(); applyDefaults();
    // Copy first: Map#forEach visits keys re-added during iteration, so re-mounting in place loops forever.
    Array.from(live.keys()).forEach(function (cv) { unmount(cv); mount(cv); });
  }

  /* Keyboard (§5.7): ArrowLeft/Right step, Home/End jump, Escape clears; the sr-only live region mirrors the tooltip. */
  document.addEventListener('keydown', function (e) {
    var cv = e.target; if (!cv || cv.tagName !== 'CANVAS' || !live.has(cv)) return;
    var c = live.get(cv), st = state.get(cv), n = st.labels.length, i = st.index, k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      var dir = k === 'ArrowRight' ? 1 : -1, lastData = Math.max.apply(null, st.info.map(function (x) { return x.last; }));
      i = i == null ? (lastData >= 0 ? lastData : n - 1) : Math.max(0, Math.min(n - 1, i + dir));
    } else if (k === 'Home') i = 0;
    else if (k === 'End') i = n - 1;
    else if (k === 'Escape' && i != null) i = null;
    else return;
    e.preventDefault(); select(c, i, true); c.render();
  });
  document.addEventListener('focusout', function (e) {
    var cv = e.target; if (!cv || cv.tagName !== 'CANVAS' || !live.has(cv)) return;
    var c = live.get(cv); if (state.get(cv).index != null) { select(c, null, true); c.render(); }
  });

  /* Table view (§5.9): replaces the plot in place; newest first, null runs collapsed, 12 rows then "Show all". */
  function toWeekly(labels, series, agg) {
    var keys = [], at = {}, size = {};
    labels.forEach(function (l) { var k = weekStart(l); if (!(k in at)) { at[k] = keys.length; keys.push(k); size[k] = 0; } size[k]++; });
    var keep = keys.map(function (k) { return agg !== 'sum' || size[k] === 7; });   /* flows: complete weeks only */
    return { labels: keys.filter(function (_, j) { return keep[j]; }), series: series.map(function (s) {
      var bins = keys.map(function () { return { sum: 0, n: 0, last: null }; });
      s.data.forEach(function (v, i) { if (v == null) return; var b = bins[at[weekStart(labels[i])]]; b.sum += v; b.n++; b.last = v; });
      var data = bins.map(function (b) { return agg === 'sum' ? (b.n === 7 ? b.sum : null) : b.last; });
      return { label: s.label, role: s.role, data: data.filter(function (_, j) { return keep[j]; }) };
    }) };
  }
  function na(td) { td.textContent = '—'; var s = document.createElement('span'); s.className = 'sr-only'; s.textContent = 'no data'; td.appendChild(s); }
  function buildTable(cv, host) {
    var spec = JSON.parse(cv.dataset.series), unit = cv.dataset.unit || 'count', gran = cv.dataset.gran || 'day', kind = cv.dataset.viz || 'line';
    var agg = cv.dataset.agg || (kind === 'line' ? 'last' : 'sum'), labels = spec.labels || [], series = spec.series || [], g = gran;
    if (gran === 'day' && labels.length > 90) { var wk = toWeekly(labels, series, agg); labels = wk.labels; series = wk.series; g = 'week'; }
    var share = kind === 'stack', rec = spec.reconstructed, out = spec.outage, metric = cv.dataset.metric || '';
    var cell = unit === 'hours' ? function (v) { return (v / 24).toFixed(1); } : unit === 'percent' ? function (v) { return v.toFixed(1) + '%'; } : FMT.full;
    var unitText = unit === 'hours' ? ' (days)' : unit === 'percent' ? ' (%)' : '';
    var heads = [g === 'week' ? 'Week of' : g === 'month' ? 'Month' : 'Date'];
    if (series.length === 1) heads.push(cap1(metric) + unitText); else series.forEach(function (s) { heads.push(s.label + (share ? ' (%)' : unitText)); });
    if (share) heads.push('Total');
    var withSource = !!(rec && rec.length === 2); if (withSource) heads.push('Source');
    var tbl = document.createElement('table'); tbl.className = 'v-dt v-dt-chart';
    var cap = tbl.createCaption(); cap.className = 'sr-only'; cap.textContent = cap1(metric) + ' — ' + (cv.dataset.scope || '');
    var hr = tbl.createTHead().insertRow();
    heads.forEach(function (h, j) {
      var th = document.createElement('th'); th.scope = 'col'; th.textContent = h;
      if (j && !(withSource && j === heads.length - 1)) th.className = 'num'; hr.appendChild(th);
    });
    var tb = tbl.createTBody(); tb.id = host.id + '-rows';
    function empty(i) { return series.every(function (s) { return s.data[i] == null; }); }
    var rows = 0, i = labels.length - 1, r, th, td;
    while (i >= 0) {
      r = tb.insertRow(); th = document.createElement('th'); th.scope = 'row'; r.appendChild(th);
      if (empty(i)) {   /* one row per null run */
        var j = i; while (j > 0 && empty(j - 1)) j--;
        var from = labels[j], to = periodEnd(labels[i], g);
        r.className = 'is-gap'; th.colSpan = heads.length;
        th.textContent = dateRange(from, to) + ' · No data' + (out && out.length === 2 && from <= out[1] && to >= out[0] ? ' (collection outage)' : '');
        i = j - 1;
      } else {
        var total = 0; series.forEach(function (s) { total += s.data[i] || 0; });
        th.textContent = g === 'month' ? monthYear(labels[i]) : longDate(labels[i]);
        series.forEach(function (s) {
          var v = s.data[i]; td = r.insertCell(); td.className = 'num';
          if (v == null) na(td); else td.textContent = share ? (total ? (v / total * 100).toFixed(1) + '%' : '—') : cell(v);
        });
        if (share) { td = r.insertCell(); td.className = 'num'; td.textContent = FMT.full(total); }
        if (withSource) {
          td = r.insertCell(); var d1 = periodEnd(labels[i], g);
          if (labels[i] <= rec[1] && d1 >= rec[0]) { var tag = document.createElement('span'); tag.className = 'v-tag'; tag.textContent = 'reconstructed'; td.appendChild(tag); }
        }
        i--;
      }
      rows++; if (rows > 12) r.hidden = true;
    }
    host.appendChild(tbl);
    if (rows > 12) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'v-chart-more';
      b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', tb.id);
      b.textContent = 'Show all ' + rows; b.setAttribute('data-label', b.textContent); host.appendChild(b);
    }
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var more = e.target.closest('.v-chart-more');
    if (more) {
      var tb = document.getElementById(more.getAttribute('aria-controls')); if (!tb) return;
      var open = more.getAttribute('aria-expanded') !== 'true';
      Array.prototype.forEach.call(tb.rows, function (row, k) { if (k >= 12) row.hidden = !open; });
      more.setAttribute('aria-expanded', open ? 'true' : 'false'); more.textContent = open ? 'Show fewer' : more.getAttribute('data-label');
      if (!open) tb.parentNode.scrollIntoView({ block: 'nearest' });
      return;
    }
    var btn = e.target.closest('[data-chart-toggle]'); if (!btn) return;
    var card = btn.closest('[data-chart]'), cv = card && card.querySelector('canvas[data-viz]'), host = document.getElementById(btn.getAttribute('aria-controls'));
    if (!cv || !host) return;
    var on = btn.getAttribute('aria-pressed') !== 'true';
    if (on && !host.hasAttribute('data-built')) { buildTable(cv, host); host.setAttribute('data-built', ''); }
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    cv.parentNode.hidden = on; host.hidden = !on;
    var legend = card.querySelector('[data-chart-legend]'); if (legend) legend.hidden = on;
    if (on && live.has(cv)) { select(live.get(cv), null, false); }
  });

  function init() {
    T = tokens(); applyDefaults();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting && !live.has(en.target)) { mount(en.target); io.unobserve(en.target); } });
    }, { rootMargin: '200px' });
    document.querySelectorAll('canvas[data-viz]').forEach(function (c) { io.observe(c); });   /* hidden tabs never intersect until shown */
    new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }
  window.VISR = Object.assign(window.VISR || {}, { FMT: FMT, niceScale: niceScale, durationScale: durationScale });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
