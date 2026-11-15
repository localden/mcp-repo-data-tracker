#!/usr/bin/env python3
"""VISR UI review capture. CI only (.github/workflows/ui-review.yml): renders every page across themes
and viewports, writes what a reviewer needs to judge it and runs the brief §7.4 checks.

Output (--out):
  tiles/<capture>--NN.png     full page sliced into viewport-sized tiles, top to bottom
  states/<capture>--*.png     interactive states: menu, switcher, notes, table, hover-N, tabsL-T-<tab>,
                              filter-<control>, focus (first Tab: the skip link), focus-5 (after 5 Tabs)
  reports/<capture>.json      overflow, clipped text, chart mounts, font sizes, console/page errors, axe (page and states)
  text/<capture>.txt          rendered text of <main>, for checking numbers against data/
  palette-<theme>.txt         validate_palette.py on the live tokens
  checks.json / checks.txt    one row per check: rule, capture, result (pass/fail/skip/error), detail
  index.json                  every capture with its tiles, states and report

A capture id is <page-id>--<viewport>-<theme>, e.g. issues-ts--mobile-dark. Checks never fail the job:
screenshots are always produced, and a broken page or state is reported and skipped, never fatal.
"""
import argparse, json, os, re, subprocess, sys, urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

PAGES = [('overview', ''), ('issues', 'issues/'), ('issues-ts', 'issues/typescript-sdk/'),
         ('issues-spec', 'issues/modelcontextprotocol/'), ('issues-rust', 'issues/rust-sdk/'),
         ('pulls', 'pulls/'), ('pulls-ts', 'pulls/typescript-sdk/'), ('pulls-spec', 'pulls/modelcontextprotocol/'),
         ('seps', 'seps/'), ('downloads', 'downloads/'), ('repo-spec', 'repos/modelcontextprotocol/'),
         ('repo-ts', 'repos/typescript-sdk/'), ('repo-rust', 'repos/rust-sdk/'),
         # design system v4 section 6: the living styleguide, captured in all four viewport/theme combinations like every page
         ('styleguide', 'styleguide/')]
# Old URLs that must land on the new ones (brief §2.1): stub pages and ui.js ?repo= redirects.
LEGACY = [('health/', 'repos/modelcontextprotocol/'), ('contributors/', 'repos/modelcontextprotocol/'),
          ('issues/?repo=modelcontextprotocol/typescript-sdk', 'issues/typescript-sdk/'),
          ('pulls/?repo=modelcontextprotocol/typescript-sdk', 'pulls/typescript-sdk/'),
          ('health/?repo=modelcontextprotocol/typescript-sdk', 'repos/typescript-sdk/')]
VIEWPORTS = {'desktop': (1440, 900, 1), 'mobile': (390, 844, 2), 'laptop': (1024, 768, 1), 'tablet': (768, 1024, 1)}
# Capture matrix: all 13 pages in all four viewport/theme combinations (52 captures). The probe, the text
# file, axe and the page checks always cover the whole page; tiles and states are capped per combination:
#   desktop light  up to 40 tiles  every state, plus the keyboard walk and the legacy redirects
#   mobile light   up to 16 tiles  menu, switcher, notes, focus, and the phone forms of the list controls: the facet panel
#                                  with one chip pressed, the sort menu, the view menu, the stuck search row, the empty result
#   desktop dark   first 4 tiles   menu, switcher, notes, table, hover     (overlays and charts on dark tokens)
#   mobile dark    up to 16 tiles  menu                                    (the whole page, like mobile light: lists, charts, footer)
#   laptop light   up to 12 tiles  no states: 1024px, where every table plan must still fit (component test 7)
#   tablet light   up to 12 tiles  no states: 768px, list form and records with tablet gutters
# The styleguide is the inventory, so it is captured to its footer in every combination (TILE_CAPS). The laptop and tablet rows
# cover the four pages that hold every component family (ONLY).
ALL_STATES = ('menu', 'switcher', 'notes', 'table', 'hover', 'tabs', 'filter', 'select', 'empty', 'expander', 'focus')
MATRIX = [('desktop', 'light', 40, ALL_STATES),
          ('mobile', 'light', 16, ('menu', 'switcher', 'notes', 'focus', 'facets', 'sort', 'views', 'stuck', 'empty', 'expander')),
          ('desktop', 'dark', 4, ('menu', 'switcher', 'notes', 'table', 'hover')),
          ('mobile', 'dark', 16, ('menu',)),
          ('laptop', 'light', 12, ()),
          ('tablet', 'light', 12, ())]
TILE_CAPS = {'styleguide': 60}
ONLY = {'laptop': ('overview', 'pulls-ts', 'seps', 'repo-ts', 'styleguide'), 'tablet': ('overview', 'pulls-ts', 'seps', 'styleguide')}
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'
SERIOUS = ('serious', 'critical')
# design system v4 2.2: nine roles (display 32/600, title 24/600, heading 20/600, subhead 16/600, strong 14/600, medium 14/500,
# body 14/400, label 12/500, caption 12/400) plus 16/400 inputs on phones and coarse pointers = 10. There is no 12/600 and no size
# outside 12, 14, 16, 20, 24, 32. The phone display size (24/32) is the title combination, so phones stay inside the same set.
# The check counts text inside <main> only, so header/footer chrome is outside the budget.
MAX_FONT_COMBOS = 10
# brief §5.10 / §7.4 item 8: (check name, tokens in slot order, validator flags). Backlog age is a one-hue ramp, light = young.
PALETTE_SETS = [('categorical', ['--chart-1', '--chart-2'], []),
                # design system v4 2.1: one ordered ramp of four steps (--ord-5 is removed)
                ('ordinal', ['--ord-1', '--ord-2', '--ord-3', '--ord-4'], ['--ordinal'])]
# brief §7.4 item 5, on the rendered text of the whole page
TEXT_BANS = [(re.compile(r'\b1000(?:\.0+)?K\b'), '1000K'), (re.compile(r'\bNaN\b'), 'NaN'),
             (re.compile(r'\bundefined\b'), 'undefined'), (re.compile('Suspect'), 'Suspect'),
             (re.compile('Over target'), 'Over target'), (re.compile('Past SLA'), 'Past SLA'),
             (re.compile(r'\d[¹²³⁰⁴-⁹]'), 'superscript digit on a number'),
             # no glyph separators anywhere in rendered text (U+00B7 middot, U+2022 bullet)
             (re.compile('[' + chr(0xB7) + chr(0x2022) + ']'), 'glyph separator (middot or bullet)')]
# design system v4 7.3 "text-bans": run on the text of <main> with item titles, GitHub labels, paths, package names, the page
# description and Data notes stripped (the probe's banText), so verbatim GitHub text never trips a rule.
_DASHES = chr(0x2014) + chr(0x2013)
TEXT_BANS_V4 = [(re.compile(p, re.M), label) for p, label in [
    (r' \| ', 'spaced pipe'), (r' / ', 'spaced slash'), (r'(^|\s)[' + _DASHES + r'](\s|$)', 'spaced or lone dash'),
    (r'\b\d+(\.\d)?y\b', 'years in a duration'), (r'\b\d+\.\d+[hd]\b', 'decimal in a duration'), (r'\b\d+[hd] over\b', '"over" meaning overdue'),
    (r'\bwk\b', 'wk'), (r'\bavg\b', 'avg'), (r'\brepos?\b', 'repo'), (r'\bn ?= ?\d', 'n = '), (r'\(\d+%\)', 'percent in parentheses'),
    (r'\d+(\.\d+)?K stars', 'compact star count'), (r'^Since [A-Z]', 'Since ...'),
    # "Week of" is the header of a column of weeks in a chart table view (each row is its Monday); the banned form is the phrase
    # with a date typed after it
    (r'Week of [A-Z][a-z]{2} \d', 'Week of Nov 9'), (r'No change', 'No change'),
    # one term for a gap in the data, "Data gap": "No data" is only the reason of an empty mark, never a label before a date,
    # and the old names of the same fact are gone
    (r'No data [A-Z][a-z]{2} \d', 'No data Oct 8 (the term is Data gap)'), (r'Collection outage', 'Collection outage (the term is Data gap)'),
    (r'days old', 'days old'), (r'\bvs\.', 'vs.'), (r'Team SLA', 'Team SLA'), (r'WG ', 'WG'), (r'PR \d+\b', 'PR 123'),
    (r'OPEN PRS', 'OPEN PRS'), (r'OPEN ISSUES', 'OPEN ISSUES'), (r'Untriaged', 'Untriaged'), (r'Data through', 'Data through'),
    (r'Need a ', 'Need a')]]
