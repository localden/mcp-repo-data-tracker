#!/usr/bin/env python3
"""VISR UI review capture. CI only (.github/workflows/ui-review.yml): renders every page
across scopes, themes and viewports and writes what a reviewer needs to judge it.

Output (--out):
  tiles/<capture>--NN.png   full page sliced into viewport-sized tiles, top to bottom
  states/<page>--*.png      interactive states: repo picker, tabs, chart hover, table twin, filter, focus
  reports/<capture>.json    overflow, clipped text, chart mounts, font sizes, console/page errors, axe
  text/<capture>.txt        rendered text of <main>, for checking numbers against data/
  palette-<theme>.txt       validate_palette.py on the live --chart-* tokens
  index.json                every capture with its tiles and report
"""
import argparse, json, re, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

PAGES = [('overview', ''), ('issues', 'issues/'), ('pulls', 'pulls/'), ('trends', 'health/'),
         ('contributors', 'contributors/'), ('seps', 'seps/')]
SCOPES = {'default': None, 'ts': 'modelcontextprotocol/typescript-sdk', 'rust': 'modelcontextprotocol/rust-sdk'}
VIEWPORTS = {'desktop': (1440, 900, 1), 'mobile': (390, 844, 2)}
# Full scope matrix only on desktop light; the other combinations check theme and layout.
MATRIX = [('desktop', 'light', ['default', 'ts', 'rust']), ('desktop', 'dark', ['default']),
          ('mobile', 'light', ['default', 'ts']), ('mobile', 'dark', ['default'])]
SINGLE_SCOPE = {'seps'}
MAX_TILES = 40
AXE = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js'

PROBE = r"""() => {
  const vw = document.documentElement.clientWidth;
  const name = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].slice(0, 3).join('.'); return s; };
  const path = el => { const p = []; for (let e = el; e && e !== document.body && p.length < 4; e = e.parentElement) p.unshift(name(e)); return p.join(' > '); };
  const shown = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; };
  const all = [...document.querySelectorAll('body *')].filter(shown);
  const scrolls = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
    const o = getComputedStyle(e).overflowX; if (o !== 'visible') return true; } return false; };
  const ownText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const overflow = all.filter(el => el.getBoundingClientRect().right > vw + 1 && !scrolls(el)).slice(0, 25)
    .map(el => ({ el: path(el), right: Math.round(el.getBoundingClientRect().right) }));
  const clipped = all.filter(el => ownText(el) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible').slice(0, 40)
    .map(el => ({ el: path(el), text: el.textContent.trim().slice(0, 100) }));
  const canvases = [...document.querySelectorAll('canvas[data-viz]')];
  const mounted = c => !!(window.Chart && Chart.getChart(c));
  const fonts = {}, colors = {};
  all.filter(ownText).forEach(el => { const cs = getComputedStyle(el);
    const f = cs.fontSize + ' ' + cs.fontWeight; fonts[f] = (fonts[f] || 0) + 1; colors[cs.color] = (colors[cs.color] || 0) + 1; });
  return { title: document.title, scope: document.documentElement.dataset.scope, theme: document.documentElement.dataset.theme,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, height: document.documentElement.scrollHeight,
    overflow, clipped, fontSizes: fonts, textColors: colors,
    charts: { total: canvases.length, shown: canvases.filter(shown).length, mounted: canvases.filter(mounted).length,
              shownNotMounted: canvases.filter(c => shown(c) && !mounted(c)).map(c => c.id || path(c)) },
    text: (document.querySelector('main') || document.body).innerText };
}"""

AXE_RUN = r"""async () => { const r = await axe.run(document, { resultTypes: ['violations'] });
  return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
    nodes: v.nodes.slice(0, 8).map(n => ({ target: n.target.join(' '), summary: (n.failureSummary || '').slice(0, 300) })) })); }"""


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')[:40] or 'x'


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


