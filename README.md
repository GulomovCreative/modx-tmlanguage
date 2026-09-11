# modx-tmlanguage

This repository contains TmLanguage files that can be consumed by [MODX Revolution](https://docs.modx.com/3.x/en/building-sites/tag-syntax) editors and plugins such as [Visual Studio Code](https://github.com/Microsoft/vscode), [Sublime Text](https://www.sublimetext.com), [Atom](https://atom.io), and possibly others.

## Installation
``` sh
npm install modx-tmlanguage
```

## Usage

The package entry point resolves to the absolute path of the grammar file, so
an editor integration can hand it straight to whatever loads TextMate grammars:

``` js
const grammarPath = require('modx-tmlanguage');
// or: import grammarPath from 'modx-tmlanguage';
```

The grammar itself is also exported, for when the parsed object is what you
need rather than a path:

``` js
const grammar = require('modx-tmlanguage/modx.tmLanguage.json');
grammar.scopeName; // "text.html.modx"
```

## File types

The grammar claims `.tpl`, `.html` and `.htm`. MODX itself puts no constraint
on how template and chunk files are named, so a project that stores elements
under other extensions needs to say so in the editor rather than wait for the
grammar to guess. In VS Code that is a `files.associations` entry:

``` json
{
  "files.associations": {
    "*.chunk": "modx",
    "*.modx": "modx"
  }
}
```

The value is the language id the grammar is registered under by whatever
extension packages it — `modx` above is an example, not a promise.

## Scopes

The grammar's own scope is `text.html.modx`. It includes `text.html.basic`
for the surrounding markup and injects itself into that markup, so MODX tags
are recognised wherever they appear — except inside MODX comments, where the
injection is deliberately switched off.

Every scope below ends in `.modx`, so a theme can target the whole language
with one selector, or any individual construct with a longer one. Scopes are
listed with the element or character they apply to.

### Element tags

Each element type carries its own scope, so a theme can colour a chunk
differently from a resource field. The token characters follow
`switch ($token)` in MODX's own `modParser`.

| Tag | Whole tag | Token character | Name |
|---|---|---|---|
| `[[Snippet]]` | `meta.tag.snippet.modx` | — | `entity.name.function.modx` |
| `[[$chunk]]` | `meta.tag.chunk.modx` | `support.type.chunk.modx` | `entity.name.type.chunk.modx` |
| `[[*pagetitle]]` | `meta.tag.field.modx` | `support.type.field.modx` | `variable.other.resource.modx` |
| `[[+placeholder]]` | `meta.tag.placeholder.modx` | `support.type.placeholder.modx` | `variable.other.placeholder.modx` |
| `[[++site_name]]` | `meta.tag.setting.modx` | `support.type.setting.modx` | `variable.other.setting.modx` |
| `[[~12]]` | `meta.tag.link.modx` | `support.type.link.modx` | `constant.other.link.modx` |
| `[[%lexicon.key]]` | `meta.tag.lexicon.modx` | `support.type.lexicon.modx` | `variable.other.lexicon.modx` |

A snippet has no token character, which is why that cell is empty — it is the
fallback, matching MODX's own `default` branch.

Common to every tag:

| Part | Scope |
|---|---|
| `[[` | `punctuation.definition.tag.begin.modx` |
| `]]` | `punctuation.definition.tag.end.modx` |
| `!` (uncached) | `keyword.control.uncached.modx` |

The `#` in `[[*#pagetitle]]` is part of the token character and shares
`support.type.field.modx`, mirroring the parser, which strips it from the name.

### Inside a tag

| Part | Scope |
|---|---|
| `@` in `@propertySet` | `punctuation.definition.propertyset.modx` |
| property set name | `entity.name.type.propertyset.modx` |
| `?` before properties | `punctuation.separator.properties.modx` |
| `&` (and an `amp;` prefix) | `punctuation.definition.parameter.modx` |
| property name | `variable.parameter.modx` |
| `=` | `keyword.operator.assignment.modx` |
| value in backticks | `string.other.modx` |
| opening backtick | `punctuation.definition.string.begin.modx` |
| closing backtick | `punctuation.definition.string.end.modx` |
| `` `` `` inside a value (an escaped backtick) | `constant.character.escape.modx` |
| value written without backticks | `string.unquoted.modx` |
| `:` before an output modifier | `punctuation.separator.modifier.modx` |
| output modifier name | `support.function.modifier.modx` |
| number | `constant.numeric.modx` |

Numbers are scoped only inside tags. A digit in ordinary markup is left alone.

Values written without backticks get a scope of their own rather than being
flagged as an error: MODX strips backticks only when they are present, so
`&tpl=row` parses fine, even though wrapping values in backticks is the
convention.

### Comments and timing tags

| Part | Scope |
|---|---|
| `[[- comment ]]` | `comment.block.modx` |
| `[[-` | `punctuation.definition.comment.begin.modx` |
| closing `]]` | `punctuation.definition.comment.end.modx` |
| `[^t^]` | `meta.tag.timing.modx` |
| the letters between `[^` and `^]` | `constant.other.timing.modx` |

A tag written inside a comment stays comment-coloured rather than looking
active, and nested tags do not end the comment early.


## Development

Install dependencies and run the test suite:

``` sh
npm install
npm test
```

The suite tokenizes fixtures from `test/fixtures/` with the same engine VS Code
uses (`vscode-textmate` + `vscode-oniguruma`) and compares the result against
committed snapshots in `test/snapshots/`. Alongside the snapshots it asserts a
few specific behaviours — numbers highlighting only inside tags, comments
closing at the first `]]`, and every scope name starting with a root that
editor themes recognise.

One of those checks compares the grammar against the Scopes section above: a
scope the grammar emits but the table does not mention fails the suite. Adding
a scope therefore means documenting it in the same change.

After an intentional grammar change, regenerate the snapshots and review the
diff before committing:

``` sh
npm run test:update
```

Note that `text.html.basic` is not published as a standalone package, so the
embedded HTML grammar is not resolved in tests; only this grammar's own rules
are covered.