RULES = {
    'capture': 'the capture itself ran (an error here means the page could not be rendered or probed)',
    'states': 'the state captures ran (an error here stopped the remaining states of that capture)',
    'keyboard': 'the keyboard walk ran (an error here stopped it before its checks were recorded)',
    'http-status': 'the page URL serves HTTP 200',
    'R1-page-width': 'R1: document scrollWidth equals clientWidth',
    'R1-element-overflow': 'R1: no element ends past the viewport outside an overflow auto/scroll ancestor',
    'R2-inner-scroll': 'R2: at 1440px no .v-scroll scrolls horizontally',
    'axe': 'axe on the default capture: no serious or critical violation',
    'axe-state': 'axe on a state (menu, switcher, tab, table, filter, notes): no serious or critical violation',
    'kbd-skip': 'the first Tab lands on .v-skip',
    'kbd-menu-open': 'Enter on the scope switcher (or the Repositories menu) expands it and focuses the current item',
    'kbd-menu-escape': 'ArrowDown then Escape collapses it and returns focus to the button',
    'kbd-menu-activate': 'activating a repo link loads a page whose document.title names the repo',
    'font-combos': f'at most {MAX_FONT_COMBOS} font size/weight combinations inside <main> (design system v4 2.2: the nine roles '
                   'display, title, heading, subhead, strong, medium, body, label, caption, plus 16/400 inputs); '
                   'reports/<capture>.json fontSamples names one element per combo',
    'text-bans': '1000K, NaN, undefined, Suspect, Over target, Past SLA, a superscript digit on a number, and any middot or bullet '
                 'glyph anywhere in the rendered text; plus the design system v4 7.3 list (spaced pipe, slash or dash, years or '
                 'decimals in a duration, wk, avg, repo, "No change", "Week of", "Untriaged", "Data through" and the rest) on the '
                 'text of <main> with titles, labels, paths, package names and Data notes stripped',
    'cell-overflow': 'no table cell content runs past its cell (a fixed column narrower than its header or value)',
    'cell-inset': 'no child of a table cell ends past the cell\'s content box (a sparkline, note or bar that breaks the card inset)',
    'value-truncated': 'no value, id or deadline phrase sits in a box that cuts it (design system v4 4.14 rule 2: a value never truncates)',
    'font-loaded': 'the shipped face rendered: document.fonts.check(\'500 14px "Inter Variable"\') after fonts.ready (design system v4 2.2)',
    'numerals': 'tabular figures on numeric values in table cells, proportional figures on titles, tags, handles, ids and sentences '
                '(design system v4 2.2)',
    'notes-layout': 'Data notes open at 64rem and up: Sources sits to the right of Definitions (the 8 + 4 grid applies)',
    'th-baseline': 'in a column header row every label sits on one line: equal top edges for plain labels and sort buttons',
    'td-baseline': 'in a table row every value, cell link and row link ends its first line at the same y (a row with a sub line or '
                   'a note aligns every cell to its first line)',
    'spark-attached': 'no level sparkline shows a loose point: the end dot is the end of the line or of a bridge (design system v4 4.20)',
    'chart-fill': 'every mounted canvas is as wide and as tall as its plot box, within 2px (a chart that kept a transient size at mount)',
    'spark-range': 'no date in a sparkline range row is later than the as-of day (html[data-asof])',
    'tag-fold': 'below 64rem no tag line shows a +N beside fewer than six labels, or two +N tags',
    'name-fit': 'from 64rem no row name link in a matrix, rank or kept table is truncated',
    'controls': 'at 390 every button, tab, link-action, nav item and footer link is at least 44px tall or has a 44px ::after hit area',
    'head-geometry': 'at 1440 the title text and the first section start at the same y on Overview, Issues, PRs and SEPs',
    'brand': 'the header brand mark has painted pixels at least 3 to 1 against the header surface in this theme (design system v4 4.1)',
    'tiles': 'the full-page tiles were written (an error keeps the tiles shot so far; states and the keyboard walk still run)',
    'canvas-labels': 'every canvas has an aria-label containing its data-metric',
    'palette': 'validate_palette.py on the live tokens: chart-1/2 categorical (chart-2 is declared for the validator only), ord-1..4 ordinal',
    'redirect': 'a legacy URL lands on its new URL',
}

