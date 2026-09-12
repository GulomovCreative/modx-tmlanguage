'use strict';

// The release checks, tested without cutting a release.
//
// Both scripts are driven by npm at moments that are hard to reach on purpose:
// preversion runs against whatever state the repository happens to be in, and
// version runs with a version number that only exists for the length of the
// command. What can be decided from text alone is therefore kept in pure
// functions, and this is where those are exercised.

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { releaseBlockers, parseStatus, RELEASE_BRANCH } = require('../scripts/preversion.js');
const { changelogHasVersion, unreleasedIsEmpty, closeUnreleased, today } = require('../scripts/version.js');
const { sectionFor } = require('../scripts/release-notes.js');

const clean = { branch: RELEASE_BRANCH, dirtyFiles: [], behindCount: 0 };

// --- What may not be released ----------------------------------------------

test('a clean checkout of the release branch is not blocked', () => {
  assert.deepEqual(releaseBlockers(clean), []);
});

test('releasing from another branch is blocked', () => {
  const blockers = releaseBlockers({ ...clean, branch: 'verify-master3' });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /verify-master3/);
});

test('uncommitted changes block the release', () => {
  const blockers = releaseBlockers({ ...clean, dirtyFiles: ['modx.tmLanguage.json'] });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /modx\.tmLanguage\.json/);
});

test('a long list of changed files is cut short', () => {
  const many = Array.from({ length: 9 }, (_, i) => 'file' + i + '.txt');
  const [blocker] = releaseBlockers({ ...clean, dirtyFiles: many });
  assert.match(blocker, /file0/);
  assert.match(blocker, /4 more/);
  assert.ok(!blocker.includes('file8'), 'the list was not cut short');
});

test('being behind the remote blocks the release', () => {
  const blockers = releaseBlockers({ ...clean, behindCount: 3 });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /3 commit/);
});

test('every reason is named at once, not just the first', () => {
  const blockers = releaseBlockers({ branch: 'wip', dirtyFiles: ['a.js'], behindCount: 2 });
  assert.equal(blockers.length, 3);
});

test('a file name does not lose its first character', () => {
  // " M package.json" is modified but unstaged: the first character of the
  // line is significant and is a space.
  assert.deepEqual(
    parseStatus(' M package.json\n?? scripts/\nM  index.js\n'),
    ['package.json', 'scripts/', 'index.js']
  );
});

test('empty git status output gives an empty list', () => {
  assert.deepEqual(parseStatus(''), []);
  assert.deepEqual(parseStatus('\n'), []);
});

// --- Closing the changelog -------------------------------------------------

const sample = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '- something new',
  '',
  '## [1.2.0] — 2026-01-01',
  '',
  '### Fixed',
  '- something old',
  '',
  '[Unreleased]: https://example.com/o/r/compare/v1.2.0...HEAD',
  '[1.2.0]: https://example.com/o/r/releases/tag/v1.2.0',
  ''
].join('\n');

test('a version heading is recognised with or without a date', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\n## [2.0.0] — 2026-09-11\n\n### Fixed\n';
  assert.equal(changelogHasVersion(changelog, '2.0.0'), true);
  assert.equal(changelogHasVersion(changelog, '2.0.1'), false);
  assert.equal(changelogHasVersion('## [3.1.0]\n', '3.1.0'), true);
});

test('dots in a version number are not treated as any character', () => {
  // A naive "2.0.0" in the pattern would also match "21000".
  assert.equal(changelogHasVersion('## [21000]\n', '2.0.0'), false);
});

test('a filled Unreleased section is told from an empty one', () => {
  assert.equal(unreleasedIsEmpty('## [Unreleased]\n\n## [2.0.0]\n\n### Fixed\n- x\n'), true);
  assert.equal(unreleasedIsEmpty(sample), false);
});

