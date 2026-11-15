#!/usr/bin/env bash
# VISR design-system guard (design system v4 section 7.2). Fails the build on banned patterns.
# The layouts/ rules grep a copy of layouts/ with {{/* */}} and <!-- --> comments blanked (line numbers
# kept), so a comment that names a banned pattern never fires. Exception: the middot and bullet rule reads the raw
# files in layouts/, static/js/ and content/, comments included (no glyph separator exists anywhere).
# assets/css/main.css and static/js/charts.js have their own checks.
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

# ---------------------------------------------------------------- tokens and utilities
check "arbitrary value utility (use tokens/components)"        'class="[^"]*-\['
check "opacity modifier on a color utility (use tokens)"       'class="[^"]*\b(text|bg|border|ring|divide|fill|stroke)-[a-z0-9-]+/[0-9]'
check "opacity utility on content"                             'class="[^"]*\bopacity-[0-9]'
check "bold weight (use the roles: 400, 500, 600)"             'font-bold|<b>|</b>'
check "Font Awesome"                                           'fa-(solid|regular|brands)|font-awesome'
check "inline event handler (use real links/buttons + ui.js)"  ' on(click|keydown|input|change)='
check "daisyUI component class (use v-* components)"           'class="([^"]* )?(table|table-[a-z]+|badge|badge-[a-z]+|alert|alert-[a-z]+|card|navbar|navbar-[a-z]+|footer|tooltip|tooltip-[a-z]+|stat|stats|menu|link|btn|collapse|dropdown|dropdown-[a-z]+)( [^"]*)?"'
check "hard-coded color (every colour is a token in both theme blocks)" '#[0-9a-fA-F]{6}\b|rgba?\('
check "gradient"                                               'bg-gradient|bg-linear|from-[a-z]+-[0-9]'
check "dark: variant (tokens handle dark mode)"                'class="[^"]*\bdark:'
check "emoji / glyph controls"                                 '💬|🤖|⭐|⊕|⊖|📊|🔥|✅|❌|⚠'
check "inline style (only the --v/--n custom properties)"      'style="' 'style="--(v|n):'
report "<script> outside head.html/baseof.html" "$(grep -rln --include='*.html' '<script' layouts/ 2>/dev/null | grep -vE '^layouts/(partials/head|_default/baseof)\.html$')"
check "type or colour utility in a template (type and colour come only from v-* components)" \
  'class="([^"]* )?(text-(xs|sm|base|lg|xl|[0-9]xl|bad|good|warn|link|ink|muted|faint)|font-(mono|light|normal|medium|semibold|bold)|leading-[a-z0-9.]+|tracking-[a-z]+|uppercase|italic|tabular-nums|truncate|line-clamp-[0-9]+|whitespace-(normal|nowrap|pre))( [^"]*)?"'
check "monospace element (there is no monospace: paths are .v-path, versions .v-ver)" '<(code|kbd|samp|pre)[ >]' '^layouts/partials/ui/field\.html'
check "role class in a page template (v-t-* is for layouts/partials/ui and the styleguide)" \
  'class="([^"]* )?v-t-(display|title|heading|subhead|strong|medium|body|label|caption)( [^"]*)?"' \
  '^layouts/partials/ui/|^layouts/_default/styleguide\.html|^layouts/partials/pages/styleguide'
check "state class: states are real attributes and real hover" 'class="([^"]* )?is-(hover|focus)( [^"]*)?"'

# ---------------------------------------------------------------- components and markup
check "deleted component class: .v-pill is a tag (ui/tag.html), .v-dot/.v-edge-crit are the Overdue cell (ui/sla.html), .v-fn goes to Data notes, .v-twin is the Chart and Table switch" \
  'class="([^"]*[^a-z0-9-])?v-(pill|dot|edge-crit|fn|twin)([^a-z0-9]|$)'