PROBE = r"""() => {
  const vw = document.documentElement.clientWidth;
  const name = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.'); return s; };
  const path = el => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.unshift(name(e)); return p.join(' > '); };
  const shown = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0'; };
  const tiny = el => { const r = el.getBoundingClientRect(); return r.width <= 2 || r.height <= 2; };   // sr-only text
  const all = [...document.querySelectorAll('body *')].filter(shown);
  // R1: only a scroll container (overflow-x auto/scroll) may hold content that runs past the viewport
  const scroller = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement)
    if (/auto|scroll/.test(getComputedStyle(e).overflowX)) return true; return false; };
  const ownText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const overflow = all.filter(el => el.getBoundingClientRect().right > vw + 1 && !scroller(el)).slice(0, 25)
    .map(el => ({ el: path(el), right: Math.round(el.getBoundingClientRect().right) }));
  const clipped = all.filter(el => ownText(el) && !tiny(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible').slice(0, 40)
    .map(el => ({ el: path(el), text: el.textContent.trim().slice(0, 100) }));
  const innerScroll = [...document.querySelectorAll('.v-scroll')].filter(shown).filter(el => el.scrollWidth > el.clientWidth + 1)
    .map(el => ({ el: path(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  const canvases = [...document.querySelectorAll('canvas[data-viz]')];
  const mounted = c => !!(window.Chart && Chart.getChart(c));
  const fonts = {}, fontSamples = {}, colors = {};
  all.filter(el => ownText(el) && !tiny(el)).forEach(el => { const cs = getComputedStyle(el);
    colors[cs.color] = (colors[cs.color] || 0) + 1;
    if (!el.closest('main')) return;   // header/footer chrome (brand, nav, build hash) is outside the page's type budget
    const f = cs.fontSize + ' ' + cs.fontWeight; fonts[f] = (fonts[f] || 0) + 1;
    if (!fontSamples[f]) fontSamples[f] = path(el) + ' "' + (el.textContent || '').trim().slice(0, 40) + '" [' + cs.fontFamily.split(',')[0].trim() + '; ' + cs.fontVariantNumeric + ']'; });
  // the shipped face, and where figures are tabular: numeric values in table cells are, running text is not (v4 2.2)
  const fontLoaded = !!(document.fonts && document.fonts.check && document.fonts.check('500 14px "Inter Variable"'));
  const tab = el => /tabular-nums/.test(getComputedStyle(el).fontVariantNumeric);
  const numerals = [];
  [...document.querySelectorAll('.v-dt td.num .v-val:not([data-kind="date"]):not([data-kind="range"]):not([data-kind="ts"]):not(.is-na)')].filter(shown)
    .filter(el => !tab(el)).slice(0, 5).forEach(el => numerals.push({ el: path(el), want: 'tabular', text: el.textContent.trim().slice(0, 30) }));
  [...document.querySelectorAll('main .v-row-link, main .v-tag, main .v-who, main .v-id, main .v-prose')].filter(shown)
    .filter(tab).slice(0, 5).forEach(el => numerals.push({ el: path(el), want: 'proportional', text: el.textContent.trim().slice(0, 30) }));
  // a value, an id or a deadline phrase inside any box that cuts it (4.14 rule 2)
  const cut = el => { for (let e = el; e && !e.matches('table, article, main'); e = e.parentElement) {
    if (getComputedStyle(e).overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1) return e; if (e.matches('td, th')) break; } return null; };
  const valueTruncated = [...document.querySelectorAll('.v-dt .v-val, .v-dt .v-id, .v-deadline, .v-metric .v-val, .v-readout .v-val, .v-statlist .v-val')]
    .filter(shown).filter(el => !el.closest('.v-item > .v-meta')).map(el => [el, cut(el)]).filter(x => x[1]).slice(0, 10)
    .map(x => ({ el: path(x[0]), text: x[0].textContent.trim().slice(0, 40), box: name(x[1]) }));
  // a child of a body cell that ends past the cell's content box: a sparkline, note or bar that breaks the card inset
  const cellInset = [];
  for (const c of document.querySelectorAll('.v-dt tbody td, .v-dt tbody th')) {
    if (cellInset.length >= 10 || !shown(c) || getComputedStyle(c).display !== 'table-cell') continue;
    const cr = c.getBoundingClientRect(), edge = cr.right - parseFloat(getComputedStyle(c).paddingRight || 0);
    const bad = [...c.querySelectorAll('*')].find(k => shown(k) && !tiny(k) && k.getBoundingClientRect().right > edge + 1.5);
    if (bad) cellInset.push({ el: path(bad), over: Math.round(bad.getBoundingClientRect().right - edge) });
  }
  // column header labels on one line: the first visible text of every header in a row starts at the same y
  const thBaseline = [];
  document.querySelectorAll('.v-dt thead tr:last-child').forEach(tr => { if (!shown(tr)) return;
    const tops = [...tr.cells].filter(shown).map(th => { const w = document.createTreeWalker(th, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const p = n.parentElement; if (!n.textContent.trim() || !p || p.closest('.sr-only, .v-th-sub, .v-th-short')) continue;
        const r = document.createRange(); r.selectNodeContents(n); const b = r.getClientRects(); if (b.length) return Math.round(b[0].top * 2) / 2; }
      return null; }).filter(v => v !== null);
    if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 1 && thBaseline.length < 10) thBaseline.push({ el: path(tr), tops: tops.join(', ') }); });
  // the values of one table row share a line: every value, cell link and row link of a row ends its first line at the same y
  // (a row with a sub line or a note aligns every cell to its first line; design system v4 4.14)
  const tdBaseline = [];
  document.querySelectorAll('.v-dt tbody tr').forEach(tr => { if (tdBaseline.length >= 10 || !shown(tr) || getComputedStyle(tr).display !== 'table-row') return;
    // measure text, not boxes: a block row link returns its 20px line box and an inline value its 17px content area, 2px apart on
    // one baseline. The first non-empty text node outside .sr-only is measured on both sides (the technique of th-baseline).
    const textBottom = e => { const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { if (!n.textContent.trim() || !n.parentElement || n.parentElement.closest('.sr-only')) continue;
        const r = document.createRange(); r.selectNodeContents(n); const b = r.getClientRects(); if (b.length) return Math.round(b[0].bottom * 2) / 2; }
      return null; };
    const ys = [...tr.querySelectorAll(':scope > * > .v-val:not(.is-na), :scope > * > .v-row-link, :scope > * > .v-cell-link .v-val, :scope > * > .v-barnum .v-val, :scope > * > .v-over .v-val, :scope > * > .v-who, :scope > * > .v-deadline')]
      .filter(shown).map(textBottom).filter(v => v !== null);
    if (ys.length > 1 && Math.max(...ys) - Math.min(...ys) > 1.5) tdBaseline.push({ el: path(tr), ys: [...new Set(ys)].join(', ') }); });
  // a mounted chart fills its plot: a canvas narrower or shorter than its box kept a transient size (design system v4 4.19)
  const chartFill = canvases.filter(c => shown(c) && mounted(c)).map(c => { const r = c.getBoundingClientRect(), p = c.parentElement;
    return { el: c.id || path(c), w: Math.round(r.width), h: Math.round(r.height), pw: p.clientWidth, ph: p.clientHeight }; })
    .filter(x => Math.abs(x.w - x.pw) > 2 || Math.abs(x.h - x.ph) > 2).slice(0, 10);
  // page head geometry: where the title's text and the first section start (compared across pages at 1440)
  const headGeo = (() => { const t = document.querySelector('main .v-page-title'), s = document.querySelector('main .v-section'); if (!t || !s) return null;
    const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT); let n, top = null;
    while ((n = w.nextNode())) { if (!n.textContent.trim() || n.parentElement.closest('.sr-only')) continue;
      const r = document.createRange(); r.selectNodeContents(n); const b = r.getClientRects(); if (b.length) { top = Math.round(b[0].top * 2) / 2; break; } }
    return { title: top, section: Math.round((s.getBoundingClientRect().top + window.scrollY) * 2) / 2, desc: !!document.querySelector('main .v-page-desc'),
      callout: !!document.querySelector('main .v-page-head > .v-callout') }; })();
  // a sparkline's range row never prints a date after the as-of day (design system v4 4.20)
  const asof = document.documentElement.getAttribute('data-asof') || '';
  const sparkLate = asof ? [...document.querySelectorAll('.v-spark-range time')].filter(t => (t.getAttribute('datetime') || '').slice(0, 10) > asof).slice(0, 10)
    .map(t => ({ el: path(t), date: t.getAttribute('datetime') })) : [];
  // below 64rem a row shows up to six labels and a +N only past six: a visible +N beside six or fewer labels is a false count
  const tagFold = vw < 1024 ? [...document.querySelectorAll('.v-dt .v-tags')].filter(shown).filter(b => {
    const more = [...b.querySelectorAll('.v-tag.is-more')].filter(shown), labels = [...b.querySelectorAll('.v-tag.is-label')].filter(shown);
    return more.length > 1 || (more.length === 1 && labels.length < 6); }).slice(0, 10).map(b => ({ el: path(b), text: b.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) })) : [];
  // from 64rem a row's name link is never truncated in a matrix, rank or kept table (2.3: each plan leaves the name its width)
  const nameCut = vw >= 1024 ? [...document.querySelectorAll('.v-dt th.v-name > a.v-row-link')].filter(shown).filter(a => a.scrollWidth > a.clientWidth + 1).slice(0, 10)
    .map(a => ({ el: path(a), text: a.textContent.trim().slice(0, 40) })) : [];
  // phone: a control is at least 44px tall, or its ::after hit area is (design system v4 7.3 controls)
  const hitH = el => { const r = el.getBoundingClientRect(); let h = r.height; const a = getComputedStyle(el, '::after');
    if (a && a.content !== 'none' && a.position === 'absolute') h = Math.max(h, r.height - (parseFloat(a.top) || 0) - (parseFloat(a.bottom) || 0)); return h; };
  const smallControls = vw < 640 ? [...document.querySelectorAll('main button, main [role="tab"], main a.v-link-action, header button, header a.v-nav-item, footer a')]
    .filter(shown).filter(el => !el.closest('[data-fixture], .v-sg-row, .v-sg-pop') && !el.matches('.v-field-clear, .v-th-btn')).filter(el => hitH(el) < 43.5).slice(0, 12)
    .map(el => ({ el: path(el), text: (el.textContent || '').trim().slice(0, 30), h: Math.round(hitH(el)) })) : [];
  // a level sparkline never shows a loose point: its end dot is the end of the line or of a bridge (design system v4 4.20)
  const sparkLoose = [];
  document.querySelectorAll('.v-spark svg').forEach(svg => { const dot = svg.querySelector('.v-spark-dot'), line = svg.querySelector('.v-spark-line'); if (!dot || !line) return;
    const m = /M\s*([\d.-]+,[\d.-]+)/.exec(dot.getAttribute('d') || ''); if (!m) return;
    const to = 'L' + m[1], hit = (line.getAttribute('d') || '').includes(to) || [...svg.querySelectorAll('.v-spark-bridge')].some(b => (b.getAttribute('d') || '').includes(to));
    if (!hit && sparkLoose.length < 10) sparkLoose.push({ el: path(svg.closest('.v-spark') || svg) }); });
  // brand: the header mark has painted pixels at least 3 to 1 against the header surface, in this theme (design system v4 4.1)
  let brand = null; const bm = document.querySelector('.v-header .v-brand-mark');
  if (bm && bm.complete && bm.naturalWidth) { try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 48; const cx = cv.getContext('2d'); cx.drawImage(bm, 0, 0, 48, 48);
    const d = cx.getImageData(0, 0, 48, 48).data, f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (r, g, b) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(getComputedStyle(document.querySelector('.v-header')).backgroundColor) || [0, 255, 255, 255], bg = lum(+m[1], +m[2], +m[3]);
    let best = 1, painted = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; painted++; const l = lum(d[i], d[i + 1], d[i + 2]), c = (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05); if (c > best) best = c; }
    brand = { painted, contrast: Math.round(best * 100) / 100 }; } catch (e) { brand = { error: String(e) }; } }
  // table cells whose content runs past the cell (fixed columns narrower than a header or value)
  const cellOverflow = [...document.querySelectorAll('.v-dt th, .v-dt td')].filter(shown).filter(c => c.scrollWidth > c.clientWidth + 1)
    .slice(0, 25).map(c => ({ el: path(c), text: (c.innerText || '').trim().slice(0, 60), over: c.scrollWidth - c.clientWidth }));
  // a middot (U+00B7) that starts a visual line: the previous visible character sits on an earlier line (wrapped meta lines)
  const dots = [], tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const at = (n, i) => { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getClientRects(); return b.length ? b[0] : null; };
  const visible = el => (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true }) : shown(el)) && !tiny(el);
  let prev = null;
  for (let n = tw.nextNode(); n && dots.length < 25; n = tw.nextNode()) {
    const p = n.parentElement, t = n.textContent;
    if (!p || !t.trim() || !visible(p)) continue;
    for (let i = 0; i < t.length; i++) {
      if (/\s/.test(t[i])) continue;
      if (t.charCodeAt(i) === 0xB7) { const d = at(n, i), q = prev && at(prev[0], prev[1]);
        if (d && d.width > 0 && (!q || q.bottom <= d.top + 1)) dots.push({ el: path(p), text: (p.innerText || t).trim().slice(0, 80) }); }
      prev = [n, i];
    }
  }
  return { title: document.title, theme: document.documentElement.dataset.theme,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, height: document.documentElement.scrollHeight,
    overflow, clipped, innerScroll, fontSizes: fonts, fontSamples, textColors: colors, lineStartDots: dots, cellOverflow,
    fontLoaded, numerals, valueTruncated, cellInset, thBaseline, tdBaseline, sparkLoose, brand,
    chartFill, headGeo, sparkLate, tagFold, nameCut, smallControls,
    charts: { total: canvases.length, shown: canvases.filter(shown).length, mounted: canvases.filter(mounted).length,
              shownNotMounted: canvases.filter(c => shown(c) && !mounted(c)).map(c => c.id || path(c)) },
    canvases: [...document.querySelectorAll('canvas')].map(c => ({ el: c.id || path(c), metric: c.dataset.metric || null, label: c.getAttribute('aria-label') })),
    text: (document.querySelector('main') || document.body).innerText, pageText: document.body.innerText,
    // design system v4 7.3 text-bans: <main> without verbatim GitHub text (titles, labels, paths, package names), descriptions and notes
    banText: (() => { const m = (document.querySelector('main') || document.body).cloneNode(true);
      m.querySelectorAll('.v-row-link, .v-tag.is-label, .v-path, .v-cell-sub, .v-page-desc, .v-notes, .v-who, .v-kbd, .sr-only, [data-fixture], [hidden]').forEach(n => n.remove());
      m.querySelectorAll('td, th, li, p, div, dt, dd, h1, h2, h3, button, a').forEach(n => n.append('\n'));
      return m.textContent; })() };
}"""

