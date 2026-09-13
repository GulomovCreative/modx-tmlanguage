'use strict';

// Runs between the version bump in package.json and the commit npm makes for
// it. The number being released is known here and nowhere earlier, which makes
// this the one place that can bring the changelog in line with it.
//
// What it does is close the Unreleased section: rename it to the version with
// today's date, open a fresh empty Unreleased above it, and rewrite the link
// definitions at the foot of the file. That was four manual steps, any one of
// which is easy to forget, and a forgotten one surfaces after publication --
// when the version can no longer be taken back.
//
// The rewritten file is staged: npm puts whatever this script stages into the
// version commit.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/**
 * Whether the changelog has a section for this version. Separate from the file
 * handling so the heading format can be tested without cutting a release.
 */
function changelogHasVersion(changelog, version) {
  // A heading like "## [2.1.0] — 2026-09-12", or just "## [2.1.0]".
  const heading = new RegExp('^## \\[' + version.replace(/\./g, '\\.') + '\\]', 'm');
  return heading.test(changelog);
}

/** Whether anything is left written under Unreleased. */
function unreleasedIsEmpty(changelog) {
  const match = changelog.match(/^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[)/m);
  if (!match) return true;
  return match[1].trim() === '';
}

/**
 * Moves what is under Unreleased into a section for the version being released.
 * A pure function over the file's text, so every shape of changelog it has to
 * cope with can be tested without publishing anything. Returns the new text.
 *
 * The link definitions at the foot are rewritten along with the headings. They
 * are the half of the job that is easiest to forget: a "## [2.1.0]" heading
 * with no definition behind it is, in Markdown, just text in brackets, and
 * nothing in the repository notices.
 */
function closeUnreleased(changelog, version, date) {
  const heading = /^## \[Unreleased\][^\n]*\n/m;
  if (!heading.test(changelog)) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  }

  // The Unreleased link carries the previous tag, which is the start of the
  // comparison range for the version being released.
  const link = /^\[Unreleased\]:[ \t]*(\S+)\/compare\/(\S+)\.\.\.HEAD[ \t]*$/m;
  const parsed = changelog.match(link);
  if (!parsed) {
    throw new Error(
      'CHANGELOG.md has no "[Unreleased]: <url>/compare/<tag>...HEAD" definition at the ' +
      'foot — there is nothing to build the new version\'s comparison range from'
    );
  }

  const [, base, previousTag] = parsed;

  return changelog
    .replace(heading, (matched) => matched + '\n## [' + version + '] — ' + date + '\n')
    .replace(
      link,
      '[Unreleased]: ' + base + '/compare/v' + version + '...HEAD\n' +
      '[' + version + ']: ' + base + '/compare/' + previousTag + '...v' + version
    );
}

/** Today's date in local time, as YYYY-MM-DD. */
function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function main() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  const changelog = fs.readFileSync(changelogPath, 'utf8');

  // Already closed by hand: leave it alone. Rewriting someone's edit is worse
  // than doing nothing.
  if (changelogHasVersion(changelog, version)) {
    if (!unreleasedIsEmpty(changelog)) {
      console.warn(
        '\nWarning: entries are left under "## [Unreleased]" — they will not be part\n' +
        'of the description of ' + version + '. Move them if that is not intended.\n'
      );
    }
    return;
  }

  if (unreleasedIsEmpty(changelog)) {
    console.error(
      '\nRelease stopped: nothing is written under "## [Unreleased]" in CHANGELOG.md.\n\n' +
      '  Either there is nothing to release, or the changes are undescribed.\n'
    );
    process.exit(1);
  }

  let updated;
  try {
    updated = closeUnreleased(changelog, version, today());
  } catch (error) {
    console.error('\nRelease stopped: ' + error.message + '.\n');
    process.exit(1);
  }

  fs.writeFileSync(changelogPath, updated);
  execFileSync('git', ['add', '--', changelogPath], { cwd: ROOT });
  console.log('CHANGELOG.md: the Unreleased section was closed as ' + version + '.');
}

if (require.main === module) main();

module.exports = { changelogHasVersion, unreleasedIsEmpty, closeUnreleased, today };
