# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Two things in this release deserve attention before upgrading: token colours
change, and the package entry point goes back to what it returned before 1.2.0.

### Fixed

- **The package entry point returns a path again.** In 1.2.0 an `exports` field
  was added pointing straight at the JSON, which silently overrode `main`:
  `require('modx-tmlanguage')` started returning the parsed grammar object
  instead of the path string it returned in 1.1.2 and earlier. Anyone doing
  `fs.readFileSync(require('modx-tmlanguage'))` broke. The path is restored,
  and the grammar object is now available at the explicit subpath
  `modx-tmlanguage/modx.tmLanguage.json`.
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

[Unreleased]: https://github.com/GulomovCreative/modx-tmlanguage/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/GulomovCreative/modx-tmlanguage/releases/tag/v1.2.0