# Tags the controls a state needs with data-cap="<kind>-<n>" and returns their labels per kind. Kinds follow
# the brief's markup: menus and disclosures are button[aria-expanded][aria-controls] (§4.6 o, q), the Table
# toggle and filter chips are button[aria-pressed] (§4.6 g, s), SLA rows carry a "Show" button (§3.2b-1).
TAG = r"""() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const found = {};
  const put = (kind, el, label) => { const list = found[kind] = found[kind] || [];
    el.setAttribute('data-cap', kind + '-' + list.length); list.push((label || txt(el)).slice(0, 60)); };
  document.querySelectorAll('[data-cap]').forEach(el => el.removeAttribute('data-cap'));
  const p1 = s => /resolve p1 bugs/i.test(s);
  [...document.querySelectorAll('main tr button:not([aria-expanded])')].filter(b => vis(b) && /^show\b/i.test(txt(b)) && !/^show all\b/i.test(txt(b)))
    .map(b => { const c = b.closest('tr').querySelector('th, td'); return [b, c ? txt(c) : '']; })
    .sort((x, y) => p1(y[1]) - p1(x[1])).forEach(([b, rule]) => put('show', b, 'show ' + rule));
  for (const b of document.querySelectorAll('button[aria-expanded][aria-controls]')) {
    if (!vis(b) || b.hasAttribute('data-cap')) continue;
    const s = txt(b), t = document.getElementById(b.getAttribute('aria-controls'));
    const links = t && (t.matches('ul, ol') || t.querySelector(':scope > ul, :scope > ol')) && t.querySelector('a[href]');
    if (/^data notes\b/i.test(s)) put('notes', b);
    else if (!/^show all\b/i.test(s) && links) put(b.closest('main') ? 'switcher' : 'menu', b);
  }
  const pressed = [...document.querySelectorAll('main button[aria-pressed]')].filter(b => vis(b) && !b.hasAttribute('data-cap'));
  pressed.filter(b => /^table\b/i.test(txt(b))).forEach(b => put('table', b));
  pressed.filter(b => !/^table\b/i.test(txt(b))).sort((x, y) => y.classList.contains('v-chip') - x.classList.contains('v-chip'))
    .forEach(b => put('filter', b));
  return found;
}"""

MENU_STATE = r"""b => { const list = document.getElementById(b.getAttribute('aria-controls')), a = document.activeElement;
  // a menu row's name is its label span: the count beside it is a separate column, not part of the name
  const txt = el => { if (!el) return ''; const lab = el.querySelector && el.querySelector('.v-menu-text');
    return ((lab || el).innerText || (lab || el).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60); };
  return { expanded: b.getAttribute('aria-expanded'), onButton: a === b, inList: !!(list && a && a !== list && list.contains(a)),
    onCurrent: !!(a && a.hasAttribute('aria-current')), hasCurrent: !!(list && list.querySelector('[aria-current]')),
    isLink: !!(a && a.matches('a[href]')), allItem: /^all repositories$/i.test(txt(a)), active: txt(a) || (a ? a.tagName.toLowerCase() : '') }; }"""

ACTIVE = r"""() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
  let s = a.tagName.toLowerCase(); if (a.id) s += '#' + a.id; if (a.classList.length) s += '.' + [...a.classList].slice(0, 2).join('.');
  return s + ' "' + (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '"'; }"""

AXE_RUN = r"""async (el) => { const r = await axe.run(el || document, { resultTypes: ['violations'] });
  return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
    nodes: v.nodes.slice(0, 8).map(n => ({ target: n.target.join(' '), summary: (n.failureSummary || '').slice(0, 300) })) })); }"""

# Nearest card-like ancestor of a control: what a state screenshot and its axe run cover.
CARD = 'xpath=ancestor::*[self::figure or self::section or contains(concat(" ", normalize-space(@class), " "), " v-card ")][1]'
CHECKS = []
HEAD_GEO = {}   # theme -> (page id, geometry) of the first page measured, the reference of head-geometry


def record(rule, capture, result, detail=''):
    """One checks.json row. result: True/False, or 'skip' (not applicable) / 'error' (the check itself broke)."""
    result = {True: 'pass', False: 'fail'}.get(result, result)
    CHECKS.append({'rule': rule, 'capture': capture, 'result': result, 'detail': str(detail)[:600]})


def record_axe(rule, cid, violations, label=''):
    pre = f'{label}: ' if label else ''
    if isinstance(violations, str):
        return record(rule, cid, 'error', pre + violations)
    bad = [v for v in violations if v.get('impact') in SERIOUS]
    if bad:
        detail = '; '.join(f"{v['id']} ({v['impact']}) x{v['count']}: {v['nodes'][0]['target'] if v['nodes'] else ''}" for v in bad)
    else:
        detail = f'{len(violations)} minor/moderate' if violations else 'no violations'
    record(rule, cid, not bad, pre + detail)


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:40] or 'x'


def short(e):
    return f'{e.__class__.__name__}: {str(e).splitlines()[0][:200] if str(e) else ""}'


def settle(page):
    """Scroll the whole page so lazily mounted charts (IntersectionObserver) render, then return to top."""
    page.wait_for_load_state('networkidle')
    vh, y = page.viewport_size['height'], 0
    while y < page.evaluate('document.documentElement.scrollHeight'):
        page.evaluate(f'window.scrollTo(0, {y})')
        page.wait_for_timeout(80)
        y += vh // 2
    page.evaluate('window.scrollTo(0, 0)')
    page.wait_for_timeout(300)


def reload(page, url):
    page.goto(url, wait_until='load')
    page.wait_for_timeout(300)
    return page.evaluate(TAG)


