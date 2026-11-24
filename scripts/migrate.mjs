// migrate.mjs
//
// ONE-TIME import: reads the entries that are currently hard-coded in index.html
// (Field Notes, Research, Labs, Projects) and writes them into Firestore, so the
// admin panel starts out with everything that is already on the site.
//
//   node scripts/migrate.mjs --dry-run
//       Reads index.html, writes migration-preview.json, touches nothing else.
//
//   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/migrate.mjs
//       Writes to Firestore. Refuses to run if a target collection already has
//       documents, unless --force is added (same ids are then overwritten).
//
// Run it BEFORE the first "Regenerate Site Content" run, because that run replaces
// the hard-coded entries in index.html with whatever is in Firestore.
//
// HTML entities (&amp;, &#x1F6E0; ...) are decoded by the HTML parser, so Firestore
// gets plain text.

import { readFileSync, writeFileSync } from 'fs';
import * as cheerio from 'cheerio';

const INDEX_PATH = 'index.html';
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

const html = readFileSync(INDEX_PATH, 'utf8');
const $ = cheerio.load(html);

const pad = n => String(n).padStart(3, '0');
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const warnings = [];

// ---------- color helpers ----------
const FN_BADGE_COLOR = {
  'fn-badge-dfir': 'cyan', 'fn-badge-ir': 'purple', 'fn-badge-osint': 'amber',
  'fn-badge-ctf': 'amber', 'fn-badge-pentest': 'red', 'fn-badge-ml': 'green'
};
const RESEARCH_BADGE_COLOR = { 'rb-w': 'purple', 'rb-p': 'cyan', 'rb-v': 'red', 'rb-d': 'amber', 'rb-ml': 'green' };
const SK_COLOR = { g: 'green', c: 'cyan', a: 'amber', r: 'red', p: 'purple' };
const VAR_COLOR = { g: 'green', cyan: 'cyan', amber: 'amber', red: 'red', purple: 'purple' };

function colorFromClass($el, table, fallback) {
  const classes = String($el.attr('class') || '').split(/\s+/);
  for (const c of classes) if (table[c]) return table[c];
  return fallback;
}

// ---------- links ----------
// The link type only decides the color, so it is inferred from the color the link has
// on the site today (then from its wording), which keeps every link looking the same.
function linkType(label, style) {
  if (/writeup/i.test(label)) return 'writeup';
  const color = (String(style || '').match(/color:\s*var\(--([a-z]+)\)/) || [])[1];
  if (color === 'cyan') return 'writeup';
  if (color === 'purple') return 'docs';
  if (color === 'amber') {
    if (/medium/i.test(label)) return 'medium';
    if (/live/i.test(label)) return 'live-app';
    return 'download';
  }
  if (/github/i.test(label)) return 'github';
  if (/^view\b/i.test(label)) return 'view-x';
  return 'custom';
}

function readLinks($scope, selector) {
  return $scope.find(selector).toArray().map(a => {
    const $a = $(a);
    const label = clean($a.text());
    return { type: linkType(label, $a.attr('style')), label, url: $a.attr('href') || '' };
  });
}

// ---------- Field Notes ----------
function readFieldNotes() {
  return $('#fnFeed .fn-post').toArray().map((el, i) => {
    const $p = $(el);
    const badges = $p.find('.fn-meta .fn-badge').toArray().map(b => ({
      text: clean($(b).text()), color: colorFromClass($(b), FN_BADGE_COLOR, 'cyan')
    }));
    const findings = $p.find('.fn-finding').toArray().map(f => {
      const $f = $(f);
      const label = $f.find('span').first().text().trim();
      const full = $f.text().trim();
      const description = full.slice(full.indexOf(label) + label.length).replace(/^\s*[—–-]+\s*/, '').trim();
      return { label, description };
    });
    return {
      id: 'fn-' + pad(i + 1),
      title: clean($p.find('.fn-title').text()),
      date: $p.attr('data-date') || '',
      badgeText: badges[0] ? badges[0].text : '',
      badgeColor: badges[0] ? badges[0].color : 'cyan',
      badge2Text: badges[1] ? badges[1].text : null,
      badge2Color: badges[1] ? badges[1].color : null,
      accentColor: $p.attr('data-accent') || 'green',
      body: $p.find('.fn-body').text().trim(),
      imageUrl: $p.find('.fn-img-wrap img').attr('src') || null,
      // Tag order as shown on the card (the tag pills); data-tags is only the fallback.
      tags: (() => {
        const shown = $p.find('.fn-tags-row .fn-tag').toArray().map(t => clean($(t).text())).filter(Boolean);
        return shown.length ? shown : ($p.attr('data-tags') || '').split(',').map(t => t.trim()).filter(Boolean);
      })(),
      findings,
      links: readLinks($p, 'a.fn-link')
    };
  });
}