check "retired v2 class: .v-flag is the data-quality note (ui/note.html); .v-gap-note is the page callout; .v-tt/.v-notes-btn/.v-menu-btn/.v-icon-btn are .v-btn" \
  'class="([^"]*[^a-z0-9-])?v-(flag|gap-note|gap-tail|tt|notes-btn|menu-btn|icon-btn|kpi-funnel|kpi-filtering|kpi-ctx)([^a-z0-9-]|$)'
check "button that is not a component: use .v-btn (tabs, chips, the field clear, nav items, menu rows, the scope button and sortable headers are their own components)" \
  '<button\b' '(^|[" ])v-(btn|tab|chip|field-clear|nav-item|menu-opt|scope|th-btn)([" ]|$)'
check "underlined text at rest: links underline on hover only" \
  'class="[^"]*\b(underline|decoration-[a-z0-9-]+)\b'
check "details element: disclosures are button[aria-expanded][aria-controls] + a hidden panel; charts use the Chart and Table switch" '<details'
check "superscript footnote: definitions go in a title, a qualifier or Data notes" \
  '<sup[ >]|¹|²|³|⁰|⁴|⁵|⁶|⁷|⁸|⁹'
check "metric strip outside a card (ui/metrics.html renders the card)" 'class="v-metrics"'
check "digit in a section description: a window belongs in a card sub line, a header sub line or a label" 'class="v-section-desc[^>]*>[^<{]*[0-9]'

# ---------------------------------------------------------------- separators and values
# No glyph separators anywhere: not in markup, strings, comments, front matter or scripts. Separate items with layout (flex gap,
# separate lines, icons as item markers) or real words. The glyphs are written as UTF-8 byte escapes (U+00B7 middot, U+2022 bullet,
# U+2014 em dash, U+2013 en dash) so this script holds no separator glyph itself.
glyph_re=$'\xc2\xb7|\xe2\x80\xa2|&mid''dot;|&#183;|&#[xX][bB]7;|&bu''ll;|&#8226;|&#[xX]2022;'
report "glyph separator (middot or bullet) in layouts/, static/js/ or content/: use layout or words, never a dot" \
  "$(cd "$root" && grep -rnE -e "$glyph_re" layouts static/js content 2>/dev/null)"