def tiles(page, out, cid, vw, vh, cap, files):
    """Viewport-height slices, appended to files as each one is written. The height is re-read before every slice (late chart
    mounts and list init change it); the last slice is a full viewport ending at the bottom, never a thin sliver; a clip that
    Playwright still rejects (its full-page image can come out a few px under scrollHeight) is lifted in 16px steps."""
    y, h = 0, 0
    for i in range(cap):
        h = page.evaluate('document.documentElement.scrollHeight')
        if y >= h:
            return
        top, height = max(0, min(y, h - vh)), min(vh, h)
        f = out / 'tiles' / f'{cid}--{i:02d}.png'
        for lift in range(0, 129, 16):
            try:
                page.screenshot(path=str(f), full_page=True, clip={'x': 0, 'y': max(0, top - lift), 'width': vw, 'height': height})
                break
            except Exception:
                if lift == 128 or top - lift <= 0:
                    raise
        files.append(f.relative_to(out).as_posix())
        if top + vh >= h:
            return
        y += vh
    print(f'  {cid}: page is {h}px, kept the first {cap} tiles')


def shot(locator, f):
    try:
        locator.scroll_into_view_if_needed(timeout=2000)
        locator.screenshot(path=str(f), timeout=5000)
        return True
    except Exception as e:  # a state that cannot be captured is reported, not fatal
        print(f'  skip {f.name}: {e.__class__.__name__}')
        return False


def region(page, f, locs, pad=16):
    """Screenshot the union of the locators' boxes plus padding: a menu or panel together with its trigger."""
    boxes = []
    for loc in locs:
        try:
            b = loc.bounding_box(timeout=1000) if loc.count() else None
        except Exception:
            b = None
        if b and b['width'] > 0 and b['height'] > 0:
            boxes.append(b)
    if not boxes:
        return False
    vw, vh = page.viewport_size['width'], page.viewport_size['height']
    x0, x1 = max(0, min(b['x'] for b in boxes) - pad), min(vw, max(b['x'] + b['width'] for b in boxes) + pad)
    y0, y1 = min(b['y'] for b in boxes) - pad, max(b['y'] + b['height'] for b in boxes) + pad
    if y0 >= 0 and y1 <= vh:   # inside the viewport: a plain screenshot leaves the page exactly as it is
        page.screenshot(path=str(f), clip={'x': x0, 'y': y0, 'width': x1 - x0, 'height': y1 - y0})
    else:
        sy, h = page.evaluate('[window.scrollY, document.documentElement.scrollHeight]')
        top = max(0, y0 + sy)
        page.screenshot(path=str(f), full_page=True, clip={'x': x0, 'y': top, 'width': x1 - x0, 'height': min(h, y1 + sy) - top})
    return True


def focus_band(page):
    """A viewport clip, 400px tall, that contains the focused element."""
    vw, vh = page.viewport_size['width'], page.viewport_size['height']
    top = page.evaluate('(document.activeElement && document.activeElement !== document.body) ? document.activeElement.getBoundingClientRect().top : 0')
    h = min(400, vh)
    return {'x': 0, 'y': max(0, min(top - 120, vh - h)), 'width': vw, 'height': h}


def run_axe(page, axe_src, target=None):
    """axe violations on the document or on one element; a string when axe could not run."""
    try:
        if not page.evaluate('!!window.axe'):
            page.add_script_tag(content=axe_src) if axe_src else page.add_script_tag(url=AXE)
        return target.evaluate(AXE_RUN) if target is not None else page.evaluate(AXE_RUN)
    except Exception as e:
        return f'axe failed: {short(e)}'


