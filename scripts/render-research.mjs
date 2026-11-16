// render-research.mjs
//
// Pure rendering logic for Research, kept separate from Firestore/file-IO wiring so it
// can be unit-tested with fake data. Mirrors render-field-notes.mjs's structure.

export const BADGE_CLASS = {
  purple: 'rb-w',
  cyan: 'rb-p',
  red: 'rb-v',
  amber: 'rb-d',
  green: 'rb-ml'
};

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// For inline onclick="window.location.href='URL'" / window.open('URL',...) attributes.
function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// The one existing PDF link on the site opens in a new tab with different button text
// than the .html writeup pages. Detected from the URL rather than a stored field —
// zero extra admin-form complexity, and it generalizes correctly to future PDF links.
export function isPdfLink(url) {
  return /\.pdf(\?.*)?$/i.test(String(url || '').trim());
}

export function renderCard(r, staggerIndex) {
  const badgeClass = BADGE_CLASS[r.badgeColor] || BADGE_CLASS.cyan;
  // Matches the existing .rv[data-d="1|2|3"] scroll-reveal stagger — purely a cosmetic
  // animation-timing hint, not stored data, so it's just assigned by position here.
  const staggerD = (staggerIndex % 3) + 1;

  let onclickAttr = '';
  let rsoonHtml = '<div class="rsoon">// COMING SOON</div>';

  const link = (r.link || '').trim();
  if (link) {
    if (isPdfLink(link)) {
      onclickAttr = ' onclick="window.open(\'' + escJs(link) + '\',\'_blank\')"';
      rsoonHtml = '<div class="rsoon" style="color:var(--g);font-size:1rem;letter-spacing:2px">→ Click to open PDF</div>';
    } else {
      onclickAttr = ' onclick="window.location.href=\'' + escJs(link) + '\'"';
      rsoonHtml = '<div class="rsoon" style="color:var(--g);font-size:1rem;letter-spacing:2px">→ Click to read</div>';
    }
  }

  return '<div class="rcard rv" data-d="' + staggerD + '"' + onclickAttr + ' data-date="' + esc(r.date) + '">'
    + '<div class="rbadge ' + badgeClass + '">' + esc(r.badge) + '</div>'
    + '<div class="rtitle">' + esc(r.title) + '</div>'
    + '<div class="rdesc">' + esc(r.description) + '</div>'
    + rsoonHtml
    + '</div>';
}

// Note: no id="..." here either, same reason as Field Notes — assignPermalinks()
// already generates ids + the 🔗 button for every .rcard[data-date] on page load.

export function renderGrid(items) {
  const sorted = [...items].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted.map((r, i) => renderCard(r, i)).join('\n');
}