check "glyph separator in template text" $'>[^<{]*(\xc2\xb7|\xe2\x80\xa2| \\| | / | \xe2\x80\x94 | \xe2\x80\x93 )[^<{]*<'
check "typed dash as a missing value: use ui/value.html (the empty mark is CSS)" $'>[[:space:]]*(\xe2\x80\x94|\xe2\x80\x93|-)[[:space:]]*<'
# " | " between items in rendered text: Go template actions are blanked first (across lines), so only literal markup text is checked.
read -r -d '' pipe_scan <<'PERL'
local $/; my $t = <>;
$t =~ s{\{\{.*?\}\}}{my $m = $&; $m =~ tr/\n//cd; $m}gse;
my $n = 0;
for my $l (split /\n/, $t, -1) { $n++; print "$ARGV:$n: $l\n" if $l =~ /(^|[^|])\s\|\s([^|]|$)/; }
PERL
pipe_hits=$(find layouts -type f -name '*.html' | while IFS= read -r f; do perl -e "$pipe_scan" "$f"; done)
report "' | ' used as a separator in template text: use layout or words" "$pipe_hits"
check "em dash used as a separator (' — ' between words): use layout or words" \
  $'[^ >"]+ \xe2\x80\x94 [^ <"]+'
check "number or date formatted outside fmt/ (every value goes through layouts/partials/fmt and ui/value.html)" \
  'lang\.FormatNumber|\.Format "(Jan|Mon|2 Jan|January)|(dateFormat|time\.Format) "[^"]*(Jan|Mon)' '^layouts/partials/fmt/'
check "value assembled with printf outside fmt/" \
  'printf "[^"]*%[^"]*( days?| hours?| weeks?|%%| of %| overdue)' '^layouts/partials/fmt/'
check "abbreviated unit or banned abbreviation in template text" '>[^<{]*\b([0-9]+(d|h|y|wk)|repos?|avg|wk|approx)\b'

# ---------------------------------------------------------------- copy
check "banned copy: invented targets, SLA badges, Suspect/Partial (use the coverage note), interaction narration" \
  'Over target|× target|Past SLA|\bSuspect\b|\bPartial\b|\bWatch\b|/ 25\b|Rows open on GitHub|Select a |Counts open|Package names open'
check "banned control copy" '>(Show|View all|Switch repository|Switch)<|Showing [0-9]|No change|data-table-toggle'
check "classifier tier name rendered as text: map it through data/pr-status.html or data/issue-status.html (quoted Go strings are allowed)" \
  '(^|[^"A-Za-z])(We.{1,7}re blocking someone|Not our move|Bot corner|High leverage|Hygiene|Intake)\b'
check "raw registry key as a name: use ui/registry-name.html (npm, PyPI, NuGet, crates.io, RubyGems)" \
  '>\s*(pypi|nuget|crates|rubygems)\s*<'
check_in "'Daily' or 'Share' as a downloads label: the columns are Last 7 days, Change, 12 weeks, Last 30 days, Lifetime" \
  '>\s*(Daily|Share)\s*<' layouts/partials/pages/downloads.html layouts/partials/pages/downloads layouts/partials/pages/overview
check_in "'Experimental' in the header: it is a footer badge" 'Experimental' layouts/partials/header.html
check "classifier blurb/desc/short_reason rendered outside pages/pulls/reason.html: map it through the closed Detail patterns" \
  '\.(short_reason|blurb|desc)\b|index [$.][A-Za-z0-9_.]* "(short_reason|blurb|desc)"' '^layouts/partials/pages/pulls/reason\.html:|^layouts/partials/ui/'
check "attribution" '[Cc]laude|[Cc]o-[Aa]uthored-[Bb]y|[Gg]enerated with'

# Added in build step 8 (design system v4 8.4), when the last caller is gone. Adding them earlier fails the build.
# check "retired formatter" 'partial "(ui/num|ui/dur|ui/pct|ui/date|ui/plural|data/date-range|pages/pulls/wait)\.html"'
# check "retired partial" 'partial "ui/(kpi|kpis|stats|stackbar|status|more|table-toggle|th-sort|flag)\.html"|partial "pages/(issues/show|pulls/state-label)\.html"'
# check "retired class" 'class="([^"]*[^a-z0-9-])?v-(kpi|kpis|kpi-[a-z-]+|stats|stat|stat-caption|strip|stack|stack-[a-z]+|chiplinks?|legend|legend-[a-z]+|delta-vs|rule-note|tabbar|tab-count|disclosure|more|flow|dq|status|status-[a-z]+|code|card-foot|card-note|chart-(head|heading|value|sub|toggle|caption|empty|more)|spark-(cols|area)|rowmeta|listmeta|verdict|title-cell|ink|muted|faint)([^a-z0-9-]|$)|(^|[" ])is-(fill|crit|bare)([" ]|$)'

# ---------------------------------------------------------------- assets/css/main.css and static/js
# Walks the stylesheet as nested blocks (so a multi-line or nested rule keeps its selector) and prints
# "<rule>\tassets/css/main.css:<line>: <selector> { <declaration> }" for each banned declaration.
read -r -d '' css_scan <<'PERL'
local $/; my $css = <>;
$css =~ s{/\*.*?\*/}{my $m = $&; $m =~ tr/\n//cd; $m}gse;
my @ok = (0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 72);
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
      if ($d =~ /^([a-z-]+)\s*:\s*(.+)$/s) {
        my ($p, $v) = ($1, $2);
        $v =~ s/\s*!important$//;
        my $bad = 0;
        $bad = 1 if $p eq 'text-transform' and $v ne 'none';
        $bad = 1 if $p eq 'font-size' and $v !~ /^(var\(--fs-[a-z0-9-]+\)|inherit)$/;
        $bad = 1 if $p eq 'line-height' and $v !~ /^(var\(--lh-[a-z0-9-]+\)|inherit|1)$/;
        $bad = 1 if $p eq 'font-weight' and $v !~ /^(400|500|600|inherit)$/;
        $bad = 1 if $p eq 'letter-spacing' and $v !~ /^(0|inherit|var\(--ls-[a-z0-9-]+\))$/;
        $bad = 1 if $p eq 'font-family' and $v !~ /^(var\(--font-sans\)|inherit)$/;
        $bad = 1 if $p eq 'font-style' and $v eq 'italic';
        $bad = 1 if $p eq 'font-variant-numeric' and $sel !~ /(^|\s)body$/ and $sel !~ /button, input, select, textarea$/;
        print "type\t$at\n" if $bad;
        if ($p =~ /^(margin|padding|gap|row-gap|column-gap)(-[a-z-]+)?$/) {
          my $off = 0;
          while ($v =~ /(\d+(?:\.\d+)?)px/g) { my $n = $1; $off = 1 unless grep { $_ == $n } @ok; }
          print "space\t$at\n" if $off;
        }
        print "state\t$at\n" if $sel =~ /:hover/ and $p =~ /^background(-color)?$/ and $v =~ /var\(--surface-2\)/;
        print "state\t$at\n" if $v =~ /color-mix\(/;
      }
      print "state\t$at\n" if $sel =~ /\.is-(hover|focus)([^a-z0-9-]|$)/;
    }
    pop @stack if $ch eq '}';
    $buf = '';
  } else { $buf .= $ch; }
  $line++ if $ch eq "\n";
}
PERL
if [ -f "$root/assets/css/main.css" ]; then
  scan=$(perl -e "$css_scan" "$root/assets/css/main.css")
  report "outline: none/0 removes the focus ring; only the .v-field input rule may use it, its wrapper draws :focus-within" \
    "$(printf '%s\n' "$scan" | awk -F'\t' '$1 == "outline" { print $2 }')"
  report "separator generated by CSS content (middot, bullet, pipe or em dash): separate items with layout or words, never ::before/::after" \
    "$(printf '%s\n' "$scan" | awk -F'\t' '$1 == "separator" { print $2 }')"
  report "type outside the ramp: font-size is var(--fs-*), line-height var(--lh-*), weight 400/500/600, letter-spacing 0 or var(--ls-*), one family, no uppercase, no italics, numerals set on body only (design system v4 2.2)" \
    "$(printf '%s\n' "$scan" | awk -F'\t' '$1 == "type" { print $2 }')"
  report "spacing off the scale: margin, padding and gap take 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56 or 72px (the --s-* tokens) (design system v4 2.3)" \
    "$(printf '%s\n' "$scan" | awk -F'\t' '$1 == "space" { print $2 }')"
  report "state styling: hover is a layer (never background: var(--surface-2)), no .is-hover or .is-focus classes, no color-mix() (design system v4 2.4)" \
    "$(printf '%s\n' "$scan" | awk -F'\t' '$1 == "state" { print $2 }')"
fi
if [ -f "$root/static/js/charts.js" ]; then
  report "text painted on a canvas: charts.js draws marks and axis ticks only (design system v4 4.19)" \
    "$(cd "$root" && grep -n 'fillText' static/js/charts.js 2>/dev/null)"
fi
if [ -e "$root/static/js/repo-picker.js" ]; then report "static/js/repo-picker.js must not exist: the scope is the URL and the switcher is ui/menu.html + menu.js" "static/js/repo-picker.js"; fi
check "reference to repo-picker.js: the scope switcher is ui/menu.html + static/js/menu.js" 'repo-picker\.js'
exit $fail
