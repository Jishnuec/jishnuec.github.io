// render-field-notes.mjs
//
// Pure rendering logic, kept separate from the Firestore/Admin-SDK wiring so it can be
// unit-tested with fake data (see test_render.mjs) without needing real credentials.

export const BADGE_CLASS = {
  cyan: 'fn-badge-dfir',
  purple: 'fn-badge-ir',
  amber: 'fn-badge-osint',
  red: 'fn-badge-pentest',
  green: 'fn-badge-ml'
};

// Colors pre-mapped per link type, matching the site's existing convention (from Projects'
// .plink usage, which was the more rigorously/consistently color-coded of the two sections).
// Types not listed here (github, view-x, custom) intentionally get no color override.
export const LINK_COLOR = {
  writeup: 'cyan',
  'live-app': 'amber',
  docs: 'purple',
  download: 'amber',
  medium: 'amber'
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// For inline onclick="filterByTag('TAG',...)" attributes — escapes single quotes so a tag
// containing an apostrophe can't break out of the JS string literal.
function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function formatDate(iso) {
  const [y, m, d] = String(iso).split('-');
  const mi = parseInt(m, 10) - 1;
  if (!y || !d || mi < 0 || mi > 11 || Number.isNaN(mi)) return iso; // fail visibly, don't crash the whole build
  return MONTHS[mi] + ' ' + d + ', ' + y;
}

function renderFinding(f) {
  return '<div class="fn-finding"><span>' + esc(f.label) + '</span> &mdash; ' + esc(f.description) + '</div>';
}

function renderLink(l) {
  const color = LINK_COLOR[l.type];
  const style = color ? ' style="color:var(--' + color + ')"' : '';
  return '<a href="' + esc(l.url) + '" target="_blank" class="fn-link"' + style + '>' + esc(l.label) + '</a>';
}

function renderTagPill(tag) {
  return '<span class="fn-tag" onclick="filterByTag(\'' + escJs(tag) + '\',null)">' + esc(tag) + '</span>';
}

export function renderNote(n) {
  const tags = n.tags || [];
  const badgeClass = BADGE_CLASS[n.badgeColor] || BADGE_CLASS.cyan;

  let html = '<div class="fn-post" data-tags="' + esc(tags.join(',')) + '" data-date="' + esc(n.date)
    + '" data-accent="' + esc(n.accentColor) + '">';
  html += '<div class="fn-meta">';
  html += '<div class="fn-badge ' + badgeClass + '">' + esc(n.badgeText) + '</div>';
  html += '<div class="fn-date">' + formatDate(n.date) + '</div>';
  html += '</div>';
  html += '<div class="fn-card-body">';
  html += '<div class="fn-title">' + esc(n.title) + '</div>';
  html += '<div class="fn-body">' + esc(n.body) + '</div>';

  if (n.imageUrl) {
    html += '<div class="fn-img-wrap" onclick="openLightbox(this.querySelector(\'img\').src,'
      + 'this.querySelector(\'img\').alt);event.stopPropagation()">';
    html += '<img src="' + esc(n.imageUrl) + '" alt="' + esc(n.title)
      + '" loading="lazy" onerror="this.closest(\'.fn-img-wrap\').style.display=\'none\'"/>';
    html += '</div>';
  }

  if (n.findings && n.findings.length) {
    html += '<div class="fn-findings">' + n.findings.map(renderFinding).join('') + '</div>';
  }

  (n.links || []).forEach(l => { html += renderLink(l); });

  html += '<div class="fn-tags-row">' + tags.map(renderTagPill).join('') + '</div>';
  html += '</div></div>';
  return html;
}

// Note: no id="..." and no permalink button here on purpose — the existing client-side
// assignPermalinks() in index.html already generates both for every .fn-post[data-date]
// on page load, regardless of where the element came from. Baking them in here would be
// redundant at best and could conflict with that logic at worst.

export function renderFeed(notes) {
  const sorted = [...notes].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted.map(renderNote).join('\n');
}

export function renderChips(notes) {
  const tagSet = new Set();
  notes.forEach(n => (n.tags || []).forEach(t => tagSet.add(t)));
  const sortedTags = [...tagSet].sort((a, b) => a.localeCompare(b));
  let html = '<button class="fn-chip active" onclick="filterByTag(null,this)">All</button>';
  sortedTags.forEach(t => {
    html += '<button class="fn-chip" onclick="filterByTag(\'' + escJs(t) + '\',this)">' + esc(t) + '</button>';
  });
  return html;
}