def states(page, out, cid, url, wanted, axe_src, rep):
    """Interactive states for one capture. Each one is independent: a failure is printed and skipped."""
    d, made = out / 'states', []
    rep['axeStates'], rep['stateNotes'] = [], []

    def axe_state(name, target, label=''):
        v = run_axe(page, axe_src, target)
        rep['axeStates'].append({'state': name, 'label': label, 'violations': v})
        record_axe(f'axe-state:{name}', cid, v, label)

    def disclosure(kind, context=None):
        """Open a menu or disclosure, shoot it with its trigger, axe its panel, close it with Escape."""
        btn = page.locator(f'[data-cap="{kind}-0"]')
        panel = page.locator(f'[id="{btn.get_attribute("aria-controls", timeout=1000)}"]')
        page.evaluate('window.scrollTo(0, 0)')
        btn.click(timeout=2000)
        page.wait_for_timeout(250)
        f = d / f'{cid}--{kind}.png'
        if region(page, f, [btn, panel] + ([page.locator(context).first] if context else [])):
            made.append(f)
        if btn.get_attribute('aria-expanded', timeout=1000) != 'true':
            rep['stateNotes'].append(f'{kind}: aria-expanded is not "true" after a click')
        if kind == 'notes' and page.viewport_size['width'] >= 1024:   # the 8 + 4 grid: Sources beside Definitions, not under them
            r = page.evaluate("""() => { const d = document.querySelector('.v-notes:not([hidden]) .is-defs'), s = document.querySelector('.v-notes:not([hidden]) .is-sources');
              if (!d || !s) return null; const a = d.getBoundingClientRect(), b = s.getBoundingClientRect();
              return { defsRight: Math.round(a.right), sourcesLeft: Math.round(b.left), sameRow: Math.abs(a.top - b.top) < 4 }; }""")
            record('notes-layout', cid, 'skip' if r is None else bool(r['sameRow'] and r['sourcesLeft'] >= r['defsRight']),
                   'one column only' if r is None else f"Definitions end at {r['defsRight']}px, Sources start at {r['sourcesLeft']}px, same row: {r['sameRow']}")
        axe_state(kind, panel if panel.count() else None, found[kind][0])
        page.keyboard.press('Escape')
        page.wait_for_timeout(150)
        if btn.get_attribute('aria-expanded', timeout=1000) == 'true':
            btn.click(timeout=2000)

    def step(name, fn):
        try:
            fn()
        except Exception as e:
            print(f'  skip {cid} {name}: {short(e)}')

    found = page.evaluate(TAG)
    for kind, context in (('menu', 'header'), ('switcher', None), ('notes', None)):
        if kind in wanted and found.get(kind):
            step(kind, lambda: disclosure(kind, context))

    if 'table' in wanted and found.get('table'):
        def table():
            btn = page.locator('[data-cap="table-0"]')
            btn.scroll_into_view_if_needed(timeout=2000)
            btn.click(timeout=2000)
            page.wait_for_timeout(300)
            card = btn.locator(CARD)
            target = card if card.count() else page.locator(f'[id="{btn.get_attribute("aria-controls", timeout=1000)}"]')
            f = d / f'{cid}--table.png'
            if shot(target, f):
                made.append(f)
            axe_state('table', target if target.count() else None, found['table'][0])
            btn.click(timeout=2000)   # back to the chart
        step('table', table)

    if 'hover' in wanted:
        def hover():
            for i, c in enumerate([c for c in page.locator('main canvas').all() if c.is_visible()][:4]):
                try:
                    card = c.locator(CARD)
                    target = card if card.count() else c
                    target.scroll_into_view_if_needed(timeout=2000)
                    b = c.bounding_box()
                    page.mouse.move(b['x'] + b['width'] * 0.62, b['y'] + b['height'] * 0.5)
                    page.wait_for_timeout(200)
                    f = d / f'{cid}--hover-{i}.png'
                    if shot(target, f):
                        made.append(f)
                except Exception as e:
                    print(f'  skip hover {i}: {short(e)}')
            page.mouse.move(0, 0)
        step('hover', hover)

    if 'tabs' in wanted:
        def tabs():
            for li, tl in enumerate([t for t in page.locator('main [role=tablist]').all() if t.is_visible()][:3]):
                items = tl.locator('[role=tab]').all()[:8]
                first = next((k for k, t in enumerate(items) if t.get_attribute('aria-selected', timeout=1000) == 'true'), 0)
                box = tl.locator(CARD)
                for ti, tab in enumerate(items):
                    try:
                        label = tab.inner_text(timeout=1000).strip()
                        tab.click(timeout=2000)
                        page.wait_for_load_state('load')
                        page.wait_for_timeout(250)
                        target = box if box.count() else tl
                        f = d / f'{cid}--tabs{li}-{ti}-{slug(label)}.png'
                        if shot(target, f):
                            made.append(f)
                        axe_state('tab', target, label[:40])
                    except Exception as e:
                        print(f'  skip tab {li}-{ti}: {short(e)}')
                try:
                    items[first].click(timeout=2000)
                except Exception:
                    pass
        step('tabs', tabs)

    # Filters change the list and the URL, so each one is followed by a reload.
    if 'filter' in wanted:
        found = page.evaluate(TAG)   # a tab may have been a link that reloaded the page
        for kind in ('filter', 'show'):
            if not found.get(kind):
                continue
            def apply(kind=kind):
                btn, label = page.locator(f'[data-cap="{kind}-0"]'), found[kind][0]
                btn.scroll_into_view_if_needed(timeout=2000)
                btn.click(timeout=2000)
                page.wait_for_timeout(500)
                f = d / f'{cid}--filter-{slug(label)}.png'
                page.screenshot(path=str(f))
                made.append(f)
                live = page.locator('main [role=status][aria-live]')
                count = live.first.inner_text(timeout=1000).strip() if live.count() else 'no live count region'
                rep['stateNotes'].append(f'filter {label!r}: {count}; pressed={btn.get_attribute("aria-pressed", timeout=1000)}')
                axe_state('filter', page.locator('main').first, label)
            step(f'filter {kind}', apply)
            try:
                found = reload(page, url)
            except Exception as e:
                print(f'  reload failed after filter: {short(e)}')

    # The list controls in every form (design system v4 4.12, 4.13): an open select chip and its applied state, the empty result,
    # an expanded duplicate cluster, and below 64rem the facet panel, the sort menu, the view menu and the stuck search row.
    # Each one changes the list, so each is followed by a reload.
    def first_visible(sel):
        for el in page.locator(sel).all()[:12]:
            try:
                if el.is_visible():
                    return el
            except Exception:
                pass
        return None

    def menu_of(btn):
        return page.locator(f'[id="{btn.get_attribute("aria-controls", timeout=1000)}"]')

    def after(name, fn):
        nonlocal found
        step(name, fn)
        try:
            found = reload(page, url)
        except Exception as e:
            print(f'  reload failed after {name}: {short(e)}')

    def viewport_shot(name, anchor=None):
        if anchor is not None:
            anchor.scroll_into_view_if_needed(timeout=2000)
        f = d / f'{cid}--{name}.png'
        page.screenshot(path=str(f))
        made.append(f)

    if 'select' in wanted:
        def select():
            chip = first_visible('main [data-list] .v-chip.is-select')
            if chip is None:
                return
            chip.scroll_into_view_if_needed(timeout=2000)
            chip.click(timeout=2000)
            page.wait_for_timeout(250)
            menu = menu_of(chip)
            f = d / f'{cid}--select-open.png'
            if region(page, f, [chip, menu]):
                made.append(f)
            axe_state('select', menu if menu.count() else None, 'select chip open')
            opt = menu.locator('.v-menu-opt:not([aria-disabled="true"])').first
            if opt.count():
                opt.click(timeout=2000)
                page.keyboard.press('Escape')
                page.wait_for_timeout(300)
                viewport_shot('select-applied', chip)
        after('select', select)

    if 'empty' in wanted:
        def empty():
            box = first_visible('main [data-list] [data-filter-input]')
            if box is None:
                return
            box.scroll_into_view_if_needed(timeout=2000)
            box.fill('zzzz', timeout=2000)
            page.wait_for_timeout(300)
            # the list card's top to the viewport's top, so the empty state itself is in the shot on a phone too
            box.evaluate("el => (el.closest('[data-list]') || el).scrollIntoView({ block: 'start' })")
            page.wait_for_timeout(150)
            viewport_shot('empty-result')
            axe_state('empty', box.locator(CARD), 'empty result')
        after('empty', empty)

    if 'expander' in wanted:
        def expander():
            btn = first_visible('main [data-expander]')
            if btn is None:
                return
            btn.scroll_into_view_if_needed(timeout=2000)
            btn.click(timeout=2000)
            page.wait_for_timeout(250)
            row = btn.locator('xpath=ancestor::tr[1]')
            f = d / f'{cid}--expander-open.png'
            if region(page, f, [row, row.locator('xpath=following-sibling::tr[1]'), row.locator('xpath=following-sibling::tr[2]')]):
                made.append(f)
        after('expander', expander)

    if 'facets' in wanted:
        def facets():
            btn = first_visible('main [data-facets-toggle]')
            if btn is None:
                return
            btn.scroll_into_view_if_needed(timeout=2000)
            btn.click(timeout=2000)
            page.wait_for_timeout(250)
            chip = first_visible('main [data-list] button.v-chip[data-facet]:not([disabled])')
            if chip is not None:
                chip.click(timeout=2000)
                page.wait_for_timeout(300)
            viewport_shot('facets-open', btn)
            axe_state('facets', btn.locator(CARD), 'facet panel open, one chip pressed')
        after('facets', facets)

    for name, sel in (('sort', 'main [data-sort-menu] > button'), ('views', 'main .v-viewbar .v-btn')):
        if name in wanted:
            def menu_state(name=name, sel=sel):
                btn = first_visible(sel)
                if btn is None:
                    return
                btn.scroll_into_view_if_needed(timeout=2000)
                btn.click(timeout=2000)
                page.wait_for_timeout(250)
                f = d / f'{cid}--{name}-menu.png'
                if region(page, f, [btn, menu_of(btn)]):
                    made.append(f)
                page.keyboard.press('Escape')
            step(name, menu_state)

    if 'stuck' in wanted:
        def stuck():
            row = first_visible('main [data-list] .v-filter-row')
            if row is None:
                return
            top = row.evaluate('el => el.closest("[data-list]").getBoundingClientRect().top + window.scrollY')
            page.evaluate(f'window.scrollTo(0, {int(top) + 420})')
            page.wait_for_timeout(200)
            f = d / f'{cid}--stuck.png'
            page.screenshot(path=str(f), clip={'x': 0, 'y': 0, 'width': page.viewport_size['width'], 'height': min(360, page.viewport_size['height'])})
            made.append(f)
            page.evaluate('window.scrollTo(0, 0)')
        step('stuck', stuck)

    if 'focus' in wanted:
        def focus():
            page.goto(url, wait_until='load')   # fresh focus-navigation start
            page.wait_for_timeout(300)
            page.keyboard.press('Tab')
            record('kbd-skip', cid, page.evaluate("!!(document.activeElement && document.activeElement.matches('.v-skip'))"),
                   f'first Tab focused {page.evaluate(ACTIVE)}')
            f = d / f'{cid}--focus.png'
            page.screenshot(path=str(f), clip=focus_band(page))
            made.append(f)
            for _ in range(4):
                page.keyboard.press('Tab')
            f = d / f'{cid}--focus-5.png'
            page.screenshot(path=str(f), clip=focus_band(page))
            made.append(f)
            rep['stateNotes'].append(f'focus after 5 Tabs: {page.evaluate(ACTIVE)}')
        step('focus', focus)
    return [m.relative_to(out).as_posix() for m in made]


def keyboard_walk(page, url, cid):
    """brief §7.4 item 3 on the scope switcher, or on the header Repositories menu where a page has none."""
    page.goto(url, wait_until='load')
    page.wait_for_timeout(300)
    found = page.evaluate(TAG)
    kind = 'switcher' if found.get('switcher') else 'menu' if found.get('menu') else None
    if not kind:
        for rule in ('kbd-menu-open', 'kbd-menu-escape', 'kbd-menu-activate'):
            record(rule, cid, 'skip', 'no scope switcher or Repositories menu on this page')
        return
    btn = page.locator(f'[data-cap="{kind}-0"]')
    btn.focus(timeout=2000)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    s = btn.evaluate(MENU_STATE)
    ok = s['expanded'] == 'true' and s['inList'] and (s['onCurrent'] or not s['hasCurrent'])
    record('kbd-menu-open', cid, ok, f"{kind}: Enter -> aria-expanded={s['expanded']}, focus on {s['active']!r}"
           + ('' if s['onCurrent'] or not s['hasCurrent'] else ' (not the aria-current item)'))
    page.keyboard.press('ArrowDown')
    page.keyboard.press('Escape')
    page.wait_for_timeout(150)
    s = btn.evaluate(MENU_STATE)
    record('kbd-menu-escape', cid, s['onButton'] and s['expanded'] == 'false',
           f"ArrowDown, Escape -> aria-expanded={s['expanded']}, focus on {s['active']!r}")
    if not s['onButton']:
        btn.focus(timeout=2000)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    for _ in range(12):   # step to the first repo link that is not the current page
        page.keyboard.press('ArrowDown')
        s = btn.evaluate(MENU_STATE)
        if s['inList'] and s['isLink'] and not s['onCurrent'] and not s['allItem']:
            break
    else:
        return record('kbd-menu-activate', cid, False, f"ArrowDown never reached another repo link (focus on {s['active']!r})")
    name = s['active']
    try:
        with page.expect_navigation(wait_until='load', timeout=10000):
            page.keyboard.press('Enter')
    except Exception as e:
        return record('kbd-menu-activate', cid, False, f'Enter on {name!r} did not load a page ({short(e)})')
    title = page.title()
    record('kbd-menu-activate', cid, bool(name) and name.lower() in title.lower(), f'{name!r} -> {page.url} title {title!r}')


