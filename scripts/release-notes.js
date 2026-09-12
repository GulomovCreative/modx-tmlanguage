'use strict';

// Prints the CHANGELOG section for one version, so the release workflow can
// use it as the body of the GitHub release.
//
// The changelog is where the release is already described, in the words it was
// written in. Anything else -- a list of commit subjects, a hand-written note
// in the release form -- is a second description that drifts from the first.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * The body of the section for `version`, without its heading, or null when the
 * changelog has no such section.
 *
 * A section ends at the next version heading, or at the block of link
 * definitions at the foot of the file -- which is not a heading and would
 * otherwise be pulled into the notes of the newest version. Deeper headings
 * (### Added, ### Fixed) belong to the section and are kept.
 */
function sectionFor(changelog, version) {
  const heading = new RegExp('^## \\[' + version.replace(/\./g, '\\.') + '\\][^\\n]*\\n', 'm');
  const start = changelog.match(heading);
  if (!start) return null;

  const body = changelog.slice(start.index + start[0].length);
  const end = body.search(/^(?:## |\[[^\]]+\]:[ \t]*\S+[ \t]*$)/m);
  return (end === -1 ? body : body.slice(0, end)).trim();
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.js <version>');
    process.exit(2);
  }

  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const section = sectionFor(changelog, version);

  if (section === null) {
    console.error('CHANGELOG.md has no section for ' + version);
    process.exit(1);
  }

  // An empty section is not an error: a release can be small enough that the
  // heading carries all there is to say. The workflow still gets a body.
  console.log(section === '' ? 'See CHANGELOG.md.' : section);
}

if (require.main === module) main();

module.exports = { sectionFor };