// ---------- Research ----------
function readResearch() {
  return $('#resGrid .rcard').toArray().map((el, i) => {
    const $c = $(el);
    const $badge = $c.find('.rbadge');
    const m = String($c.attr('onclick') || '').match(/(?:location\.href\s*=|window\.open\()\s*'([^']*)'/);
    return {
      id: 'rs-' + pad(i + 1),
      title: clean($c.find('.rtitle').text()),
      badge: clean($badge.text()),
      badgeColor: colorFromClass($badge, RESEARCH_BADGE_COLOR, 'cyan'),
      description: $c.find('.rdesc').text().trim(),
      link: m ? m[1] : null,
      date: $c.attr('data-date') || ''
    };
  });
}

// ---------- Labs ----------
// Cards hold the title, description and tags; the modal text lives in the labData object.
// The card's key (openLab('dvwa')) becomes the Firestore document id, so the existing
// card -> modal link keeps working.
function readLabs() {
  const m = html.match(/\/\/ LABDATA_START\n([\s\S]*?)\/\/ LABDATA_END/);
  if (!m) throw new Error('LABDATA markers not found in ' + INDEX_PATH);
  const labData = new Function(m[1].replace('const labData=', 'return '))();
  return $('#labsGrid .lcard').toArray().map((el, i) => {
    const $c = $(el);
    const key = (String($c.attr('onclick') || '').match(/openLab\('([^']+)'\)/) || [])[1];
    if (!key || !labData[key]) throw new Error('Lab card #' + (i + 1) + ' has no matching labData entry');
    const d = labData[key];
    // Labs never showed a date, so these are placeholders that keep today's card order
    // (first card = newest). Edit them in the admin panel whenever you like.
    const date = new Date(Date.UTC(2026, 5, 6 - i)).toISOString().slice(0, 10);
    return {
      id: key,
      name: d.title || clean($c.find('.ltitle').text()),
      isActive: $c.hasClass('act'),
      cardDescription: $c.find('.ldesc').text().trim(),
      tags: $c.find('.ltags .sk').toArray().map(t => ({
        text: clean($(t).text()), color: colorFromClass($(t), SK_COLOR, 'green')
      })),
      date,
      modalSubtitle: d.sub || '',
      overview: d.overview || '',
      tools: d.tools || [],
      findingsSummary: d.findings || null
    };
  });
}

// ---------- Projects ----------
function readProjects() {
  const chipLabel = {};
  $('#projectTypeChips .fn-chip').each((_, b) => {
    const code = (String($(b).attr('onclick') || '').match(/filterProjects\('([^']+)'/) || [])[1];
    if (code) chipLabel[code] = clean($(b).text());
  });
  return $('#pgrid .pcard').toArray().map((el, i) => {
    const $c = $(el);
    const code = $c.attr('data-ptype') || '';
    const tagColor = (String($c.find('.ptag').attr('style') || '').match(/color:\s*var\(--([a-z]+)\)/) || [])[1];
    if (!chipLabel[code]) warnings.push('Project "' + clean($c.find('.pname').text()) + '": no filter button found for code "' + code + '", using the code as its label.');
    return {
      id: 'pj-' + pad(i + 1),
      name: clean($c.find('.pname').text()),
      categoryTagline: clean($c.find('.ptag').text()),
      taglineColor: VAR_COLOR[tagColor] || null,
      subtitle: clean($c.find('.pver').text()),
      description: $c.find('.pdesc').text().trim(),
      techStack: $c.find('.pstack .pstag').toArray().map(t => clean($(t).text())),
      filterCode: code,
      filterLabel: chipLabel[code] || code,
      links: readLinks($c, 'a.plink'),
      date: $c.attr('data-date') || ''
    };
  });
}

// ---------- run ----------
const data = {
  fieldNotes: readFieldNotes(),
  research: readResearch(),
  labs: readLabs(),
  projects: readProjects()
};

console.log('Found in ' + INDEX_PATH + ':');
for (const [name, items] of Object.entries(data)) {
  console.log('  ' + name + ': ' + items.length);
  if (!items.length) throw new Error('Found 0 ' + name + ' entries, so something is wrong. Nothing was written.');
}
console.log('  (the site had 19 notes, 12 research cards, 6 labs and 6 projects when this was written)');
warnings.forEach(w => console.log('WARNING: ' + w));

if (dryRun) {
  writeFileSync('migration-preview.json', JSON.stringify(data, null, 2));
  console.log('Dry run: wrote migration-preview.json. Nothing was sent to Firestore.');
  process.exit(0);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not set. Use --dry-run to test without Firestore.');
  process.exit(1);
}
const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();

if (!force) {
  for (const name of Object.keys(data)) {
    const snap = await db.collection(name).limit(1).get();
    if (!snap.empty) {
      console.error('Collection "' + name + '" already has documents. Nothing was written.\n' +
        'If this is a re-run and you want to overwrite the imported entries, run again with force enabled.');
      process.exit(1);
    }
  }
}

for (const [name, items] of Object.entries(data)) {
  const batch = db.batch();
  items.forEach(({ id, ...fields }) => {
    batch.set(db.collection(name).doc(id), {
      ...fields,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  await batch.commit();
  console.log('Imported ' + items.length + ' into ' + name + '.');
}
console.log('Done. Open the admin panel to check the entries.');
