#!/usr/bin/env node
// slack-snapshot generator — emits Slack mrkdwn digest of SDK health to stdout.
// No external deps. Exit 0 always; missing data renders "—".
//
// Usage: node .claude/skills/slack-snapshot/generate.mjs [--format mrkdwn|svg] [--dashboard-url URL]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const DATA = join(ROOT, 'data');

// ---------- helpers ----------
const readJSON = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};
const dash = '—';
const pad = (s, w) => String(s).padEnd(w);
const fmtNum = (n) => {
  if (n == null || !isFinite(n)) return dash;
  const abs = Math.abs(n);
  if (abs >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
};
const fmtPct = (cur, prev) => {
  if (cur == null || prev == null || prev === 0) return ` ${dash} `;
  const p = ((cur - prev) / prev) * 100;
  const s = (p >= 0 ? '+' : '') + p.toFixed(0) + '%';
  return s;
};
const fmtDelta = (cur, prev) => {
  if (cur == null) return dash;
  if (prev == null) return `${cur} (${dash})`;
  const d = cur - prev;
  return `${cur} (${d >= 0 ? '+' : ''}${d})`;
};
const fmtHours = (h) => {
  // 0 here means "no data points" (e.g., issues never assigned), not "instant"
  if (h == null || !isFinite(h) || h === 0) return dash;
  return Math.round(h) + 'h';
};
const fmtDate = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ---------- load repo list ----------
const reposCfg = readJSON(join(DATA, 'repos.json'));
if (!reposCfg) { console.log('_(no data/repos.json found)_'); process.exit(0); }
const repos = reposCfg.repositories || [];

// ---------- variant detection ----------
let mode = null;
for (const r of repos) {
  const m = readJSON(join(DATA, 'repos', r.owner, r.repo, 'metrics.json'));
  if (m?.issues) {
    if ('without_response_7d' in m.issues) { mode = 'MCP'; break; }
    if ('unassigned_7d' in m.issues) { mode = 'ANT'; break; }
  }
}
if (!mode) mode = 'MCP';

const triageField = mode === 'ANT' ? 'unassigned_7d' : 'without_response_7d';
const triageLabel = mode === 'ANT' ? 'unassigned>7d' : 'no-resp>7d';
const respTimeKey = mode === 'ANT' ? 'assignment_time' : 'response_time';
// ANT triage is assignment-based (most issues are unassigned by design) so the
// ratio rule is noise there; flag only large absolute backlogs and slower review p90.
const TH = mode === 'ANT'
  ? { triageAbs: 30, triageRatio: null, p90h: 400 }
  : { triageAbs: 10, triageRatio: 0.2, p90h: 120 };

// ---------- args ----------
function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const format = arg('--format', 'mrkdwn');
const dashboardUrl = arg('--dashboard-url',
  mode === 'ANT'
    ? 'https://localden.github.io/ant-repo-data-tracker'
    : 'https://modelcontextprotocol.github.io/repo-data-tracker');

// ---------- per-repo snapshot loading ----------
function loadRepo(r) {
  const dir = join(DATA, 'repos', r.owner, r.repo);
  const snapDir = join(dir, 'snapshots');
  let cur = null, prev = null, curDate = null, prevDate = null;
  if (existsSync(snapDir)) {
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json')).sort();
    if (files.length) {
      const last = files[files.length - 1];
      cur = readJSON(join(snapDir, last));
      curDate = last.replace('.json', '');
      // prev = snapshot ~7 days before latest (true WoW); fall back to earliest
      const target = new Date(curDate);
      target.setDate(target.getDate() - 7);
      const tgtStr = target.toISOString().slice(0, 10);
      let pf = null;
      for (let i = files.length - 2; i >= 0; i--) {
        const d = files[i].replace('.json', '');
        if (d <= tgtStr) { pf = files[i]; break; }
      }
      if (!pf && files.length >= 2) pf = files[0];
      if (pf) {
        prev = readJSON(join(snapDir, pf));
        prevDate = pf.replace('.json', '');
      }
    }
  }
  if (!cur) cur = readJSON(join(dir, 'metrics.json'));
  // last ~14 snapshots for sparklines (svg mode)
  let recent = [];
  if (existsSync(snapDir)) {
    const files = readdirSync(snapDir).filter(f => f.endsWith('.json')).sort();
    recent = files.slice(-14).map(f => readJSON(join(snapDir, f))).filter(Boolean);
  }
  return { cfg: r, cur, prev, curDate, prevDate, recent };
}

const loaded = repos.map(loadRepo);

// ---------- date range header ----------
const curDates = loaded.map(l => l.curDate).filter(Boolean).sort();
const prevDates = loaded.map(l => l.prevDate).filter(Boolean).sort();
const headerCur = curDates.length ? fmtDate(curDates[curDates.length - 1]) : fmtDate(new Date());
const headerPrev = prevDates.length ? fmtDate(prevDates[0]) : dash;

// ---------- partition: spec repo vs the rest ----------
const isSpec = (r) => r.cfg.owner === 'modelcontextprotocol' && r.cfg.repo === 'modelcontextprotocol';
const specRepo = loaded.find(isSpec);
const sdkRepos = loaded.filter(l => !isSpec(l));

// sort: by downloads.last_week desc, no-download repos last alphabetically
sdkRepos.sort((a, b) => {
  const da = a.cur?.downloads?.last_week;
  const db = b.cur?.downloads?.last_week;
  if (da != null && db != null) return db - da;
  if (da != null) return -1;
  if (db != null) return 1;
  return (a.cfg.name || a.cfg.repo).localeCompare(b.cfg.name || b.cfg.repo);
});

// ---------- table rendering ----------
function shortName(r) {
  return (r.cfg.name || r.cfg.repo).replace(/\s+SDK$/i, '').replace(/^MCP\s+/i, '');
}

function rowFor(l) {
  const c = l.cur || {}, p = l.prev || {};
  const dlCur = c.downloads?.last_week;
  const dlPrev = p.downloads?.last_week;
  const dl = dlCur != null ? `${fmtNum(dlCur)} (${fmtPct(dlCur, dlPrev)})` : `${dash} ( ${dash} )`;
  const issOpen = c.issues?.open ?? c.issues?.open_count;
  const issPrev = p.issues?.open ?? p.issues?.open_count;
  const triage = c.issues?.[triageField];
  const triageWarn = triage != null && (triage > TH.triageAbs || (TH.triageRatio && issOpen && triage / issOpen > TH.triageRatio));
  const p50 = c.issues?.[respTimeKey]?.median_hours;
  const p90 = c.pulls?.review_time?.p90_hours;
  const p90Warn = p90 != null && p90 > TH.p90h;
  return {
    name: shortName(l),
    dl,
    iss: fmtDelta(issOpen, issPrev),
    triage: triage != null ? `${triage}${triageWarn ? ' ⚠' : ''}` : dash,
    p50: fmtHours(p50),
    p90: p90 != null ? `${fmtHours(p90)}${p90Warn ? ' ⚠' : ''}` : dash,
  };
}

const W = { name: 14, dl: 16, iss: 11, triage: 15, p50: 10, p90: 9 };
function renderTable(rows) {
  const hdr = '`' + pad('SDK', W.name) + pad('dl/wk (WoW)', W.dl) + pad('iss (Δ)', W.iss)
    + pad(triageLabel, W.triage) + pad('p50 resp', W.p50) + 'PR p90`';
  const lines = [hdr];
  for (const r of rows) {
    lines.push('`' + pad(r.name, W.name) + pad(r.dl, W.dl) + pad(r.iss, W.iss)
      + pad(r.triage, W.triage) + pad(r.p50, W.p50) + r.p90 + '`');
  }
  return lines.join('\n');
}

// ---------- anomaly detection ----------
const SEV = { CRIT: 0, WARN: 1, INFO: 2 };
function anomalies(l) {
  const out = [];
  const c = l.cur || {}, p = l.prev || {};
  const name = shortName(l);
  const open = c.issues?.open ?? c.issues?.open_count;
  const triC = c.issues?.[triageField], triP = p.issues?.[triageField];
  if (triC != null && (triC > TH.triageAbs || (TH.triageRatio && open && triC / open > TH.triageRatio))) {
    out.push({ sev: SEV.CRIT, name, msg: `${triageLabel} ${triP ?? dash}→${triC} — assign triage rota owner` });
  }
  const p90 = c.pulls?.review_time?.p90_hours;
  if (p90 != null && p90 > TH.p90h) {
    out.push({ sev: SEV.CRIT, name, msg: `PR review p90 ${fmtHours(p90)} — clear oldest external PRs` });
  }
  const o7 = c.issues?.opened_7d, cl7 = c.issues?.closed_7d;
  const po7 = p.issues?.opened_7d, pcl7 = p.issues?.closed_7d;
  if (o7 != null && cl7 != null && o7 / Math.max(cl7, 1) > 1.5
      && po7 != null && pcl7 != null && po7 / Math.max(pcl7, 1) > 1.5) {
    out.push({ sev: SEV.WARN, name, msg: `issue open/close ratio ${(o7 / Math.max(cl7, 1)).toFixed(1)}× two weeks running — backlog growing` });
  }
  const dlC = c.downloads?.last_week, dlP = p.downloads?.last_week;
  if (dlC != null && dlP != null && dlP > 0) {
    const wow = (dlC - dlP) / dlP;
    if (wow < -0.15) out.push({ sev: SEV.WARN, name, msg: `downloads WoW ${fmtPct(dlC, dlP)} — investigate registry/release` });
    else if (wow > 0.5) out.push({ sev: SEV.INFO, name, msg: `downloads WoW ${fmtPct(dlC, dlP)} — spike worth noting` });
  }
  const stale = c.issues?.stale_60d;
  if (stale != null && open && stale / open > 0.15) {
    out.push({ sev: SEV.WARN, name, msg: `stale>60d ${stale}/${open} (${Math.round(stale / open * 100)}%) — sweep or close` });
  }
  const ftC = c.contributors?.first_time_30d, ftP = p.contributors?.first_time_30d;
  if (ftC === 0 && ftP === 0) {
    out.push({ sev: SEV.INFO, name, msg: `0 first-time contributors two periods running — check good-first-issue pipeline` });
  }
  if (mode === 'MCP') {
    const breach = c.actionability?.sla?.first_review_7d_breach;
    if (breach != null && breach > 0) {
      out.push({ sev: SEV.CRIT, name, msg: `${breach} PR(s) past 7d first-review SLA — review today` });
    }
  }
  return out;
}

let allAnoms = [];
for (const l of loaded) allAnoms.push(...anomalies(l));
allAnoms.sort((a, b) => a.sev - b.sev);
allAnoms = allAnoms.slice(0, 5);

// ---------- actionability aggregate (MCP only) ----------
let actLine = '';
if (mode === 'MCP') {
  let sum = 0, target = 0, n = 0;
  for (const l of sdkRepos) {
    const a = l.cur?.actionability;
    if (a?.actionable_count != null) { sum += a.actionable_count; n++; }
    if (a?.sla?.actionable_target != null) target += a.sla.actionable_target;
  }
  if (n > 0) actLine = `Actionable PRs: *${sum}* (target ${target || dash})`;
}

// ---------- SVG renderer ----------
function svgTileFor(l) {
  const c = l.cur || {}, p = l.prev || {};
  const dlW = c.downloads?.last_week;
  const dlWp = p.downloads?.last_week;
  const wow = dlW != null && dlWp ? Math.round((dlW - dlWp) / dlWp * 100) : null;
  const issOpen = c.issues?.open ?? c.issues?.open_count;
  const issPrev = p.issues?.open ?? p.issues?.open_count;
  const tri = c.issues?.[triageField];
  const p90 = c.pulls?.review_time?.p90_hours;
  const triageWarn = tri != null && (tri > TH.triageAbs || (TH.triageRatio && issOpen && tri / issOpen > TH.triageRatio));
  const p90Warn = p90 != null && p90 > TH.p90h;
  const warnCount = (triageWarn ? 1 : 0) + (p90Warn ? 1 : 0);
  const status = warnCount >= 2 ? 'red' : warnCount === 1 ? 'yellow' : 'green';
  let series = (l.recent || []).map(s => s.downloads?.daily).filter(v => v != null && isFinite(v));
  let sparkLabel = 'dl/day';
  if (series.length < 5) {
    series = (l.recent || []).map(s => s.issues?.open ?? s.issues?.open_count).filter(v => v != null);
    sparkLabel = 'open iss';
  }
  return {
    name: shortName(l), status, dlW, wow, issOpen,
    issD: issOpen != null && issPrev != null ? issOpen - issPrev : null,
    tri, p90, triageWarn, p90Warn, series, sparkLabel,
  };
}

function renderSvg() {
  const C = { bg: '#0f1419', panel: '#1a2129', text: '#e6edf3', sub: '#8b949e',
              red: '#f85149', yellow: '#d29922', green: '#3fb950' };
  const FONT = 'font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Inter,system-ui,sans-serif"';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const fmtDur = (h) => h == null || h === 0 ? dash : h >= 48 ? Math.round(h / 24) + 'd' : Math.round(h) + 'h';
  const triageWord = mode === 'ANT' ? 'untriaged' : 'no-resp';

  const tiles = [...sdkRepos, ...(specRepo ? [specRepo] : [])].map(svgTileFor);
  const order = { red: 0, yellow: 1, green: 2 };
  tiles.sort((a, b) => order[a.status] - order[b.status] || (b.dlW ?? 0) - (a.dlW ?? 0));

  const TW = 280, THt = 110, COLS = 2, GAP = 16, PAD = 24;
  const Wd = PAD * 2 + COLS * TW + (COLS - 1) * GAP;
  const rowsN = Math.ceil(tiles.length / COLS);
  const tilesH = rowsN * THt + (rowsN - 1) * GAP;
  const attn = tiles.filter(t => t.status !== 'green').slice(0, 4);
  const attnH = attn.length ? 28 + attn.length * 22 + 12 : 0;
  const Ht = 70 + tilesH + (attnH ? 20 + attnH : 0) + 36;

  const spark = (series, x, y, w, h, color) => {
    if (series.length < 2) return '';
    const lo = Math.min(...series), hi = Math.max(...series), rng = hi - lo || 1;
    const pts = series.map((v, i) =>
      `${(x + i * w / (series.length - 1)).toFixed(1)},${(y + h - (v - lo) / rng * h).toFixed(1)}`).join(' ');
    const [lx, ly] = pts.split(' ').pop().split(',');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` +
           `<circle cx="${lx}" cy="${ly}" r="2.5" fill="${color}"/>`;
  };

  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${Ht}" viewBox="0 0 ${Wd} ${Ht}">`;
  s += `<rect width="${Wd}" height="${Ht}" fill="${C.bg}"/>`;
  s += `<text x="${PAD}" y="36" fill="${C.text}" ${FONT} font-size="22" font-weight="700">SDK Health</text>`;
  s += `<text x="${PAD}" y="56" fill="${C.sub}" ${FONT} font-size="13">week of ${esc(headerPrev)} → ${esc(headerCur)}</text>`;

  tiles.forEach((t, i) => {
    const cx = PAD + (i % COLS) * (TW + GAP);
    const cy = 70 + Math.floor(i / COLS) * (THt + GAP);
    const dot = C[t.status];
    const tint = t.status === 'red' ? '#2d1618' : t.status === 'yellow' ? '#2b2417' : C.panel;
    s += `<rect x="${cx}" y="${cy}" width="${TW}" height="${THt}" rx="10" fill="${tint}" stroke="${dot}" stroke-opacity="0.35"/>`;
    s += `<circle cx="${cx + 18}" cy="${cy + 22}" r="6" fill="${dot}"/>`;
    s += `<text x="${cx + 32}" y="${cy + 27}" fill="${C.text}" ${FONT} font-size="15" font-weight="600">${esc(t.name)}</text>`;
    s += `<text x="${cx + TW - 16}" y="${cy + 27}" fill="${C.sub}" ${FONT} font-size="9" text-anchor="end">${t.sparkLabel}</text>`;
    const head = t.dlW != null ? `${fmtNum(t.dlW)}/wk` : `${t.issOpen ?? dash} issues`;
    const subBits = [];
    if (t.dlW != null && t.wow != null) subBits.push(`${t.wow >= 0 ? '▲' : '▼'}${Math.abs(t.wow)}%`);
    else if (t.issD != null) subBits.push(`${t.issD >= 0 ? '+' : ''}${t.issD}`);
    subBits.push(`${t.tri ?? dash} ${triageWord}`);
    subBits.push(`p90 ${fmtDur(t.p90)}`);
    s += `<text x="${cx + 16}" y="${cy + 54}" fill="${C.text}" ${FONT} font-size="20" font-weight="700">${esc(head)}</text>`;
    s += `<text x="${cx + 16}" y="${cy + 72}" fill="${C.sub}" ${FONT} font-size="11">${esc(subBits.join(' · '))}</text>`;
    s += spark(t.series, cx + 16, cy + 80, TW - 32, 20, dot);
  });

  if (attn.length) {
    const ay = 70 + tilesH + 20;
    s += `<text x="${PAD}" y="${ay + 16}" fill="${C.text}" ${FONT} font-size="14" font-weight="700">Needs attention</text>`;
    attn.forEach((t, i) => {
      const y = ay + 36 + i * 22;
      const bits = [];
      if (t.triageWarn) bits.push(`${t.tri} ${triageWord} >7d`);
      if (t.p90Warn) bits.push(`PR p90 ${fmtDur(t.p90)}`);
      s += `<circle cx="${PAD + 6}" cy="${y - 4}" r="3" fill="${C[t.status]}"/>`;
      s += `<text x="${PAD + 18}" y="${y}" fill="${C.text}" ${FONT} font-size="12"><tspan font-weight="600">${esc(t.name)}</tspan> — ${esc(bits.join('; '))}</text>`;
    });
  }
  s += `<text x="${PAD}" y="${Ht - 14}" fill="${C.sub}" ${FONT} font-size="11">${esc(dashboardUrl.replace(/^https?:\/\//, ''))}</text>`;
  s += `</svg>`;
  return s;
}

// ---------- emit ----------
if (format === 'svg') {
  process.stdout.write(renderSvg());
} else {
  const out = [];
  out.push(`*SDK Health — week of ${headerPrev} → ${headerCur}*`);
  out.push('');
  out.push(renderTable(sdkRepos.map(rowFor)));
  if (actLine) { out.push(''); out.push(actLine); }

  if (specRepo) {
    out.push('');
    out.push('*Specification*');
    const r = rowFor(specRepo);
    const c = specRepo.cur || {};
    const prOpen = c.pulls?.open ?? c.pulls?.open_count;
    out.push('`' + pad(r.name, W.name) + pad(r.dl, W.dl) + pad(r.iss, W.iss)
      + pad(r.triage, W.triage) + pad(r.p50, W.p50) + r.p90 + '`');
    out.push(`Open PRs: ${prOpen ?? dash} · Stars: ${fmtNum(c.repository?.stars)} · Active maintainers (30d): ${c.contributors?.active_maintainers_30d ?? dash}`);
  }

  if (allAnoms.length) {
    out.push('');
    out.push('*Needs attention*');
    for (const a of allAnoms) out.push(`> • *${a.name}:* ${a.msg}`);
  }

  out.push('');
  out.push(`Dashboard → <${dashboardUrl}|link> · reply in thread to claim`);

  console.log(out.join('\n'));
}
