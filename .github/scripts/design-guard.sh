#!/usr/bin/env bash
# VISR design-system guard (design system v3 §5; redesign brief §6.4, §7.3). Fails the build on banned patterns.
# The layouts/ rules grep a copy of layouts/ with {{/* */}} and <!-- --> comments blanked (line numbers
# kept), so a comment that names a banned pattern never fires. Exception: the glyph-separator rule reads the raw
# files in layouts/, static/js/ and content/, comments included (v3 §0.1: the dot is banned everywhere).
# main.css has its own checks.
set -u
root=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
(cd "$root" && find layouts -type f -name '*.html' 2>/dev/null) | while IFS= read -r f; do
  mkdir -p "$tmp/$(dirname "$f")"
  perl -0777 -pe 's{\{\{-?\s*/\*.*?\*/\s*-?\}\}|<!--.*?-->}{my $m = $&; $m =~ tr/\n//cd; $m}gse' "$root/$f" > "$tmp/$f"
done
cd "$tmp" || exit 2
fail=0
report() { # $1 = message, $2 = hits; prints the hits and the error when there are any
  if [ -n "$2" ]; then printf '%s\n' "$2"; echo "::error::design-guard: $1"; fail=1; fi
}
check() { # $1 = message, $2 = extended regex, $3 = optional regex for output lines that are allowed exceptions
  local hits
  hits=$(grep -rnE --include='*.html' -e "$2" layouts/ 2>/dev/null)
  if [ -n "${3:-}" ]; then hits=$(printf '%s\n' "$hits" | grep -vE -e "$3"); fi
  report "$1" "$hits"
}
check_in() { # $1 = message, $2 = extended regex, $3... = the only paths (under layouts/) the rule applies to
  local msg=$1 re=$2 hits
  shift 2
  hits=$(grep -rnE --include='*.html' -e "$re" "$@" 2>/dev/null)
  report "$msg" "$hits"
}

# ---------------------------------------------------------------- tokens and utilities (R1-R13)
check "arbitrary value utility (use tokens/components)"        'class="[^"]*-\['
check "opacity modifier on a color utility (use ink tokens)"   'class="[^"]*\b(text|bg|border|ring|divide|fill|stroke)-[a-z0-9-]+/[0-9]'
check "opacity utility on content"                             'class="[^"]*\bopacity-[0-9]'
check "Tailwind default type scale (use the §4.1 tokens: title/heading/subhead/body/label/caption/figure/code)" 'class="[^"]*\btext-(xs|sm|base|lg|xl|[2-9]xl)\b'
check "bold weight (use 500/600)"                              'font-bold|<b>|</b>'
check "Font Awesome"                                           'fa-(solid|regular|brands)|font-awesome'
check "inline event handler (use real links/buttons + ui.js)"  ' on(click|keydown|input|change)='
check "daisyUI component class (use v-* components)"           'class="([^"]* )?(table|table-[a-z]+|badge|badge-[a-z]+|alert|alert-[a-z]+|card|navbar|navbar-[a-z]+|footer|tooltip|tooltip-[a-z]+|stat|stats|menu|link|btn|collapse|dropdown|dropdown-[a-z]+)( [^"]*)?"'
check "hard-coded color (D1: every colour is a token in both theme blocks)" '#[0-9a-fA-F]{6}\b|rgba?\('
check "gradient"                                               'bg-gradient|bg-linear|from-[a-z]+-[0-9]'
check "dark: variant (tokens handle dark mode)"                'class="[^"]*\bdark:'
check "emoji / glyph controls"                                 '💬|🤖|⭐|⊕|⊖|📊|🔥|✅|❌|⚠'
check "inline style (only the --v/--n custom properties)"      'style="' 'style="--(v|n):'
report "<script> outside head.html/baseof.html" "$(grep -rln --include='*.html' '<script' layouts/ 2>/dev/null | grep -vE '^layouts/(partials/head|_default/baseof)\.html$')"

# ---------------------------------------------------------------- deleted components and markup (brief §4.7, design system v3 §5)
check "deleted component class: .v-pill is a plain tag (ui/tag.html), .v-dot/.v-edge-crit are the status icon + text (ui/status.html), .v-fn goes to Data notes, .v-twin is the Table toggle" \
  'class="([^"]*[^a-z0-9-])?v-(pill|dot|edge-crit|fn|twin)([^a-z0-9]|$)'
