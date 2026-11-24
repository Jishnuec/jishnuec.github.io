// render-projects.mjs
//
// Pure rendering logic for Projects (same style as the other render modules).
// Two regions come from the same Firestore documents:
//   renderGrid()  -> the project cards inside #pgrid
//   renderChips() -> the filter buttons inside #projectTypeChips
//
// Firestore fields: name, categoryTagline, taglineColor (optional), subtitle, description,
// techStack[], filterCode, filterLabel, links[{type,label,url}], date.

// Link type -> color (same convention as Field Notes). github, view-x and custom get no color.
const LINK_COLOR = {
  writeup: 'cyan',
  'live-app': 'amber',
  docs: 'purple',
  download: 'amber',
  medium: 'amber'
};

// Site palette -> CSS variable name. Green is --g on this site.
const TAGLINE_VAR = { green: 'g', cyan: 'cyan', amber: 'amber', red: 'red', purple: 'purple' };

const ARROW = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 10L10 2M10 2H4M10 2V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// For inline onclick="filterProjects('CODE',this)" attributes.
function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderLink(l) {
  const color = LINK_COLOR[l.type];
  const style = color ? ' style="color:var(--' + color + ')"' : '';
  // External links open in a new tab; links to pages on this site (like a writeup) do not.
  const target = /^https?:\/\//i.test(String(l.url || '')) ? ' target="_blank"' : '';
  return '<a href="' + esc(l.url) + '"' + target + ' class="plink"' + style + '>' + esc(l.label) + ' ' + ARROW + '</a>';
}

export function renderCard(p) {
  const v = TAGLINE_VAR[p.taglineColor];
  const tagStyle = v ? ' style="color:var(--' + v + ')"' : '';
  let html = '<div class="pcard rv" data-ptype="' + esc(p.filterCode) + '" data-date="' + esc(p.date) + '">';
  html += '<div class="ptag"' + tagStyle + '>' + esc(p.categoryTagline) + '</div>';
  html += '<div class="pname">' + esc(p.name) + '</div>';
  if (p.subtitle) html += '<div class="pver">' + esc(p.subtitle) + '</div>';
  html += '<p class="pdesc">' + esc(p.description) + '</p>';
  html += '<div class="pstack">' + (p.techStack || []).map(t => '<span class="pstag">' + esc(t) + '</span>').join('') + '</div>';
  html += '<div class="plinks">' + (p.links || []).map(renderLink).join('') + '</div>';
  html += '</div>';
  return html;
}

export function renderGrid(projects) {
  const sorted = [...projects].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted.map(renderCard).join('\n');
}

// "All" plus one button per distinct filterCode, labelled with its filterLabel,
// ordered A to Z by label (leading emoji/symbols are ignored when sorting).
export function renderChips(projects) {
  const byCode = new Map();
  [...projects]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .forEach(p => { if (p.filterCode && !byCode.has(p.filterCode)) byCode.set(p.filterCode, p.filterLabel || p.filterCode); });
  const plain = s => String(s).replace(/^[^\p{L}\p{N}]+/u, '');
  const entries = [...byCode.entries()].sort((a, b) => plain(a[1]).localeCompare(plain(b[1])));
  let html = '<button class="fn-chip active" onclick="filterProjects(null,this)">All</button>';
  entries.forEach(([code, label]) => {
    html += '<button class="fn-chip" onclick="filterProjects(\'' + escJs(code) + '\',this)">' + esc(label) + '</button>';
  });
  return html;
}
