'use strict';

// Checks what someone who installs the package gets, rather than what sits in
// the repository. The difference is not cosmetic: the exports field in
// package.json changes how names resolve, so loading a file by relative path
// (as grammar.test.js does) keeps passing even when the package itself is
// broken for everyone installing it.
//
// The tarball is built with npm pack, installed into an empty project and
// loaded by name -- from CommonJS and from ESM alike.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

// Taken from the manifest rather than written here: spelling it out twice
// means a rename leaves these tests checking the old name and passing.
const PACKAGE_NAME = require(path.join(ROOT, 'package.json')).name;

/**
 * The environment for a nested npm call. The parent npm passes its own
 * configuration down through npm_config_* variables, and a child process
 * inherits them. Under --dry-run that means the npm install inside the test
 * installs nothing and the test fails resolving the module -- that is,
 * `npm publish --dry-run` fails on a package that is perfectly fine.
 *
 * A real publish is unaffected: the variable is not set there. But a dry run
 * is the main way to check a release in advance, and it has to work.
 */
function nestedNpmEnv() {
  const env = { ...process.env };
  delete env.npm_config_dry_run;
  return env;
}

/**
 * How exactly to run npm.
 *
 * On Windows npm is npm.cmd, and Node since 18.20.2 refuses to spawn .cmd and
 * .bat without a shell (the fix for CVE-2024-27980) and fails with EINVAL.
 * Hence:
 *
 * 1. When the test is run by npm itself, npm points npm_execpath at its own JS
 *    file. That is run with the node already executing -- no .cmd, and the same
 *    on every system. This is the prepublishOnly case, that is, publishing.
 * 2. Otherwise (node --test directly) on Windows npm is called through a shell,
 *    with the arguments quoted: node does not quote them itself when using a
 *    shell, and temporary paths contain spaces.
 */
function npmCommand(args) {
  const viaNpm = process.env.npm_execpath;
  if (viaNpm && viaNpm.endsWith('.js')) {
    return { file: process.execPath, args: [viaNpm, ...args], shell: false };
  }
  if (process.platform === 'win32') {
    return { file: 'npm', args: args.map((arg) => '"' + arg + '"'), shell: true };
  }
  return { file: 'npm', args, shell: false };
}

function npm(args, cwd) {
  const { file, args: spawnArgs, shell } = npmCommand(args);
  return execFileSync(file, spawnArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: nestedNpmEnv(),
    shell,
  });
}

/** Packs the package and installs it into a throwaway project. Returns its path. */
function installPackedPackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modx-tmlanguage-pack-'));
  // prepublishOnly runs the test suite; from inside the suite that recurses.
  const packed = npm(['pack', '--ignore-scripts', '--pack-destination', dir], ROOT).trim().split('\n').pop();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }) + '\n'
  );
  npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', path.join(dir, packed)], dir);
  return dir;
}

/** Runs code inside the installed project and returns what it printed. */
function runInConsumer(dir, code, moduleType) {
  const args = moduleType === 'esm' ? ['--input-type=module', '-e', code] : ['-e', code];
  return execFileSync(process.execPath, args, { cwd: dir, encoding: 'utf8' }).trim();
}

let consumerDir;

test.before(() => {
  consumerDir = installPackedPackage();
});

test.after(() => {
  if (consumerDir) fs.rmSync(consumerDir, { recursive: true, force: true });
});

test('require by package name gives the path to the grammar file', () => {
  const out = runInConsumer(consumerDir, `
    const grammarPath = require(${JSON.stringify(PACKAGE_NAME)});
    if (typeof grammarPath !== 'string') {
      throw new Error('expected a path string, got ' + typeof grammarPath);
    }
    console.log(require('fs').existsSync(grammarPath) ? 'ok' : 'no such file: ' + grammarPath);
  `);
  assert.equal(out, 'ok');
});

test('import by package name gives the same path', () => {
  const out = runInConsumer(consumerDir, `
    const { default: grammarPath } = await import(${JSON.stringify(PACKAGE_NAME)});
    if (typeof grammarPath !== 'string') {
      throw new Error('expected a path string, got ' + typeof grammarPath);
    }
    console.log('ok');
  `, 'esm');
  assert.equal(out, 'ok');
});

