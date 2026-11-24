// render-labs.mjs
//
// Pure rendering logic for Labs. Unlike the other three sections, this one produces
// TWO different kinds of output from the same Firestore documents:
//   1. renderGrid()         -> HTML for the #labsGrid region (like every other section)
//   2. renderLabDataObject() -> JS source text for the labData object between the
//                                LABDATA_START/LABDATA_END markers in index.html's
//                                inline <script>. Not HTML — actual JavaScript.
// Both come from the same input array so card and modal can never drift out of sync.
//
// The onclick="openLab('KEY')" on each card and the matching key in labData are the
// same value: the Firestore document id. Auto-generated Firestore ids are always plain
// alphanumeric, so they're safe to drop directly into both an HTML attribute and a JS
// object key without any real escaping risk — esc()/escJs() below are still applied,
// just as a defensive habit, not because collisions are expected.

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// For embedding into single-quoted JS string literals (what labData itself uses).
// Note: this is deliberately NOT html-escaping. labData's values get JS-parsed into
// plain strings, then inserted into the modal's HTML by openLab() with no HTML-escaping
// of its own (existing site behavior, unchanged) — so escaping for HTML here would be
// both wrong (double-escaping) and inconsistent with how the site already behaves.
function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const TAG_CLASS = { green: 'g', cyan: 'c', amber: 'a', red: 'r', purple: 'p' };

function renderTag(t) {
  const text = typeof t === 'string' ? t : t.text;
  const cls = TAG_CLASS[typeof t === 'string' ? 'green' : t.color] || 'g';
  return '<span class="sk ' + cls + '" style="font-size:.58rem">' + esc(text) + '</span>';
}

export function renderCard(lab, staggerIndex) {
  const staggerD = (staggerIndex % 3) + 1;
  const activeClass = lab.isActive ? ' act' : '';
  const badgeHtml = lab.isActive
    ? '<div class="lbdg ab">● Active Lab</div>'
    : '<div class="lbdg">⏳ Planned</div>';

  const tags = lab.tags || [];
  // Each tag is {text, color} (color: green/cyan/amber/red/purple). A plain string is
  // accepted too and renders green, so older data never breaks the build.
  const tagsOrComingSoon = tags.length
    ? '<div class="ltags">' + tags.map(renderTag).join('') + '</div>'
    : '<div class="lsoon">// COMING SOON</div>';

  const hasFindings = !!(lab.findingsSummary && lab.findingsSummary.trim());
  const clickText = hasFindings ? 'Click to read writeup →' : 'Click for details →';

  return '<div class="lcard' + activeClass + ' rv" data-d="' + staggerD + '" data-date="' + esc(lab.date) + '" onclick="openLab(\'' + escJs(lab.id) + '\')">'
    + badgeHtml
    + '<div class="ltitle">' + esc(lab.name) + '</div>'
    + '<div class="ldesc">' + esc(lab.cardDescription) + '</div>'
    + tagsOrComingSoon
    + '<div class="lclick">' + clickText + '</div>'
    + '</div>';
}

export function renderGrid(labs) {
  const sorted = [...labs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted.map((lab, i) => renderCard(lab, i)).join('\n');
}

// Produces JS source text, not HTML. Matches the exact shape openLab() already expects:
// {active, title, sub, overview, tools[, findings]} — findings key is omitted entirely
// when empty (not set to null/empty-string) since openLab() checks `if(d.findings)`,
// and an omitted key and a falsy key behave identically there — omitting is just cleaner
// generated source.
export function renderLabDataObject(labs) {
  const entries = labs.map(lab => {
    const tools = (lab.tools || []).map(t => "'" + escJs(t) + "'").join(',');
    let entry = "  '" + escJs(lab.id) + "':{"
      + 'active:' + (lab.isActive ? 'true' : 'false') + ','
      + "title:'" + escJs(lab.name) + "',"
      + "sub:'" + escJs(lab.modalSubtitle) + "',"
      + "overview:'" + escJs(lab.overview) + "',"
      + 'tools:[' + tools + ']';
    if (lab.findingsSummary && lab.findingsSummary.trim()) {
      entry += ",findings:'" + escJs(lab.findingsSummary) + "'";
    }
    entry += '}';
    return entry;
  });
  return 'const labData={\n' + entries.join(',\n') + '\n};';
}
