'use strict';

// Checks that run before `npm version`. They exist because the release pushes
// whatever is checked out: `npm version` bumps the manifest, commits, tags and
// pushes the current branch, and the pushed tag is what the release workflow
// publishes. Running it from the wrong branch would put that branch's contents
// on npm, and a published version cannot be taken back.

const { execFileSync } = require('child_process');

const RELEASE_BRANCH = 'master';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * Parses `git status --porcelain`. Kept out of git() above, which trims the
 * whole output: the first character of a status line is significant and is
 * often a space (" M file" is modified but unstaged), so trimming would eat
 * the first letter of the file name.
 */
function parseStatus(raw) {
  return raw
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3));
}

/**
 * The state check as a pure function, so it can be tested without building a
 * repository in each of the states it is meant to refuse. Returns the reasons
 * the release must not start; an empty list means it may.
 */
function releaseBlockers({ branch, dirtyFiles, behindCount }) {
  const blockers = [];

  if (branch !== RELEASE_BRANCH) {
    blockers.push(
      'the release is being cut from "' + branch + '" rather than "' + RELEASE_BRANCH +
      '" — that branch\'s contents would be published'
    );
  }

  if (dirtyFiles.length > 0) {
    blockers.push(
      'the working tree has uncommitted changes (' + dirtyFiles.length + '), ' +
      'and they would go into the package: ' + dirtyFiles.slice(0, 5).join(', ') +
      (dirtyFiles.length > 5 ? ' and ' + (dirtyFiles.length - 5) + ' more' : '')
    );
  }

  if (behindCount > 0) {
    blockers.push(
      'the local branch is ' + behindCount + ' commit(s) behind origin/' + RELEASE_BRANCH +
      ' — part of the work would be left out of the release'
    );
  }

  return blockers;
}

function collectState() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirtyFiles = parseStatus(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  );

  let behindCount = 0;
  try {
    execFileSync('git', ['fetch', 'origin', RELEASE_BRANCH], { stdio: 'ignore' });
    behindCount = Number(git('rev-list', '--count', 'HEAD..origin/' + RELEASE_BRANCH));
  } catch (error) {
    // Offline, so how far behind the branch is cannot be known. That is not a
    // reason to block the release, but it is not a reason to stay quiet either.
    console.warn('preversion: could not reach origin — the behind check was skipped');
  }

  return { branch, dirtyFiles, behindCount };
}

function main() {
  const blockers = releaseBlockers(collectState());
  if (blockers.length === 0) return;

  console.error('\nRelease stopped:\n');
  for (const blocker of blockers) console.error('  • ' + blocker);
  console.error('\nFix the above and run it again.\n');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { releaseBlockers, parseStatus, RELEASE_BRANCH };