test('the language configuration is reachable by subpath', () => {
  // The other half of editor support: without it an editor has no bracket
  // matching on [[ ]] and no comment command. It is only reachable through this
  // subpath, so a broken exports map makes it invisible.
  const out = runInConsumer(consumerDir, `
    const config = require(${JSON.stringify(PACKAGE_NAME + '/language-configuration.json')});
    console.log([Array.isArray(config.brackets), Boolean(config.comments.blockComment)].join(' '));
  `);
  assert.equal(out, 'true true');
});

test('the grammar file itself is reachable by subpath', () => {
  const out = runInConsumer(consumerDir, `
    const grammar = require(${JSON.stringify(PACKAGE_NAME + '/modx.tmLanguage.json')});
    console.log(grammar.scopeName);
  `);
  assert.equal(out, 'text.html.modx');
});

test('the path from the package points at a grammar that parses', () => {
  const out = runInConsumer(consumerDir, `
    const fs = require('fs');
    const grammar = JSON.parse(fs.readFileSync(require(${JSON.stringify(PACKAGE_NAME)}), 'utf8'));
    console.log(grammar.scopeName + ' ' + Object.keys(grammar.repository).length);
  `);
  const [scopeName, ruleCount] = out.split(' ');
  assert.equal(scopeName, 'text.html.modx');
  assert.ok(Number(ruleCount) > 0, 'the grammar has no rules');
});

// --- Metadata --------------------------------------------------------------
// The fields npm builds the package page from. An error in them breaks no code
// and so survives unnoticed, until someone goes looking for where to report a
// bug and finds there is no link.

test('the manifest is filled in, in the form npm understands', () => {
  const pkg = require(path.join(ROOT, 'package.json'));

  assert.match(
    pkg.repository.url,
    /^git\+https:\/\//,
    'npm expects repository.url as git+https://…, or it builds no link to the sources'
  );
  assert.ok(pkg.bugs && pkg.bugs.url, 'without bugs.url the package page has no report-a-bug link');
  assert.ok(pkg.homepage, 'no homepage');
  assert.ok(pkg.engines && pkg.engines.node, 'no minimum Node version is declared');

  const repo = 'https://github.com/GulomovCreative/modx-tmlanguage';
  assert.ok(pkg.bugs.url.startsWith(repo), 'bugs.url points at another repository');
  assert.ok(pkg.homepage.startsWith(repo), 'homepage points at another repository');
});

test('LICENSE names the author from the manifest', () => {
  // The licence file and the manifest are two independent places recording the
  // copyright holder, and they can drift apart quietly: the licence is almost
  // never opened, and is published in every release.
  const pkg = require(path.join(ROOT, 'package.json'));
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

  assert.ok(
    license.includes(pkg.author.name),
    'LICENSE does not name the author from package.json: ' + pkg.author.name
  );
  assert.match(license, /^Copyright \(c\) \d{4} /m, 'the copyright line is not in the expected shape');
});

