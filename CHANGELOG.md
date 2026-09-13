# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Indentation rules in the language configuration. A snippet call written over
  several lines now indents its properties, and the `]]` that closes it comes
  back out level with the tag that opened it. Everything else in a template is
  left where it is.

  This completes the move of editor support out of the extension and into the
  package, and it is a change extensions should notice: the rules the extension
  carried before `2.0.2` were

  ``` json
  "increaseIndentPattern": "\\[\\[[^\\]\\]]*$",
  "decreaseIndentPattern": "[^\\[\\[]*\\]\\]"
  ```

  and the second one outdented *any* line containing `]]` — `[[*pagetitle]]`,
  `[[- a comment ]]`, a value such as `` &tpl=`x]]y` `` — because it was not
  anchored to the start of the line. In a template with a field tag on every
  other line, typing walked the text leftwards. (`[^\]\]]` was also just
  `[^\]]`: doubling inside a character class means nothing.) The rules shipped
  here are anchored, ignore `]]` inside backticked values, and do not treat
  `[[- … ]]` as an opening. A new test suite re-indents a template from scratch
  and requires it to come back unchanged.

- A guard that every file in the published archive uses LF. Nothing is wrong
  today — `2.0.2` unpacks with LF throughout, and `.gitattributes` already pins
  the checkout — but the sibling Fenom grammar published CRLF from commits that
  never contained it, and the release is cut from the same machine by the same
  command. This is the check that the pinning held. It packs the package and
  reads the bytes in the archive rather than in the working tree — the working
  tree is what is being guarded, and `npm pack` packs it verbatim — and it runs
  before every publish, where the fault can actually occur.

### Changed

- Folding markers stay as they are: `#region` / `#endregion` in HTML comments.
  The extension used to fold on `^\s*\[\[` / `^\s*\]\]` instead, and those
  are not coming back. VS Code's marker folding is line-based — a line is either
  a start or an end, never both — so a one-line tag such as `[[*pagetitle]]`
  would open a region that never closes and swallow the next `]]` it found. The
  same reasoning was applied in the sibling Fenom grammar.

## [2.0.2] — 2026-09-13

### Added

- A language configuration, published alongside the grammar. It is the half of
  editor support that is not colour: `[[` pairs with `]]` for bracket matching
  and selection, the comment command writes `[[- … ]]`, and backticks and quotes
  close as you type. Reachable as
  `@gulomov/modx-tmlanguage/language-configuration.json`; the grammar alone is
  unchanged, so nothing already using it is affected.
- The README shows what the grammar looks like. The images in `docs/` are
  generated from a sample template through GitHub's light and dark themes, and a
  test fails when they drift. They are also the only check here that can see a
  scope no theme colours — the naming and README checks confirm a scope is
  well-formed and documented, not that anything styles it.
- A time budget on tokenization, over deliberately awkward input. These patterns
  run in the editor on every keystroke; one that backtracks catastrophically
  stops the editor rather than colouring anything wrongly.
- Fuzz checks over generated templates, holding three rules: markup carrying no
  tag stays with the host grammar, a closed tag does not colour what follows it,
  and nothing unterminated survives a blank line.

### Fixed

- An unterminated property value no longer colours the rest of the file. Tags,
  comments and timing tags all stopped at a blank line; the backticked value
  inside a tag did not, so a single forgotten backtick left everything after it
  scoped as a string — markup, other tags and all. Found by the new fuzz checks
  on their first run.

## [2.0.1] — 2026-09-13

### Changed