test('what was under Unreleased ends up under the version heading', () => {
  const result = closeUnreleased(sample, '1.3.0', '2026-02-03');
  assert.match(result, /^## \[1\.3\.0\] — 2026-02-03$/m);
  assert.ok(
    result.indexOf('## [1.3.0]') < result.indexOf('### Added'),
    'the entries stayed above the version heading'
  );
});

test('an empty Unreleased is left in place for the next cycle', () => {
  const result = closeUnreleased(sample, '1.3.0', '2026-02-03');
  assert.match(result, /^## \[Unreleased\]$/m, 'the Unreleased section is gone');
  assert.equal(unreleasedIsEmpty(result), true);
});

test('the link definitions are rewritten', () => {
  const result = closeUnreleased(sample, '1.3.0', '2026-02-03');
  assert.match(result, /^\[Unreleased\]: https:\/\/example\.com\/o\/r\/compare\/v1\.3\.0\.\.\.HEAD$/m);
  assert.match(result, /^\[1\.3\.0\]: https:\/\/example\.com\/o\/r\/compare\/v1\.2\.0\.\.\.v1\.3\.0$/m);

  // Older definitions are left alone: older sections link to them.
  assert.match(result, /^\[1\.2\.0\]: https:\/\/example\.com\/o\/r\/releases\/tag\/v1\.2\.0$/m);
});

test('the section just written is found by the version check', () => {
  // Two functions describe one heading format from opposite sides. If they
  // drift apart, a release silently stops seeing the section it just wrote.
  assert.equal(changelogHasVersion(closeUnreleased(sample, '1.3.0', '2026-02-03'), '1.3.0'), true);
});

test('closing twice does not stack sections', () => {
  const twice = closeUnreleased(closeUnreleased(sample, '1.3.0', '2026-02-03'), '1.4.0', '2026-03-04');
  assert.equal((twice.match(/^## \[1\.3\.0\]/gm) || []).length, 1);
  assert.match(twice, /^\[1\.4\.0\]: https:\/\/example\.com\/o\/r\/compare\/v1\.3\.0\.\.\.v1\.4\.0$/m);
});

test('without an Unreleased section there is nothing to close', () => {
  assert.throws(() => closeUnreleased('# Changelog\n\n## [1.0.0]\n', '1.1.0', '2026-02-03'), /Unreleased/);
});

test('without a comparison link the close stops', () => {
  // Skipping the links silently is not an option: a "## [1.3.0]" heading with
  // no definition behind it is just text in brackets.
  const withoutLink = sample.replace(/^\[Unreleased\]:.*$/m, '');
  assert.throws(() => closeUnreleased(withoutLink, '1.3.0', '2026-02-03'), /compare/);
});

test('the date is local, not UTC', () => {
  // toISOString() gives the UTC date: late in an eastern timezone that is
  // already tomorrow, and the release would carry a date from the future.
  assert.equal(today(new Date(2026, 1, 3, 23, 30)), '2026-02-03');
  assert.equal(today(new Date(2026, 10, 9, 0, 5)), '2026-11-09');
});

// --- Release notes ---------------------------------------------------------

test('a version section is extracted without its heading', () => {
  const notes = sectionFor(sample, '1.2.0');
  assert.match(notes, /### Fixed/);
  assert.match(notes, /something old/);
  assert.ok(!notes.includes('1.2.0'), 'the version heading is in the notes');
  assert.ok(!notes.includes('something new'), 'the Unreleased section was pulled in');
});

test('sub-headings inside a section are kept', () => {
  // "### Migration" and the like are part of the description, not a boundary.
  const notes = sectionFor('## [2.0.0]\n\nLead.\n\n### Migration\n\nWhat to do.\n\n## [1.0.0]\n', '2.0.0');
  assert.match(notes, /### Migration/);
  assert.match(notes, /What to do/);
});

test('the link definitions at the foot stay out of the notes', () => {
  // The newest version has no heading below it: without stopping at the link
  // definitions they would end up in the body of the release.
  const changelog = '## [1.0.0]\n\nFirst release.\n\n[1.0.0]: https://example.com/o/r/tag/v1.0.0\n';
  assert.equal(sectionFor(changelog, '1.0.0'), 'First release.');
});

test('a missing version gives null, not empty text', () => {
  // The difference matters: an empty section is a release described by its
  // heading alone, a missing one is a reason to stop publishing.
  assert.equal(sectionFor('## [1.0.0]\n\ntext\n', '2.0.0'), null);
  assert.equal(sectionFor('## [1.0.0]\n\n## [0.9.0]\n\ntext\n', '1.0.0'), '');
});

// --- The repository's own changelog ----------------------------------------

test('the changelog is in the shape a release expects', () => {
  // The version in package.json is bumped by npm version itself, so what is
  // checked here is the current one -- that the file and the manifest have not
  // drifted apart. Entries may sit under Unreleased: accumulating them between
  // releases is the normal state of the file, and the script closes it.
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const { version } = require(path.join(__dirname, '..', 'package.json'));

  assert.equal(changelogHasVersion(changelog, version), true, 'no section for ' + version);
  assert.notEqual(sectionFor(changelog, version), null);

  // The heading and the link the closing script needs. Without either, the
  // release fails -- but only after the version has already been bumped.
  assert.match(changelog, /^## \[Unreleased\]/m, 'no Unreleased heading');
  assert.match(
    changelog,
    /^\[Unreleased\]:[ \t]*\S+\/compare\/\S+\.\.\.HEAD[ \t]*$/m,
    'no [Unreleased]: .../compare/<tag>...HEAD definition'
  );
});