def hex6(v):
    v = (v or '').strip().lower()
    if re.fullmatch(r'#[0-9a-f]{3}', v):
        v = '#' + ''.join(c * 2 for c in v[1:])
    return v if re.fullmatch(r'#[0-9a-f]{6}', v) else None


def palette(page, out, theme, validator, cid):
    names = sorted({n for _, tokens, _ in PALETTE_SETS for n in tokens} | {'--surface', '--color-base-100'})
    vals = page.evaluate("""names => { const cs = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map(n => [n, cs.getPropertyValue(n).trim()])); }""", names)
    hexes = {n: hex6(v) for n, v in vals.items()}
    surface = hexes.get('--surface') or hexes.get('--color-base-100')
    report = [json.dumps(vals)]
    for label, tokens, extra in PALETTE_SETS:
        cols, rule = [hexes.get(n) for n in tokens], f'palette:{label}'
        if not all(cols):
            msg = f'{label}: validator skipped, token missing or not 6-digit hex: ' + \
                  ', '.join(f'{n}={vals.get(n)!r}' for n, c in zip(tokens, cols) if not c)
            report.append(msg)
            record(rule, cid, 'skip', msg)
            continue
        r = subprocess.run([sys.executable, str(validator), ','.join(cols), '--mode', theme,
                            *(['--surface', surface] if surface else []), *extra],
                           capture_output=True, text=True, encoding='utf-8', timeout=60,
                           env={**os.environ, 'PYTHONIOENCODING': 'utf-8'})
        report.append(f'== {label}: {", ".join(tokens)} (exit {r.returncode})\n{r.stdout}{r.stderr}')
        flagged = [ln.strip() for ln in r.stdout.splitlines() if '[FAIL]' in ln or '[WARN]' in ln]
        record(rule, cid, {0: True, 1: False}.get(r.returncode, 'error'), '; '.join(flagged) or r.stderr.strip() or 'all checks pass')
    (out / f'palette-{theme}.txt').write_text('\n'.join(report), encoding='utf-8')


def text_bans(text):
    hits = []
    for rx, label in TEXT_BANS:
        for m in list(rx.finditer(text))[:3]:
            hits.append(f"{label}: '...{text[max(0, m.start() - 30):m.end() + 30]}...'".replace('\n', ' '))
    # any middot/bullet is a hit now (TEXT_BANS); rep['lineStartDots'] still names where a dot starts a rendered line.
    return hits


def text_bans_v4(text):
    hits = []
    for rx, label in TEXT_BANS_V4:
        for m in list(rx.finditer(text))[:2]:
            hits.append(f"{label}: '...{text[max(0, m.start() - 30):m.end() + 30]}...'".replace('\n', ' '))
    return hits


def page_checks(cid, vp, rep, page_text, ban_text=''):
    """brief §7.4 items 1, 4, 5, 6 on one capture."""
    record('R1-page-width', cid, rep['scrollWidth'] <= rep['clientWidth'],
           f"scrollWidth {rep['scrollWidth']}, clientWidth {rep['clientWidth']}")
    ov = rep['overflow']
    record('R1-element-overflow', cid, not ov, '; '.join(f"{o['el']} ends at {o['right']}px" for o in ov[:5]) or 'none')
    if vp == 'desktop':
        sc = rep['innerScroll']
        record('R2-inner-scroll', cid, not sc, '; '.join(f"{s['el']} {s['scrollWidth']} > {s['clientWidth']}" for s in sc[:5]) or 'none')
    fonts = sorted(rep['fontSizes'].items(), key=lambda kv: -kv[1])
    detail = f'{len(fonts)} combos inside <main>: ' + ', '.join(f'{k} x{n}' for k, n in fonts)
    if len(fonts) > MAX_FONT_COMBOS:   # name where the rarest combos come from, so a stray size can be traced to a template
        samples = rep.get('fontSamples', {})
        detail += '; rarest: ' + '; '.join(f"{k} at {samples.get(k, '?')}" for k, _ in fonts[MAX_FONT_COMBOS:][-3:])
    record('font-combos', cid, len(fonts) <= MAX_FONT_COMBOS, detail)
    co = rep.get('cellOverflow', [])
    record('cell-overflow', cid, not co, '; '.join(f"{c['el']} {c['text']!r} +{c['over']}px" for c in co[:5]) or 'none')
    ci = rep.get('cellInset', [])
    record('cell-inset', cid, not ci, '; '.join(f"{c['el']} +{c['over']}px" for c in ci[:5]) or 'none')
    vt = rep.get('valueTruncated', [])
    record('value-truncated', cid, not vt, '; '.join(f"{c['el']} {c['text']!r} cut by {c['box']}" for c in vt[:5]) or 'none')
    record('font-loaded', cid, bool(rep.get('fontLoaded')), 'Inter Variable ' + ('rendered' if rep.get('fontLoaded') else 'did not load'))
    nu = rep.get('numerals', [])
    record('numerals', cid, not nu, '; '.join(f"{c['el']} {c['text']!r} should be {c['want']}" for c in nu[:6]) or 'none')
    if vp in ('desktop', 'laptop'):
        tb = rep.get('thBaseline', [])
        record('th-baseline', cid, not tb, '; '.join(f"{c['el']} label tops {c['tops']}" for c in tb[:5]) or 'none')
        td = rep.get('tdBaseline', [])
        record('td-baseline', cid, not td, '; '.join(f"{c['el']} first lines end at {c['ys']}" for c in td[:5]) or 'none')
    sl = rep.get('sparkLoose', [])
    record('spark-attached', cid, not sl, '; '.join(c['el'] for c in sl[:5]) or 'none')
    cf = rep.get('chartFill', [])
    record('chart-fill', cid, 'skip' if not rep.get('charts', {}).get('mounted') else not cf,
           '; '.join(f"{c['el']} is {c['w']}x{c['h']} in a {c['pw']}x{c['ph']} plot" for c in cf[:5]) or 'every mounted canvas fills its plot')
    late = rep.get('sparkLate', [])
    record('spark-range', cid, not late, '; '.join(f"{c['el']} prints {c['date']}" for c in late[:5]) or 'none')
    if vp in ('mobile', 'tablet'):
        tf = rep.get('tagFold', [])
        record('tag-fold', cid, not tf, '; '.join(f"{c['el']} {c['text']!r}" for c in tf[:5]) or 'none')
    if vp in ('desktop', 'laptop'):
        nc = rep.get('nameCut', [])
        record('name-fit', cid, not nc, '; '.join(f"{c['el']} {c['text']!r}" for c in nc[:5]) or 'none')
    if vp == 'mobile':
        sc = rep.get('smallControls', [])
        record('controls', cid, not sc, '; '.join(f"{c['el']} {c['text']!r} {c['h']}px" for c in sc[:6]) or 'none')
    # head-geometry: at 1440 the title text and the first section start at the same y on every page whose head has no
    # description and no callout (a scope switcher title and a plain title make the same row)
    hg, pid, theme = rep.get('headGeo'), cid.split('--')[0], cid.rsplit('-', 1)[-1]
    if vp == 'desktop' and hg and pid in ('overview', 'issues', 'pulls', 'seps') and not hg.get('desc') and not hg.get('callout'):
        ref = HEAD_GEO.setdefault(theme, (pid, hg))
        same = abs((hg['title'] or 0) - (ref[1]['title'] or 0)) <= 0.5 and abs(hg['section'] - ref[1]['section']) <= 0.5
        record('head-geometry', cid, same, f"title text at {hg['title']}, first section at {hg['section']}; {ref[0]}: {ref[1]['title']}, {ref[1]['section']}")
    br = rep.get('brand')
    record('brand', cid, 'skip' if not br else (not br.get('error') and br.get('contrast', 0) >= 3),
           'no brand mark in the header' if not br else br.get('error') or f"{br.get('painted', 0)} painted pixels, best contrast {br.get('contrast')} to 1")
    hits = (text_bans(page_text) + text_bans_v4(ban_text)
            + [f"a middot starts a wrapped line in {x['el']}: {x['text']!r}" for x in rep['lineStartDots']])
    record('text-bans', cid, not hits, '; '.join(hits[:8]) + (f' (+{len(hits) - 8} more)' if len(hits) > 8 else '') or 'none')
    cv = rep['canvases']
    bad = [c for c in cv if not c['metric'] or not c['label'] or c['metric'].lower() not in c['label'].lower()
           or re.search(r'\b(undefined|NaN)\b', c['label'])]
    record('canvas-labels', cid, 'skip' if not cv else not bad,
           'no canvases' if not cv else '; '.join(f"{c['el']}: metric {c['metric']!r}, aria-label {c['label']!r}" for c in bad[:5])
           or f'{len(cv)} canvases labeled')