test('a nested npm does not inherit --dry-run from the parent process', () => {
  // A direct check of why npm publish --dry-run used to fail: the variable has
  // to be cleared for the child process specifically, not globally, or the test
  // would change the environment of the whole run.
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

test('npm is run without touching .cmd when its path is known', () => {
  // Windows: Node since 18.20.2 will not spawn .cmd without a shell and fails
  // with EINVAL. Under npm itself its JS file and the current node will do.
  const before = process.env.npm_execpath;
  process.env.npm_execpath = '/opt/npm/bin/npm-cli.js';
  try {
    const command = npmCommand(['pack']);
    assert.equal(command.file, process.execPath);
    assert.deepEqual(command.args, ['/opt/npm/bin/npm-cli.js', 'pack']);
    assert.equal(command.shell, false, 'no shell is needed when the JS path is known');
  } finally {
    if (before === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = before;
  }
});

test('the npm-cli.js route is not taken when the path is not JS', () => {
  // npm_execpath may point at a .cmd, which cannot be run through node.
  const before = process.env.npm_execpath;
  process.env.npm_execpath = 'C:\\Program Files\\nodejs\\npm.cmd';
  try {
    assert.notEqual(npmCommand(['pack']).file, process.execPath);
  } finally {
    if (before === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = before;
  }
});

test('the README badges point at this repository and this package', () => {
  // Badges are copied from other projects more often than written from scratch,
  // and someone else's address in one looks perfectly normal -- a green tick
  // from another project's CI looks no different.
  const pkg = require(path.join(ROOT, 'package.json'));
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const badges = readme.slice(0, readme.indexOf('\n\nPrevious'));

  const repo = 'GulomovCreative/modx-tmlanguage';
  const foreign = [...badges.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)/g)]
    .map((match) => match[1])
    .filter((slug) => slug !== repo);
  assert.deepEqual(foreign, [], 'a badge points at another repository');

  assert.ok(
    badges.includes('/npm/v/' + pkg.name),
    'the version badge is not about the package ' + pkg.name
  );
  assert.ok(
    badges.includes('npmjs.com/package/' + pkg.name),
    'the version badge links to another package: ' + pkg.name
  );
  assert.ok(
    badges.includes('license-' + pkg.license + '-'),
    'the licence badge disagrees with the license field: ' + pkg.license
  );
});

// --- What is published -----------------------------------------------------
// The tests above check that the installed package works. This one checks that
// it holds exactly what was intended: a stray file in the archive is otherwise
// only visible to whoever thinks to look, and a publish cannot be taken back.
//
// The check used to be a step of its own in CI and so never ran locally -- the
// server was the one reporting a stray file. Here it runs with everything else,
// including before a publish, through prepublishOnly.

/**
 * The entries of `npm pack --json` output, whichever shape npm printed.
 *
 * Up to npm 11 the command prints an array of entries, one per packed package.
 * npm 12 prints an object keyed by package name instead. Both have to be read:
 * the release workflow installs the newest npm -- trusted publishing needs
 * 11.5.1 or later -- while everyone else runs whatever shipped with their Node.
 *
 * This is not a precaution. The same line in the sibling repository stopped its
 * first release cut through the workflow: npm publish runs prepublishOnly, the
 * suite destructured the object as an array, and nothing was published.
 */
function packEntries(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') return Object.values(parsed);
  throw new TypeError('npm pack --json printed neither an array nor an object');
}

// Written out here rather than derived from package.json: deriving it from the
// same files field that gets edited would catch nothing. README.md, LICENSE and
// package.json are added by npm itself, whatever files says.
const EXPECTED_FILES = [
  'LICENSE',
  'README.md',
  'index.js',
  'language-configuration.json',
  'modx.tmLanguage.json',
  'package.json',
];

test('the tarball holds exactly the expected files', () => {
  const [tarball] = packEntries(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], ROOT));
  const actual = tarball.files.map((file) => file.path).sort();

  assert.deepEqual(
    actual,
    [...EXPECTED_FILES].sort(),
    'the contents of the package changed. If that is intended, update EXPECTED_FILES here'
  );
});

test('the pack output is read in both of the shapes npm prints', () => {
  // npm 11 and earlier print an array; npm 12 prints an object keyed by package
  // name. The release workflow runs the newest npm and everyone else runs an
  // older one, so both shapes reach this code.
  const entry = { id: 'p@1.0.0', filename: 'p-1.0.0.tgz', files: [{ path: 'index.js' }] };

  const fromArray = packEntries(JSON.stringify([entry]));
  const fromObject = packEntries(JSON.stringify({ p: entry }));

  assert.deepEqual(fromArray, [entry]);
  assert.deepEqual(fromObject, [entry]);
  assert.deepEqual(fromArray, fromObject, 'the two shapes must read the same');
});

test('a pack output that is neither shape is an error, not an empty list', () => {
  // Returning [] here would turn a broken npm invocation into a passing test
  // that checked nothing.
  assert.throws(() => packEntries('"a string"'), TypeError);
  assert.throws(() => packEntries('42'), TypeError);
});