check "retired v2 class: .v-flag is the inline data-quality note (ui/note.html, .v-dq); .v-gap-note is the page callout (ui/page-head.html); .v-tt/.v-notes-btn/.v-menu-btn/.v-icon-btn are .v-btn (v3 §4.9, §4.18)" \
  'class="([^"]*[^a-z0-9-])?v-(flag|gap-note|gap-tail|tt|notes-btn|menu-btn|icon-btn|kpi-funnel|kpi-filtering|kpi-ctx)([^a-z0-9-]|$)'
check "inverted segmented control: the selected segment is surface on the surface-2 track, never black (v3 §4.11)" \
  'class="[^"]*\b(v-tabs?-(inverted|dark|solid)|is-inverted)\b'
check "button that is not a v3 component: use .v-btn / .v-btn-sm (segments, chips, filter tiles, the field clear and sortable headers are their own components) (v3 §4.9)" \
  '<button\b' '\bv-(btn|tab|chip|kpi|field-clear|nav-item)\b|data-sort[^>]*>[[:space:]]*<button'
check "underlined text at rest: links underline on hover only (prose inside Data notes is the one exception) (v3 §4.10, §5)" \
  'class="[^"]*\b(underline|decoration-[a-z0-9-]+)\b'
check "uppercase outside the label role: uppercase comes only from .v-label / table headers / KPI labels / the eyebrow (v3 §2, §5)" \
  'class="[^"]*\b(uppercase|tracking-[a-z]+)\b'
check "<details> is banned: disclosures are button[aria-expanded][aria-controls] + a hidden panel, charts use the Table toggle (§4.6 o, s)" '<details[ >]'
check "superscript footnote: definitions go in the line-2 caption, the tile qualifier, a title or Data notes (§4.6 n)" \
  '<sup[ >]|¹|²|³|⁰|⁴|⁵|⁶|⁷|⁸|⁹'
check "font-mono only on .v-code: mono is for paths, versions and hashes, never handles, repos, #ids, SEPs or packages (§4.1)" \
  'class="[^"]*\bfont-mono\b' 'class="[^"]*\bv-code\b[^"]*\bfont-mono\b|class="[^"]*\bfont-mono\b[^"]*\bv-code\b'

# ---------------------------------------------------------------- separators (design system v3 §0.1, §5)
# No glyph separators anywhere: not in markup, strings, comments, front matter or scripts. Separate items with layout (flex gap,
# separate lines, icons as item markers) or real words (commas, "on", "by", "since"). Raw files, comments included.
# The glyphs are written as UTF-8 byte escapes (U+00B7 middot, U+2022 bullet) so this script holds no separator glyph itself.
glyph_re=$'\xc2\xb7|\xe2\x80\xa2|&mid''dot;|&#183;|&#[xX][bB]7;|&bu''ll;|&#8226;|&#[xX]2022;'
report "glyph separator (middot or bullet) in layouts/, static/js/ or content/: use layout or words, never a dot (design system v3 §0.1)" \
  "$(cd "$root" && grep -rnE -e "$glyph_re" layouts static/js content 2>/dev/null)"
