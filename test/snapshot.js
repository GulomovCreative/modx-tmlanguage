'use strict';

// Regenerating the snapshots: npm run test:update
// Snapshots are committed, and their diff in a pull request shows what a change
// to the grammar did to the tokenization.

const fs = require('fs');
const path = require('path');
const { tokenize, formatSnapshot } = require('./tokenize');

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const SNAPSHOTS_DIR = path.resolve(__dirname, 'snapshots');

function fixtureNames() {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.tpl'))
    .sort();
}

function snapshotPathFor(fixtureName) {
  return path.join(SNAPSHOTS_DIR, fixtureName.replace(/\.tpl$/, '.txt'));
}

async function buildSnapshot(fixtureName) {
  const source = fs.readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8');
  return formatSnapshot(await tokenize(source));
}

async function main() {
  fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  for (const name of fixtureNames()) {
    const snapshot = await buildSnapshot(name);
    fs.writeFileSync(snapshotPathFor(name), snapshot);
    console.log('updated ' + path.relative(process.cwd(), snapshotPathFor(name)));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { fixtureNames, snapshotPathFor, buildSnapshot, FIXTURES_DIR, SNAPSHOTS_DIR };
