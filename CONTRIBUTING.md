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

That runs `npm version`, which bumps `package.json`, commits, tags, pushes and
publishes to npm. Two guards run first, because a published version cannot be
taken back:

- `preversion` refuses to run from a branch other than `master`, with
  uncommitted changes, or when the branch is behind the remote.
- `version` refuses to continue if `CHANGELOG.md` has no section for the version
  being released, and warns if entries are left under `Unreleased`.

So preparing a release means editing the changelog, not the version number:
rename `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD`, open a fresh empty
`Unreleased` above it, and update the link definitions at the bottom of the
file. Leave `version` in `package.json` alone — `npm version` owns it, and
setting it by hand makes the release skip a number.

Which part to bump is decided by what the change does to the two public
surfaces: what the package exports, and the scope names. Renaming a scope breaks
every theme that targets it, so it is a major change even though no code fails.