# " | " between items in rendered text: Go template actions are blanked first (across lines), so only literal markup text is checked.
read -r -d '' pipe_scan <<'PERL'
local $/; my $t = <>;
$t =~ s{\{\{.*?\}\}}{my $m = $&; $m =~ tr/\n//cd; $m}gse;
my $n = 0;
for my $l (split /\n/, $t, -1) { $n++; print "$ARGV:$n: $l\n" if $l =~ /(^|[^|])\s\|\s([^|]|$)/; }
PERL
pipe_hits=$(find layouts -type f -name '*.html' | while IFS= read -r f; do perl -e "$pipe_scan" "$f"; done)
report "' | ' used as a separator in template text: use layout or words (design system v3 §0.1)" "$pipe_hits"
check "em dash used as a separator (' — ' between words): use layout or words; a lone '—' for a missing value is fine (design system v3 §0.1)" \
  $'[^ >"]+ \xe2\x80\x94 [^ <"]+'

# ---------------------------------------------------------------- copy (brief §6.1, §6.4)
check "banned copy: invented targets, SLA badges, Suspect/Partial (use the 'n of 7 days' data-quality note), interaction narration (§6.4; 'Team SLA: 7 days' is the v3 §0.1 form and allowed)" \
  'Over target|× target|Past SLA|\bSuspect\b|\bPartial\b|\bWatch\b|/ 25\b|Rows open on GitHub|Select a |Counts open|Package names open'
check "classifier tier name rendered as text: map it through the page-local dictionary (§6.5; quoted Go strings, e.g. dict keys, are allowed)" \
  '(^|[^"A-Za-z])(We.{1,7}re blocking someone|Not our move|Bot corner|High leverage|Hygiene|Intake)\b'
check "raw registry key as a name: use ui/registry-name.html (npm, PyPI, NuGet, crates.io, RubyGems) (§6.1 rule 6)" \
  '>\s*(pypi|nuget|crates|rubygems)\s*<'
check_in "'Daily' or 'Share' as a downloads label: the columns are Last 7 days, Change, 12 weeks, Last 30 days, Lifetime (§6.4, §6.5)" \
  '>\s*(Daily|Share)\s*<' layouts/partials/pages/downloads.html layouts/partials/pages/downloads layouts/partials/pages/overview
check_in "'Experimental' in the header: it is footer text (§2.2, §4.6 r)" 'Experimental' layouts/partials/header.html
check "classifier blurb/desc/short_reason rendered outside pages/pulls/reason.html: map it through the page-local dictionary (§6.1 rule 9)" \
  '\.(short_reason|blurb|desc)\b|index [$.][A-Za-z0-9_.]* "(short_reason|blurb|desc)"' '^layouts/partials/pages/pulls/reason\.html:'

# ---------------------------------------------------------------- assets/css/main.css and static/js
# Walks the stylesheet as nested blocks (so a multi-line or nested rule keeps its selector) and prints
# "<rule>\tassets/css/main.css:<line>: <selector> { <declaration> }" for each banned declaration.
read -r -d '' css_scan <<'PERL'
local $/; my $css = <>;
$css =~ s{/\*.*?\*/}{my $m = $&; $m =~ tr/\n//cd; $m}gse;
my @stack; my $buf = ''; my $line = 1;
for my $ch (split //, $css) {
  if ($ch eq '{' or $ch eq '}' or $ch eq ';') {
    (my $d = $buf) =~ s/^\s+|\s+$//g;
    if ($ch eq '{') { push @stack, $d; }
    elsif ($d ne '') {
      (my $sel = join(' ', @stack)) =~ s/&//g;
      $sel =~ s/\s+/ /g;
      my $at = "assets/css/main.css:${line}: ${sel} { ${d} }";
      print "outline\t$at\n"
        if ($d =~ /^outline(-style|-width)?\s*:\s*(none|0(px)?)\s*(!important)?$/i or $d =~ /^\@apply\b.*\boutline-(none|0)\b/)
           and $sel !~ /\.v-field input\b/;
      print "separator\t$at\n" if $d =~ /^content\s*:.*(\xc2\xb7|\xe2\x80\xa2|\\0*b7\b|\\0*2022\b|\||\xe2\x80\x94)/i;
    }
    pop @stack if $ch eq '}';
    $buf = '';
  } else { $buf .= $ch; }
  $line++ if $ch eq "\n";
}
PERL
if [ -f "$root/assets/css/main.css" ]; then
  scan=$(perl -e "$css_scan" "$root/assets/css/main.css")
  report "outline: none/0 removes the focus ring; only the .v-field input rule may use it, its wrapper draws :focus-within (§7.3 A2)" \
    "$(printf '%s\n' "$scan" | awk -F'\t' '$1 == "outline" { print $2 }')"
  report "separator generated by CSS content (middot, bullet, pipe or em dash): separate items with layout or words, never ::before/::after (design system v3 §0.1)" \
    "$(printf '%s\n' "$scan" | awk -F'\t' '$1 == "separator" { print $2 }')"
fi
if [ -e "$root/static/js/repo-picker.js" ]; then report "static/js/repo-picker.js must not exist: the scope is the URL and the switcher is ui/menu.html + menu.js (§2.3)" "static/js/repo-picker.js"; fi
check "reference to repo-picker.js: the scope switcher is ui/menu.html + static/js/menu.js (§2.3)" 'repo-picker\.js'
exit $fail