def tiles(page, out, cid, vw, vh):
    h = page.evaluate('document.documentElement.scrollHeight')
    files = []
    for i, y in enumerate(range(0, h, vh)):
        if i == MAX_TILES:
            print(f'  {cid}: page is {h}px, kept the first {MAX_TILES} tiles')
            break
        f = out / 'tiles' / f'{cid}--{i:02d}.png'
        page.screenshot(path=str(f), full_page=True, clip={'x': 0, 'y': y, 'width': vw, 'height': min(vh, h - y)})
        files.append(f.relative_to(out).as_posix())
    return files


def shot(locator, f):
    try:
        locator.scroll_into_view_if_needed(timeout=2000)
        locator.screenshot(path=str(f), timeout=5000)
        return True
    except Exception as e:  # a state that cannot be captured is reported, not fatal
        print(f'  skip {f.name}: {e.__class__.__name__}')
        return False


def states(page, out, pname, url):
    """Interactive states, captured once per page on desktop."""
    d, made = out / 'states', []
    root = page.locator(f'.repo-content[data-repo="{page.evaluate("document.documentElement.dataset.scope")}"]')
    scope = root if root.count() else page.locator('main')

    trig = page.locator('header .dropdown > [tabindex], header .dropdown > button, header .dropdown > summary').first
    if trig.count():
        try:
            trig.click(timeout=2000); page.wait_for_timeout(250)
            f = d / f'{pname}--repo-picker.png'
            page.screenshot(path=str(f), clip={'x': 0, 'y': 0, 'width': 1440, 'height': 720}); made.append(f)
            page.evaluate('document.activeElement && document.activeElement.blur()')   # daisy dropdown is focus-driven
        except Exception as e:
            print(f'  skip repo picker: {e.__class__.__name__}')

    for tl_i, tl in enumerate(scope.locator('[role=tablist]').all()[:3]):
        if not tl.is_visible():
            continue
        for t_i, tab in enumerate(tl.locator('[role=tab]').all()[:6]):
            try:
                tab.click(timeout=2000); page.wait_for_timeout(250)
            except Exception:
                continue
            box = tl.locator('xpath=ancestor::*[self::section or contains(@class,"v-panel")][1]')
            f = d / f'{pname}--tabs{tl_i}-{t_i}-{slug(tab.inner_text())}.png'
            if shot(box if box.count() else tl, f): made.append(f)
        try:
            tl.locator('[role=tab]').first.click(timeout=2000)
        except Exception:
            pass

    for c_i, canvas in enumerate([c for c in scope.locator('canvas[data-viz]').all() if c.is_visible()][:4]):
        try:
            canvas.scroll_into_view_if_needed(timeout=2000)
            b = canvas.bounding_box()
            page.mouse.move(b['x'] + b['width'] * 0.62, b['y'] + b['height'] * 0.5); page.wait_for_timeout(150)
            fig = canvas.locator('xpath=ancestor::figure[1]')
            f = d / f'{pname}--hover-{c_i}.png'
            if shot(fig if fig.count() else canvas, f): made.append(f)
        except Exception as e:
            print(f'  skip hover {c_i}: {e.__class__.__name__}')
    page.mouse.move(0, 0)

    twin = [t for t in scope.locator('details.v-twin > summary').all() if t.is_visible()][:1]
    if twin:
        twin[0].click(); page.wait_for_timeout(200)
        f = d / f'{pname}--table-twin.png'
        if shot(twin[0].locator('xpath=ancestor::figure[1]'), f): made.append(f)

    chips = [c for c in scope.locator('[data-filter]').all() if c.is_visible()][:1]
    if chips:
        chips[0].click(); page.wait_for_timeout(900)   # ui.js smooth-scrolls to the results
        f = d / f'{pname}--filter-{slug(chips[0].inner_text())}.png'
        page.screenshot(path=str(f)); made.append(f)
        chips[0].click()

    page.goto(url, wait_until='load')   # fresh focus-navigation start for the keyboard pass
    for _ in range(5):
        page.keyboard.press('Tab')
    f = d / f'{pname}--focus.png'
    page.screenshot(path=str(f), clip={'x': 0, 'y': 0, 'width': 1440, 'height': 400}); made.append(f)
    return [m.relative_to(out).as_posix() for m in made]


