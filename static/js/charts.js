/* VISR charts.js: Chart.js 4.4.1. Reads design tokens from CSS, mounts visible canvases lazily, re-themes on toggle.
   Contract: <canvas data-viz="line|small|share|column" data-format="number|hours|percent" [data-zero="false"]
     data-series='{"labels":["YYYY-MM-DD",…],"series":[{"label":"…","role":"accent|series-N|ord-N|other","partialLast":false,"data":[…|null]}]}'> */
(function () {
  'use strict';
  if (!window.Chart) return;
  var root = document.documentElement, T = null, live = new Map();
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var cf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });
  function fix(n, d) { return String(Number(n.toFixed(d))); }
  var FMT = {   /* mirrors layouts/partials/ui/{num,dur,pct}.html */
    number: function (v) { return v == null ? '—' : Math.abs(v) >= 1e4 ? cf.format(v) : nf.format(v); },
    hours: function (h) {
      if (h == null) return '—'; var a = Math.abs(h), s = h < 0 ? '−' : '';
      if (a < 1) return s + Math.round(a * 60) + 'm'; if (a < 10) return s + fix(a, 1) + 'h'; if (a < 48) return s + Math.round(a) + 'h';
      var d = a / 24; if (d < 10) return s + fix(d, 1) + 'd'; if (d < 365) return s + Math.round(d) + 'd'; return s + fix(d / 365, 1) + 'y';
    },
    percent: function (v) { return v == null ? '—' : (Math.abs(v) < 10 ? fix(v, 1) : String(Math.round(v))) + '%'; }
  };
  function shortDate(s) { var p = String(s).split('-');
    return p.length === 3 ? MONTHS[+p[1] - 1] + ' ' + (+p[2]) : p.length === 2 ? MONTHS[+p[1] - 1] + ' ' + p[0] : String(s); }
  function longDate(s) { var p = String(s).split('-'); return p.length === 3 ? shortDate(s) + ', ' + p[0] : shortDate(s); }

  function tokens() {
    var cs = getComputedStyle(root); function g(n) { return cs.getPropertyValue(n).trim(); }
    var t = { surface: g('--color-base-100'), ink: g('--color-base-content'), ink2: g('--ink-2'), ink3: g('--ink-3'),
      line: g('--line'), axis: g('--axis'), font: getComputedStyle(document.body).fontFamily, roles: {} };
    t.roles.accent = g('--chart-1'); t.roles.other = g('--other');
    for (var i = 1; i <= 8; i++) t.roles['series-' + i] = g('--chart-' + i);
    for (var j = 1; j <= 5; j++) t.roles['ord-' + j] = g('--ord-' + j);
    return t;
  }
  function color(role) { return T.roles[role] || T.roles.accent; }
  function wash(hex) { return /^#[0-9a-f]{6}$/i.test(hex) ? hex + '1a' : hex; }   /* 10% */

  function applyDefaults() {
    var d = Chart.defaults;
    d.font.family = T.font; d.font.size = 12; d.color = T.ink3; d.borderColor = T.line;
    d.responsive = true; d.maintainAspectRatio = false; d.animation = false;
    d.interaction.mode = 'index'; d.interaction.intersect = false;
    Object.assign(d.elements.line, { borderWidth: 2, tension: 0, borderCapStyle: 'round', borderJoinStyle: 'round' });
    Object.assign(d.elements.point, { radius: 0, hoverRadius: 4, hitRadius: 12, hoverBorderWidth: 2 });
    Object.assign(d.elements.bar, { borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 });
    d.plugins.legend.display = false;
    Object.assign(d.plugins.tooltip, { backgroundColor: T.surface, borderColor: T.axis, borderWidth: 1, titleColor: T.ink3, bodyColor: T.ink,
      cornerRadius: 6, padding: 8, boxPadding: 4, usePointStyle: true, titleFont: { weight: '400' }, bodyFont: { weight: '600' } });
  }

  var crosshair = { id: 'visrCrosshair', afterDatasetsDraw: function (c) {
    var act = c.tooltip && c.tooltip.getActiveElements(); if (!act || !act.length || c.config.type === 'bar') return;
    var x = act[0].element.x, a = c.chartArea, ctx = c.ctx;
    ctx.save(); ctx.strokeStyle = T.axis; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
  } };

  function toShares(series) {
    var n = series[0].data.length;
    for (var x = 0; x < n; x++) {
      var sum = 0; series.forEach(function (s) { sum += s.data[x] || 0; });
      series.forEach(function (s) { s.data[x] = sum ? (s.data[x] || 0) / sum * 100 : null; });
    }
  }

  function build(canvas) {
    var kind = canvas.dataset.viz || 'line', fmtKey = kind === 'share' ? 'percent' : (canvas.dataset.format || 'number');
    var f = FMT[fmtKey] || FMT.number, spec = JSON.parse(canvas.dataset.series);
    var series = spec.series, labels = spec.labels, last = labels.length - 1, single = series.length === 1;
    if (kind === 'share') toShares(series);
    var datasets = series.map(function (s, i) {
      var c = color(s.role || 'accent');
      var ds = { label: s.label, data: s.data, borderColor: c, backgroundColor: c, pointStyle: 'line', spanGaps: false,
        pointHoverBackgroundColor: c, pointHoverBorderColor: T.surface };
      if (kind === 'line' || kind === 'small') { ds.fill = single ? 'origin' : false; ds.backgroundColor = single ? wash(c) : c; }
      if (kind === 'share') { ds.fill = i === 0 ? 'origin' : '-1'; ds.borderColor = T.surface; ds.borderWidth = 2; ds.pointStyle = 'rect'; ds.pointBackgroundColor = c; }
      if (kind === 'column') { ds.borderWidth = 0; ds.pointStyle = 'rect'; }
      if (s.partialLast) ds.segment = { borderDash: function (ctx) { return ctx.p1DataIndex === last ? [4, 4] : undefined; } };
      return ds;
    });
    var small = kind === 'small';
    return {
      type: kind === 'column' ? 'bar' : 'line',
      data: { labels: labels, datasets: datasets },
      plugins: [crosshair],
      options: {
        layout: { padding: { top: 4, right: 4 } },
        scales: {
          x: { stacked: kind === 'share', grid: { display: false }, border: { color: T.axis },
               ticks: { color: T.ink3, maxRotation: 0, autoSkip: true, maxTicksLimit: small ? 3 : 6,
                        callback: function (v) { return shortDate(this.getLabelForValue(v)); } } },
          y: { stacked: kind === 'share', beginAtZero: canvas.dataset.zero !== 'false', max: kind === 'share' ? 100 : undefined,
               grid: { color: T.line, drawTicks: false }, border: { display: false },
               ticks: { color: T.ink3, padding: 6, maxTicksLimit: small ? 3 : 4, callback: function (v) { return f(v); } } }
        },
        plugins: {
          legend: { display: datasets.length > 1, position: 'top', align: 'start',
                    labels: { color: T.ink2, usePointStyle: true, boxWidth: 12, boxHeight: 8, padding: 12 } },
          tooltip: { itemSort: function (a, b) { return (b.parsed.y || 0) - (a.parsed.y || 0); },
                     callbacks: { title: function (it) { return it.length ? longDate(it[0].label) : ''; },
                                  label: function (it) { return ' ' + f(it.parsed.y) + '  ' + (it.dataset.label || ''); } } }
        }
      }
    };
  }

  function mount(canvas) {
    try { live.set(canvas, new Chart(canvas, build(canvas))); } catch (e) { console.error('VISR chart failed', canvas.id, e); }
  }
  function retheme() {
    T = tokens(); applyDefaults();
    // Copy first: Map#forEach visits keys re-added during iteration, so re-mounting in place loops forever.
    Array.from(live.entries()).forEach(function (p) { p[1].destroy(); live.delete(p[0]); mount(p[0]); });
  }

  /* table twin, built on first open (textContent only; labels are data) */
  document.addEventListener('toggle', function (e) {
    var d = e.target; if (!d.matches || !d.matches('details.v-twin') || !d.open || d.dataset.built) return;
    var canvas = d.closest('figure') && d.closest('figure').querySelector('canvas[data-series]'); if (!canvas) return;
    var spec = JSON.parse(canvas.dataset.series);
    var f = FMT[canvas.dataset.format || 'number'] || FMT.number;
    var tbl = document.createElement('table'); tbl.className = 'v-dt';
    var hr = tbl.createTHead().insertRow();
    ['Date'].concat(spec.series.map(function (s) { return s.label; })).forEach(function (h, i) {
      var th = document.createElement('th'); th.textContent = h; if (i) th.className = 'num'; hr.appendChild(th); });
    var tb = tbl.createTBody();
    spec.labels.forEach(function (l, i) {
      if (spec.series.every(function (s) { return s.data[i] == null; })) return;
      var r = tb.insertRow(); r.insertCell().textContent = longDate(l);
      spec.series.forEach(function (s) { var c = r.insertCell(); c.className = 'num'; c.textContent = f(s.data[i]); });
    });
    d.querySelector('div').appendChild(tbl); d.dataset.built = '1';
  }, true);

  function init() {
    T = tokens(); applyDefaults();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting && !live.has(en.target)) { mount(en.target); io.unobserve(en.target); } });
    }, { rootMargin: '200px' });
    document.querySelectorAll('canvas[data-viz]').forEach(function (c) { io.observe(c); });   /* hidden repo blocks/tabs never intersect */
    new MutationObserver(retheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }
  window.VISR = Object.assign(window.VISR || {}, { FMT: FMT });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
