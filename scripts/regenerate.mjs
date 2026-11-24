// regenerate.mjs
//
// The script the GitHub Action runs. Reads Firestore, renders each section's HTML
// region(s), and writes index.html back to disk. Committing + pushing is handled by
// the workflow YAML, not this script — this script only ever touches the local
// working copy. Sections are declared in SECTIONS below.
//
// Two region types:
//   'html-id'   -> splice by finding <tag id="...">, used by everything so far
//   'js-marker' -> splice between two exact marker comment strings, used by Labs'
//                  labData object, which lives in JS source, not an HTML element
//
// Local dry run, no Firestore/credentials needed:
//   node regenerate.mjs --local sample-data.json
//   (sample-data.json is an object keyed by collection name, e.g. {"fieldNotes":[...],"research":[...],"labs":[...],"projects":[...]})
//
// Real run (what the Action does):
//   FIREBASE_SERVICE_ACCOUNT='<json>' node regenerate.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as cheerio from 'cheerio';
import { renderFeed as renderFieldNotesFeed, renderChips as renderFieldNotesChips } from './render-field-notes.mjs';
import { renderGrid as renderResearchGrid } from './render-research.mjs';
import { renderGrid as renderLabsGrid, renderLabDataObject } from './render-labs.mjs';
import { renderGrid as renderProjectsGrid, renderChips as renderProjectsChips } from './render-projects.mjs';

const INDEX_PATH = 'index.html';

const SECTIONS = [
  {
    name: 'Field Notes',
    collection: 'fieldNotes',
    regions: [
      { type: 'html-id', id: 'fnFeed', render: renderFieldNotesFeed },
      { type: 'html-id', id: 'fnChips', render: renderFieldNotesChips }
    ]
  },
  {
    name: 'Research',
    collection: 'research',
    regions: [
      { type: 'html-id', id: 'resGrid', render: renderResearchGrid }
    ]
  },
  {
    name: 'Labs',
    collection: 'labs',
    regions: [
      { type: 'html-id', id: 'labsGrid', render: renderLabsGrid },
      { type: 'js-marker', startMarker: '// LABDATA_START', endMarker: '// LABDATA_END', render: renderLabDataObject }
    ]
  },
  {
    name: 'Projects',
    collection: 'projects',
    regions: [
      { type: 'html-id', id: 'pgrid', render: renderProjectsGrid },
      { type: 'html-id', id: 'projectTypeChips', render: renderProjectsChips }
    ]
  }
];

function replaceInnerHtmlById(html, id, newInner) {
  const $ = cheerio.load(html, { sourceCodeLocationInfo: true });
  const el = $('#' + id).get(0);
  if (!el) throw new Error('Could not find #' + id + ' in ' + INDEX_PATH);
  const loc = el.sourceCodeLocation;
  if (!loc || !loc.startTag || !loc.endTag) {
    throw new Error('No source location info for #' + id + ' — is it self-closing or malformed?');
  }
  return html.slice(0, loc.startTag.endOffset) + newInner + html.slice(loc.endTag.startOffset);
}

function replaceBetweenMarkers(html, startMarker, endMarker, newContent) {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) throw new Error('Could not find marker: ' + startMarker + ' — has it been added to index.html yet?');
  const contentStart = startIdx + startMarker.length;
  const endIdx = html.indexOf(endMarker, contentStart);
  if (endIdx === -1) throw new Error('Could not find marker: ' + endMarker);
  return html.slice(0, contentStart) + '\n' + newContent + '\n' + html.slice(endIdx);
}

async function fetchAllCollections(collectionNames) {
  const localFlagIndex = process.argv.indexOf('--local');
  if (localFlagIndex !== -1) {
    const file = process.argv[localFlagIndex + 1];
    if (!file) throw new Error('--local requires a file path, e.g. --local sample-data.json');
    console.log('Reading local test data from ' + file + ' (no Firestore, no credentials used)');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const result = {};
    collectionNames.forEach(name => {
      const items = data[name] || [];
      // Local convenience only: synthesize an id if the sample data omitted one.
      // Real Firestore reads always have a real doc id, so this branch never runs there.
      result[name] = items.map((item, i) => item.id ? item : { ...item, id: 'local-' + name + '-' + i });
    });
    return result;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT env var is not set, and --local <file> was not passed.\n' +
      'In the Action this comes from a GitHub secret. Locally, use --local for a dry run.'
    );
  }

  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');

  const serviceAccount = JSON.parse(raw);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const result = {};
  for (const name of collectionNames) {
    const snap = await db.collection(name).get();
    result[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return result;
}

async function main() {
  if (!existsSync(INDEX_PATH)) {
    throw new Error(INDEX_PATH + ' not found in the current directory — run this from the repo root.');
  }

  const collectionNames = SECTIONS.map(s => s.collection);
  const dataByCollection = await fetchAllCollections(collectionNames);

  let html = readFileSync(INDEX_PATH, 'utf8');
  const original = html;
  const summary = [];

  for (const section of SECTIONS) {
    const items = dataByCollection[section.collection] || [];
    console.log('Fetched ' + items.length + ' ' + section.name + ' item(s).');
    if (!items.length && !process.argv.includes('--allow-empty')) {
      throw new Error('Firestore returned 0 ' + section.name + ' entries, so nothing was changed. '
        + 'Run the one-time import first. (Pass --allow-empty only if you really want that section empty.)');
    }
    for (const region of section.regions) {
      const rendered = region.render(items);
      html = region.type === 'js-marker'
        ? replaceBetweenMarkers(html, region.startMarker, region.endMarker, rendered)
        : replaceInnerHtmlById(html, region.id, rendered);
    }
    summary.push(section.name + ': ' + items.length);
  }

  if (html === original) {
    console.log('No changes — rendered output is identical to what is already on disk.');
    return;
  }

  writeFileSync(INDEX_PATH, html);
  console.log('Wrote updated ' + INDEX_PATH + ' (' + summary.join(', ') + ').');
}

main().catch(err => {
  console.error('regenerate.mjs failed:', err.message);
  process.exit(1);
});
