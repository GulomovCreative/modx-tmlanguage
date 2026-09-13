'use strict';

// Checks that every file in the published tarball uses LF.
//
// The repository has always stored LF, and `.gitattributes` pins the checkout
// to it. That is the fix; this is the guard that the fix held. The failure it
// guards against is real and happened in the sibling grammar: with git's
// default `core.autocrlf=true` on Windows the working tree gets CRLF, `npm
// pack` packs the working tree verbatim, and CRLF reaches npm from commits that
// never contained it.
//
// So it has to read the packed archive rather than the working tree. A check
// that reads the working tree reads the same bytes the guard is protecting,
// through the path the fault never takes, and proves nothing.
//
// On Linux CI this can never fail, which is why it is wired into `npm test` and
// through it into `prepublishOnly`: there it runs on the machine cutting the
// release, which is the only machine where the fault can occur.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const BLOCK = 512;

function readString(header, offset, length) {
  const end = header.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return header.toString('utf8', offset, stop);
}

/** Minimal ustar reader: enough to walk entries and hand back file contents. */
function* tarEntries(archive) {
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) return;

    const name = readString(header, 0, 100);
    const size = parseInt(readString(header, 124, 12).trim(), 8) || 0;
    const type = String.fromCharCode(header[156]); // '0' and NUL both mean a file

    offset += BLOCK;
    const content = archive.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (type === '0' || type === '\0') yield { name, content };
  }
}

/**
 * The environment for a nested npm call. npm passes its own configuration down
 * through npm_config_* variables and a child process inherits them, so under
 * `npm publish --dry-run` the pack below would write no tarball and this suite
 * would fail on a package that is perfectly fine. A dry run is the main way to
 * check a release in advance, so it has to work; a real publish never sets the
 * variable and is unaffected.
 */
function nestedNpmEnv() {
  const env = { ...process.env };
  delete env.npm_config_dry_run;
  return env;
}

/**
 * How exactly to run npm. On Windows npm is npm.cmd, and Node since 18.20.2
 * refuses to spawn .cmd without a shell (the fix for CVE-2024-27980). Under npm
 * itself -- `npm test`, and so `prepublishOnly` -- npm_execpath points at its
 * own JS file, which the node already running can execute; otherwise on Windows
 * npm is called through a shell with its arguments quoted, because node does
 * not quote them itself and temporary paths contain spaces.
 *
 * This is the same reasoning as in package.test.js, spelled out again rather
 * than shared: it is the part that only matters on the machine cutting the
 * release, and it is worth reading where it runs.
 */
function npm(args, cwd) {
  const viaNpm = process.env.npm_execpath;
  const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: nestedNpmEnv() };

  if (viaNpm && viaNpm.endsWith('.js')) {
    return execFileSync(process.execPath, [viaNpm, ...args], options);
  }
  if (process.platform === 'win32') {
    return execFileSync('npm', args.map((arg) => '"' + arg + '"'), { ...options, shell: true });
  }
  return execFileSync('npm', args, options);
}

/**
 * The entries of `npm pack --json`, whichever shape npm printed: an array up to
 * npm 11, an object keyed by package name from npm 12. Both reach this code --
 * the release workflow installs the newest npm, everyone else runs whatever
 * came with their Node.
 */
function packEntries(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') return Object.values(parsed);
  throw new TypeError('npm pack --json printed neither an array nor an object');
}

let archive;
let destination;

test.before(() => {
  destination = fs.mkdtempSync(path.join(os.tmpdir(), 'modx-tmlanguage-eol-'));
  // --ignore-scripts: prepublishOnly runs this suite, and from inside the suite
  // a packing step that ran scripts would recurse.
  const [{ filename }] = packEntries(
    npm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination], ROOT)
  );
  archive = zlib.gunzipSync(fs.readFileSync(path.join(destination, filename)));
});

test.after(() => {
  if (destination) fs.rmSync(destination, { recursive: true, force: true });
});

test('the archive reader finds the files that are in the package', () => {
  // Without this the check below passes on an empty list, which is the one way
  // a guard like this fails silently.
  const names = [...tarEntries(archive)].map((entry) => entry.name);
  assert.ok(names.length > 0, 'the tarball held no files — the reader is broken');
  assert.ok(
    names.some((name) => name.endsWith('modx.tmLanguage.json')),
    'the grammar is not in the archive the reader walked: ' + names.join(', ')
  );
});

test('every published file uses LF', () => {
  const withCR = [];
  let checked = 0;

  for (const { name, content } of tarEntries(archive)) {
    checked++;
    if (content.includes(0x0d)) withCR.push(name);
  }

  assert.deepEqual(
    withCR,
    [],
    `${withCR.length} of ${checked} published files carry CR.\n` +
      'The checkout is producing CRLF. Refresh the working tree against\n' +
      '.gitattributes and pack again:\n\n' +
      '  git rm --cached -r .\n' +
      '  git reset --hard\n'
  );
});

test('the reader would see a CR if one were there', () => {
  // The check above can only fail if the reader hands back file contents. This
  // builds a one-entry archive whose file does contain CRLF and reads it back,
  // so a reader that silently returns nothing fails here rather than passing
  // everything.
  const body = Buffer.from('a\r\nb\r\n', 'utf8');
  const header = Buffer.alloc(BLOCK);
  header.write('crlf.txt', 0, 'utf8');
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'utf8');
  header.write('0', 156, 'utf8');

  const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
  body.copy(padded);

  const entries = [...tarEntries(Buffer.concat([header, padded, Buffer.alloc(BLOCK * 2)]))];
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'crlf.txt');
  assert.ok(entries[0].content.includes(0x0d), 'the reader lost the CR it was handed');
});

test('a nested npm does not inherit --dry-run from the parent process', () => {
  // Without this the pack above writes nothing under `npm publish --dry-run`,
  // and the suite fails on a release that is fine. The variable is cleared for
  // the child only, not for the process running the tests.
  const before = process.env.npm_config_dry_run;
  process.env.npm_config_dry_run = 'true';
  try {
    assert.equal('npm_config_dry_run' in nestedNpmEnv(), false);
    assert.equal(process.env.npm_config_dry_run, 'true', 'the process environment was modified');
  } finally {
    if (before === undefined) delete process.env.npm_config_dry_run;
    else process.env.npm_config_dry_run = before;
  }
});

test('the pack output is read in both of the shapes npm prints', () => {
  const entry = { id: 'p@1.0.0', filename: 'p-1.0.0.tgz' };
  assert.deepEqual(packEntries(JSON.stringify([entry])), [entry]);
  assert.deepEqual(packEntries(JSON.stringify({ p: entry })), [entry]);
  assert.throws(() => packEntries('"a string"'), TypeError);
});
