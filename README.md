# modx-tmlanguage

This repository contains TmLanguage files that can be consumed by [MODX Revolution](https://docs.modx.com/3.x/en/building-sites/tag-syntax) editors and plugins such as [Visual Studio Code](https://github.com/Microsoft/vscode), [Sublime Text](https://www.sublimetext.com), [Atom](https://atom.io), and possibly others.

## Installation
``` sh
npm install modx-tmlanguage
```

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

After an intentional grammar change, regenerate the snapshots and review the
diff before committing:

``` sh
npm run test:update
```

Note that `text.html.basic` is not published as a standalone package, so the
embedded HTML grammar is not resolved in tests; only this grammar's own rules
are covered.
