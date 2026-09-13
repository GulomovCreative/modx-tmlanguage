# Contributing

Thanks for helping out. This is a small repository — one grammar file and the
tests that keep it honest — so the rules are short.

## Getting set up

``` sh
npm install
npm test
```

Node 20 or newer. The test suite uses the built-in test runner, so there is no
framework to learn.

## The one rule that matters

**Check MODX's own parser before changing what the grammar accepts.**

The grammar describes a syntax that another program defines, so guesses and
community advice are not evidence. `core/src/Revolution/modParser.php` in
[modxcms/revolution](https://github.com/modxcms/revolution) is the authority —
`switch ($token)` for element types, `parsePropertyString` for properties.

This has already changed decisions twice. Backticks around property values look
mandatory in every tutorial, but the parser strips them only when present, so
`&tpl=row` is valid and must not be flagged as an error. A doubled backtick
inside a value is an escape, which is easy to miss until you read the
`str_replace` that handles it.

When a change rests on parser behaviour, quote the relevant lines in the pull
request. Reviewers should not have to go find them.

## Changing the grammar

Tests come in three layers, and a change usually touches more than one:

- **Snapshots** in `test/snapshots/` record how fixtures tokenize. They are
  generated, never hand-edited.
- **Behaviour tests** in `test/grammar.test.js` state one specific expectation
  each, so a failure says what broke rather than that something did.
- **Consistency checks** hold the grammar to its own conventions: every scope
  starts with a root themes recognise, and appears in the README.
- **Embedded-language tests** in `test/embedded.test.js` load the HTML, CSS and
  JavaScript grammars from Shiki to cover tags inside attributes, `<style>` and
  `<script>`. They are kept apart from the snapshots so that a third-party
  grammar update cannot rewrite every snapshot in the repository.
- **Language configuration tests** in `test/language-configuration.test.js` put
  the comment markers and delimiters the editor would insert back through the
  grammar. The two can disagree, and nothing else would notice.
- **Preview tests** in `test/preview.test.js` re-render `docs/preview.tpl`
  through real editor themes. Run `npm run preview:update` after an intended
  change and read the diff: it is the colour of every token in the sample.
- **The performance guard** in `test/performance.test.js` holds tokenization of
  awkward input to a time budget.
- **Fuzz tests** in `test/fuzz.test.js` generate templates from a fixed seed.
  `FUZZ_SEED` re-runs a failing set; `FUZZ_CASES` changes how many are tried.

The workflow:

1. Add a fixture to `test/fixtures/` covering the syntax you care about.
2. Change the grammar.
3. Run `npm run test:update`, then **read the snapshot diff**. It is the whole
   point of the snapshots — it shows exactly what your regex did, including to
   the cases you were not thinking about.
4. Add a behaviour test for the thing you fixed.
5. Document any new scope in the README's Scopes section, or the suite fails.

A snapshot diff larger than you expected means the change is larger than you
expected. Investigate before committing it.

## Scope names

Every scope must start with a root that editor themes recognise (`comment`,
`constant`, `entity`, `keyword`, `meta`, `punctuation`, `string`, `support`,
`variable`, and so on) and end in `.modx`. A scope outside that set is invisible
— themes simply ignore it, and the token renders unstyled. A test enforces this.

Scope names are a public interface: themes target them. Renaming one is a
breaking change for anyone who styled it.

## Pull requests

One concern per pull request. Say what you changed, why, and what you checked.

Add an entry to `CHANGELOG.md` under `## [Unreleased]` for anything a user of
the package would notice — a highlighting change, a new scope, a change to what
the package exports. Internal refactors and test-only changes do not need one.
If a change is risky — anything touching where a tag or comment begins and ends
— say what could regress and what you did to rule it out.

## Releasing

Releases go out from `master` with one command:

``` sh
npm run publish:major   # or publish:minor / publish:patch
```

That runs `npm version`, which bumps `package.json`, closes the changelog,
commits, tags and pushes. Publishing itself happens in GitHub Actions: the
pushed tag starts `.github/workflows/release.yml`, which runs the tests again,
publishes to npm and opens a GitHub release with the changelog section as its
body.

So preparing a release means writing changelog entries under `## [Unreleased]`
as you go, and nothing else. The version number, the section heading, its date,
the fresh empty `Unreleased` and the link definitions at the foot of the file
are all written by `scripts/version.js` during `npm version`. Leave `version` in
`package.json` alone too — `npm version` owns it, and setting it by hand makes
the release skip a number.

Three guards run before anything is published, because a published version
cannot be taken back:

- `preversion` refuses to run from a branch other than `master`, with
  uncommitted changes, or when the branch is behind the remote.
- `version` refuses to continue when there is nothing under `Unreleased` to
  release, or when the changelog has no link definition to build the comparison
  range from.
- The `verify` job in the release workflow refuses to publish a tag that
  disagrees with `package.json`, or one the changelog has no section for.

### Publishing rights: setting up the trusted publisher

The workflow holds no npm token. It authenticates as itself through OIDC, which
npm calls [trusted publishing](https://docs.npmjs.com/trusted-publishers), and
npm has to be told once which workflow to trust. This is a one-off manual step
and the release cannot publish until it is done.

**Before you start.** You need to be an owner or maintainer of
`@gulomov/modx-tmlanguage` on npmjs.com, and the package has to exist there
already — trust is configured on a package, so the very first version of a
brand-new package still has to be published by hand. That is not the case here:
the package has been published since 1.0.0.

**On npmjs.com.**

1. Sign in and open the package page:
   <https://www.npmjs.com/package/@gulomov/modx-tmlanguage>.
2. Open the package's **Settings** tab.
3. Find the **Trusted Publisher** section and choose **GitHub Actions**.
4. Fill in the three fields that identify the workflow, exactly:
   - organization or user: `GulomovCreative`
   - repository: `modx-tmlanguage`
   - workflow filename: `release.yml` — the file name only, with its extension,
     not a path and not the `name:` inside the file.
5. Leave the environment field empty. The release job does not run in a GitHub
   Actions environment, and a value here would be one more thing that has to
   match.
6. Save.

The trust is pinned to that org / repository / workflow-filename triple.
Renaming `release.yml`, moving the repository, or publishing from a different
workflow breaks it, and the fix is to update the same form.

**What already holds on this side**, so there is nothing to do in the
repository:

- `.github/workflows/release.yml` grants the publish job `id-token: write`,
  which is what lets it request an OIDC token at all.
- The job installs a current npm before publishing. Trusted publishing needs
  npm 11.5.1 or newer, and the npm bundled with Node 22 is older.
- The publish step passes no token and no `--provenance`: publishing this way
  generates the provenance attestation on its own.

**Check that it worked.** After the next release the version on npm carries a
provenance badge linking back to the workflow run that built it. Nothing else
needs to be looked at.

**When it does not work.**

- `404 Not Found` or `E401` on the publish step almost always means the trust
  is not configured, or one of the three fields does not match — a typo in the
  repository name, or a path rather than a bare filename in the workflow field.
- `E403` or a demand for a one-time password means npm is still expecting a
  human or a token for this package; check the package's publishing access
  settings on the same Settings tab.
- Either way the tag has already been pushed. See below for how to retry.

**Afterwards.** Any automation token that existed only to publish this package
can be deleted from your npm account. A token that cannot be used is one that
cannot leak.

### One other thing the release depends on

The package is published under the `@gulomov` scope, so `publishConfig.access`
is set to `public` in the manifest. Without it npm publishes scoped packages
privately, which fails on a free account.

### When a release fails

The tag is pushed before the workflow runs, so a failed publish leaves a tag
pointing at a version that is not on npm. Fix the cause, then delete the tag
locally and on the remote and push it again — the workflow triggers on the tag,
so re-pushing it is what retries the release:

``` sh
git tag -d v1.2.3 && git push origin :refs/tags/v1.2.3
git tag -a v1.2.3 -m v1.2.3 && git push origin v1.2.3
```

Do not bump the version a second time to work around a failed publish: the
number that failed was never taken.

Which part to bump is decided by what the change does to the two public
surfaces: what the package exports, and the scope names. Renaming a scope breaks
every theme that targets it, so it is a major change even though no code fails.