def palette(page, out, theme, validator):
    vals = page.evaluate("""() => { const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
      return { chart: [1,2,3,4,5,6,7,8].map(i => g('--chart-' + i)), ord: [1,2,3,4,5].map(i => g('--ord-' + i)), surface: g('--color-base-100') }; }""")
    report = [json.dumps(vals)]
    for label, cols, extra in (('categorical', vals['chart'], []), ('ordinal', vals['ord'], ['--ordinal'])):
        if not all(re.fullmatch(r'#[0-9a-fA-F]{6}', c) for c in cols):
            report.append(f'{label}: tokens are not 6-digit hex, validator skipped: {cols}')
            continue
        r = subprocess.run([sys.executable, str(validator), ','.join(cols), '--mode', theme, '--surface', vals['surface'], *extra],
                           capture_output=True, text=True)
        report.append(f'== {label} (exit {r.returncode})\n{r.stdout}{r.stderr}')
    (out / f'palette-{theme}.txt').write_text('\n'.join(report), encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    out = Path(a.out)
    for sub in ('tiles', 'states', 'reports', 'text'):
        (out / sub).mkdir(parents=True, exist_ok=True)
    validator = Path(__file__).with_name('validate_palette.py')
    index = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for vp, theme, scopes in MATRIX:
            vw, vh, dsf = VIEWPORTS[vp]
            ctx = browser.new_context(viewport={'width': vw, 'height': vh}, device_scale_factor=dsf, color_scheme=theme,
                                      is_mobile=vp == 'mobile', has_touch=vp == 'mobile', reduced_motion='reduce')
            ctx.add_init_script(f"try {{ localStorage.setItem('theme', '{theme}'); }} catch (e) {{}}")
            for pname, path in PAGES:
                for sc in scopes:
                    if sc != 'default' and pname in SINGLE_SCOPE:
                        continue
                    cid = f'{pname}--{vp}-{theme}-{sc}'
                    url = a.base + path + (f'?repo={SCOPES[sc]}' if SCOPES[sc] else '')
                    print(cid, url)
                    page = ctx.new_page()
                    logs, failed = [], []
                    page.on('console', lambda m, logs=logs: m.type in ('error', 'warning') and logs.append(f'{m.type}: {m.text}'))
                    page.on('pageerror', lambda e, logs=logs: logs.append(f'pageerror: {e}'))
                    page.on('response', lambda r, failed=failed: r.status >= 400 and failed.append(f'{r.status} {r.url}'))
                    page.goto(url, wait_until='load')
                    settle(page)
                    rep = page.evaluate(PROBE)
                    text = rep.pop('text')
                    (out / 'text' / f'{cid}.txt').write_text(text, encoding='utf-8')
                    rep.update(capture=cid, url=url, console=logs, failedRequests=failed)
                    if sc == 'default':
                        try:
                            page.add_script_tag(url=AXE)
                            rep['axe'] = page.evaluate(AXE_RUN)
                        except Exception as e:
                            rep['axe'] = f'axe failed: {e}'
                    entry = {'capture': cid, 'page': pname, 'viewport': vp, 'theme': theme, 'scope': sc, 'url': url,
                             'tiles': tiles(page, out, cid, vw, vh), 'report': f'reports/{cid}.json', 'text': f'text/{cid}.txt'}
                    try:
                        if vp == 'desktop' and sc == 'default':
                            entry['states'] = states(page, out, f'{pname}-{theme}', url)
                        if pname == 'overview' and vp == 'desktop' and sc == 'default':
                            palette(page, out, theme, validator)
                    except Exception as e:
                        print(f'  states/palette failed for {cid}: {e}')
                    (out / 'reports' / f'{cid}.json').write_text(json.dumps(rep, indent=1), encoding='utf-8')
                    index.append(entry)
                    page.close()
            ctx.close()
        browser.close()
    (out / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
    print(f'{len(index)} captures, {sum(len(e["tiles"]) for e in index)} tiles')


if __name__ == '__main__':
    main()