- Releases are published by GitHub Actions from the pushed tag, not from a
  maintainer's machine. Packages published this way carry npm
  [provenance](https://docs.npmjs.com/generating-provenance-statements): the
  package page states which repository, workflow and commit built the tarball,
  and npm verifies that statement itself. Nothing changes in how the package is
  installed or used.
- Every release now gets a GitHub release with the changelog section for that
  version as its body. Previously tags were pushed without one.

### Internal

- Comments, test names and CI step names are in English throughout. The
  repository had two languages in it depending on which file you opened; the
  documentation was already English, and now the code that explains itself is
  too. No behaviour changed — but the CI job names did, so branch protection
  rules naming the old ones need updating.

## [2.0.0] — 2026-09-12

A major release for three independent reasons: the package moved to a scoped
name, scope names in the grammar changed, and the package entry point changed.

### Migration

**The package is now published as `@gulomov/modx-tmlanguage`.** The unscoped
`modx-tmlanguage` is deprecated and will receive no further releases. Installs
of the old name keep working — nothing was unpublished — but they stay on 1.2.0.

``` sh
npm uninstall modx-tmlanguage
npm install @gulomov/modx-tmlanguage
```

**What the entry point returns.** On 1.1.2 or earlier, nothing changes —
`require(...)` returns the path to the grammar file, as it always did. On 1.2.0
it returned the parsed grammar object instead; that was an accident, and the
object now lives at an explicit subpath:

``` js
// 1.2.0 only
const grammar = require('modx-tmlanguage');
// 2.0.0
const grammar = require('@gulomov/modx-tmlanguage/modx.tmLanguage.json');
```

**If you wrote a theme against these scopes.** Several were renamed because they
did not start with a root that editors recognise, and element types were split
apart. `modifier.modx` became `support.function.modifier.modx`;
`entity.name.modx` became `entity.name.type.propertyset.modx`; and the single
`entity.name.function.modx` that covered every element type is now seven
distinct scopes. The README's Scopes section lists all 42.

### Changed

- The package description and keywords were rewritten. The old description
  named Atom, which was discontinued two months before this repository was
  created, and described the package as a set of files rather than one grammar.

- **The package is published under the `@gulomov` scope.** The unscoped name is
  deprecated. `publishConfig.access` is set to `public`, because npm publishes
  scoped packages privately by default.

### Fixed

- **The package entry point returns a path again.** In 1.2.0 an `exports` field
  was added pointing straight at the JSON, which silently overrode `main`:
  `require(...)` started returning the parsed grammar object
  instead of the path string it returned in 1.1.2 and earlier. Anyone doing
  `fs.readFileSync(require(...))` broke. The path is restored,
  and the grammar object is now available at the explicit subpath
  `@gulomov/modx-tmlanguage/modx.tmLanguage.json`.
- **ESM import works.** It never did: importing JSON requires a type attribute,
  so `import` failed with `ERR_IMPORT_ATTRIBUTE_MISSING` — including in 1.2.0,
  whose whole point was to add ESM support.
- Scope names that no theme recognised. `modifier.modx`, `entity.name.modx` and
  several others did not start with a root that editors know, so those tokens
  rendered unstyled. Output modifiers were the most visible casualty.
- A property with no value swallowed the markup after it. `&flag &other=\`1\``
  was read as a single property name, and with no `=` ahead the highlighting ran
  on to the next one in the file.
- Numbers were highlighted in ordinary markup: `<div class="col-6" data-id="42">`
  coloured `6`, `42` and the digits of a version string.
- Comments did not close mid-line. `[[- note ]] markup` coloured the rest of the
  line, and an unclosed comment ran to the end of the file.
- A tag inside a comment was highlighted as though it were live code.
- Unterminated tags, comments and timing tags no longer colour the rest of the
  file; they now stop at a blank line.
- A bare `[[` inside a JavaScript or CSS string no longer opens a tag.
- `[[*#fieldname]]`, `&amp;` before a property name, and a doubled backtick as
  an escape inside a value — all three are accepted by MODX and were not
  recognised here.

### Added

- **A distinct scope for each element type.** Snippets, chunks, resource fields,
  placeholders, system settings, links and lexicons had all shared
  `entity.name.function.modx`; they are now separate, so a theme can colour
  `[[*pagetitle]]` differently from `[[pdoResources]]`. **This changes colours
  for existing users** — see the Scopes section of the README for the full list.
- Tests covering MODX tags inside embedded languages — HTML attribute values,
  `<style>`, and `<script>` — by loading the HTML, CSS and JavaScript grammars
  from Shiki. This area had never been tested. The README now documents what
  works there, including one limitation: a bare tag in JavaScript code is not
  highlighted, because the JavaScript grammar reads `[[` as a nested array
  literal.
- A Scopes section in the README documenting all 42 scopes, with a test that
  fails if the grammar emits one the README does not mention.
- A test suite: snapshots of tokenized fixtures, behaviour tests, and
  consistency checks. CI runs it on Node 20, 22 and 24.
- `.htm` as a recognised file extension, and documentation of how to associate
  others.
- `CONTRIBUTING.md`, issue and pull request templates.
- `bugs`, `homepage` and `engines` in the package manifest; `repository.url` in
  the form npm expects.

### Changed

- The copyright holder in `LICENSE` is now the package author. The file had
  named an unrelated company since the first commit, with a year predating the
  repository.
- Values written without backticks (`&tpl=row`) are now scoped as unquoted
  strings rather than left unstyled. MODX accepts them: the parser strips
  backticks only when they are present.
- Releasing is guarded. `npm version` now refuses to run from a branch other
  than `master`, with a dirty working tree, or behind the remote — previously
  a release would have published whatever was checked out.

## [1.2.0] — 2024

### Added

- An `exports` field intended to enable ESM imports. It did not work, and broke
  `require()` — see Unreleased above.

### Fixed

- The regular expression matching numbers.

## [1.1.2]

### Fixed

- The numeric matcher.

## [1.1.1]

### Changed

- `scopeName` changed to `text.html.modx`.

## [1.1.0]

### Changed

- Reworked highlighting.

## [1.0.0]

- First public release.

[Unreleased]: https://github.com/GulomovCreative/modx-tmlanguage/compare/v2.0.2...HEAD
[2.0.2]: https://github.com/GulomovCreative/modx-tmlanguage/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/GulomovCreative/modx-tmlanguage/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/GulomovCreative/modx-tmlanguage/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/GulomovCreative/modx-tmlanguage/releases/tag/v1.2.0