def capture(ctx, base, out, pid, path, vp, theme, cap, wanted, axe_src, validator):
    """One page in one viewport/theme. Never raises: what was captured is kept, the failure is a check row."""
    vw, vh, _ = VIEWPORTS[vp]
    cid, url = f'{pid}--{vp}-{theme}', base + path
    entry = {'capture': cid, 'page': pid, 'viewport': vp, 'theme': theme, 'url': url, 'tiles': [], 'states': [],
             'report': f'reports/{cid}.json', 'text': f'text/{cid}.txt'}
    rep, logs, failed = {'capture': cid, 'url': url}, [], []
    print(cid, url)
    page = None
    try:
        page = ctx.new_page()
        page.on('console', lambda m: m.type in ('error', 'warning') and logs.append(f'{m.type}: {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'pageerror: {e}'))
        page.on('response', lambda r: r.status >= 400 and failed.append(f'{r.status} {r.url}'))
        resp = page.goto(url, wait_until='load')
        rep['status'] = resp.status if resp else None
        record('http-status', cid, rep['status'] == 200, f"HTTP {rep['status']}")
        settle(page)
        probe = page.evaluate(PROBE)
        text, page_text, ban_text = probe.pop('text'), probe.pop('pageText'), probe.pop('banText', '')
        rep.update(probe)
        (out / 'text' / f'{cid}.txt').write_text(text, encoding='utf-8')
        rep['axe'] = run_axe(page, axe_src)
        record_axe('axe', cid, rep['axe'])
        page_checks(cid, vp, rep, page_text, ban_text)
        try:
            tiles(page, out, cid, vw, vh, cap, entry['tiles'])
            record('tiles', cid, True, f"{len(entry['tiles'])} tiles")
        except Exception as e:   # keep the tiles already shot; states and the keyboard walk still run
            print(f'  tiles failed for {cid}: {short(e)}')
            record('tiles', cid, 'error', f"{short(e)} (kept {len(entry['tiles'])} tiles)")
        for name, fn in (('palette', lambda: palette(page, out, theme, validator, cid) if pid == 'overview' and vp == 'desktop' else None),
                         ('states', lambda: entry.__setitem__('states', states(page, out, cid, url, wanted, axe_src, rep))),
                         ('keyboard', lambda: keyboard_walk(page, url, cid) if (vp, theme) == ('desktop', 'light') else None)):
            try:
                fn()
            except Exception as e:
                print(f'  {name} failed for {cid}: {short(e)}')
                record(name, cid, 'error', short(e))
    except Exception as e:
        print(f'  capture failed for {cid}: {short(e)}')
        record('capture', cid, 'error', short(e))
        entry['error'] = short(e)
    finally:
        rep.update(console=logs, failedRequests=failed)
        try:
            (out / 'reports' / f'{cid}.json').write_text(json.dumps(rep, indent=1), encoding='utf-8')
        except Exception as e:
            print(f'  report not written for {cid}: {short(e)}')
        if page:
            try:
                page.close()
            except Exception:
                pass
    return entry


def redirects(ctx, base):
    for frm, to in LEGACY:
        want, cid = urlparse(base + to).path, f'legacy {frm}'
        page = None
        try:
            page = ctx.new_page()
            page.goto(base + frm, wait_until='load')
            try:   # meta refresh or ui.js location.replace: wait for the navigation to settle
                page.wait_for_url(lambda u: urlparse(u).path == want, timeout=5000)
                page.wait_for_load_state('load')
            except Exception:
                pass
            got = urlparse(page.url).path
            try:
                title = page.title()
            except Exception:
                title = '?'
            record('redirect', cid, got == want, f'{frm} -> {got} (want {want}), title {title!r}')
        except Exception as e:
            record('redirect', cid, 'error', short(e))
        finally:
            if page:
                try:
                    page.close()
                except Exception:
                    pass


def flush(out, index):
    """Rewrite index.json, checks.json and checks.txt; called after every capture so a killed run keeps its results."""
    (out / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
    tally = Counter(c['result'] for c in CHECKS)
    summary = {k: tally.get(k, 0) for k in ('pass', 'fail', 'error', 'skip')}
    (out / 'checks.json').write_text(json.dumps({'summary': summary, 'rules': RULES, 'checks': CHECKS}, indent=1), encoding='utf-8')
    by_rule = defaultdict(Counter)
    for c in CHECKS:
        by_rule[c['rule']][c['result']] += 1
    lines = [f"VISR UI checks (brief §7.4): {summary['pass']} pass, {summary['fail']} fail, {summary['error']} error, {summary['skip']} skip.",
             'Checks never fail the job; they are here for review. Details per row in checks.json.', '', 'By rule']
    for rule in sorted(by_rule):
        n = by_rule[rule]
        lines.append(f"  {rule:24} {n['pass']:4} pass {n['fail']:4} fail {n['error']:3} error {n['skip']:3} skip   "
                     f"{RULES.get(rule.split(':')[0], '')}")
    bad = [c for c in CHECKS if c['result'] in ('fail', 'error')]
    lines += ['', f'Failures and errors ({len(bad)})']
    for c in sorted(bad, key=lambda c: (c['rule'], c['capture'])):
        lines.append(f"  {c['result'].upper():5} {c['rule']:24} {c['capture']}\n        {c['detail']}")
    (out / 'checks.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def new_context(browser, vp, theme):
    vw, vh, dsf = VIEWPORTS[vp]
    ctx = browser.new_context(viewport={'width': vw, 'height': vh}, device_scale_factor=dsf, color_scheme=theme,
                              is_mobile=vp == 'mobile', has_touch=vp == 'mobile', reduced_motion='reduce')
    ctx.add_init_script(f"try {{ localStorage.setItem('theme', '{theme}'); }} catch (e) {{}}")
    return ctx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    out = Path(a.out)
    for sub in ('tiles', 'states', 'reports', 'text'):
        (out / sub).mkdir(parents=True, exist_ok=True)
    validator = Path(__file__).with_name('validate_palette.py')
    try:   # fetched once and injected inline, so axe does not depend on each page reaching the CDN
        axe_src = urllib.request.urlopen(AXE, timeout=30).read().decode('utf-8')
    except Exception as e:
        print(f'axe download failed ({short(e)}), injecting it by URL per page')
        axe_src = None
    index = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for vp, theme, cap, wanted in MATRIX:
                ctx = None
                for pid, path in PAGES:
                    if vp in ONLY and pid not in ONLY[vp]:
                        continue
                    if not browser.is_connected():   # a crashed browser costs one page, not the rest of the run
                        browser, ctx = pw.chromium.launch(), None
                    if ctx is None:
                        ctx = new_context(browser, vp, theme)
                    index.append(capture(ctx, a.base, out, pid, path, vp, theme, max(cap, TILE_CAPS.get(pid, 0)), wanted, axe_src, validator))
                    flush(out, index)
                if (vp, theme) == ('desktop', 'light'):
                    redirects(ctx, a.base)
                    flush(out, index)
                try:
                    ctx.close()
                except Exception:
                    pass
            try:
                browser.close()
            except Exception:
                pass
    finally:
        flush(out, index)
        tally = Counter(c['result'] for c in CHECKS)
        print(f'{len(index)} captures, {sum(len(e["tiles"]) for e in index)} tiles, '
              f'{sum(len(e["states"]) for e in index)} states; checks: {dict(tally)}')


if __name__ == '__main__':
    main()
