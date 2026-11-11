#!/usr/bin/env bash
# VISR design-system guard (docs: design-system spec, rules R1-R13). Fails the build on banned patterns in layouts/.
set -u
fail=0
check() { # $1 = message, $2 = extended regex
  if grep -rnE --include='*.html' "$2" layouts/; then echo "::error::design-guard: $1"; fail=1; fi
}
check "arbitrary value utility (use tokens/components)"        'class="[^"]*-\['
check "opacity modifier on a color utility (use ink tokens)"   'class="[^"]*\b(text|bg|border|ring|divide|fill|stroke)-[a-z0-9-]+/[0-9]'
check "opacity utility on content"                             'class="[^"]*\bopacity-[0-9]'
check "Tailwind default type scale (use text-meta/body/...)"   'class="[^"]*\btext-(xs|sm|base|lg|xl|[2-9]xl)\b'
check "bold weight (use 500/600)"                              'font-bold|<b>|</b>'
check "Font Awesome"                                           'fa-(solid|regular|brands)|font-awesome'
check "inline event handler (use real links/buttons + ui.js)"  ' on(click|keydown|input|change)='
check "daisyUI component class (use v-* components)"           'class="([^"]* )?(table|table-[a-z]+|badge|badge-[a-z]+|alert|alert-[a-z]+|card|navbar|navbar-[a-z]+|footer|tooltip|tooltip-[a-z]+|stat|stats|menu|link|btn|collapse)( [^"]*)?"'
check "hard-coded color (use tokens)"                          '#[0-9a-fA-F]{6}\b|rgba?\('
check "gradient"                                               'bg-gradient|bg-linear|from-[a-z]+-[0-9]'
check "dark: variant (tokens handle dark mode)"                'class="[^"]*\bdark:'
check "emoji / glyph controls"                                 '💬|🤖|⭐|⊕|⊖|📊|🔥|✅|❌|⚠'
if grep -rnE --include='*.html' 'style="' layouts/ | grep -vE 'style="--(v|n):'; then echo "::error::design-guard: inline style (only --v/--n allowed)"; fail=1; fi
if grep -rln --include='*.html' '<script' layouts/ | grep -v -e 'layouts/partials/head.html' -e 'layouts/_default/baseof.html'; then echo "::error::design-guard: <script> outside head.html/baseof.html"; fail=1; fi
if grep -rn --include='*.html' '<details' layouts/ | grep -v 'v-twin'; then echo "::error::design-guard: <details> is only for chart table twins"; fail=1; fi
exit $fail
