'use strict';

// The committed previews, and what they are evidence of.
//
// The first test is the ordinary snapshot check: the SVGs in docs/ are what the
// current grammar and themes produce. The second is the reason they exist -- a
// scope can pass every other check here and still be invisible, because no
// theme targets it. Colour is the only thing that shows that, and it is what
// the reader of the README is looking at.

const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderAll, THEMES, svgPathFor, SAMPLE_PATH } = require('../scripts/theme-preview.js');
const { tokenize } = require('./tokenize.js');

let rendered;

test.before(async () => {
  rendered = await renderAll();
});

test('the committed previews match what the grammar renders now', () => {
  for (const theme of THEMES) {
    const file = svgPathFor(theme);
    assert.ok(fs.existsSync(file), 'docs/preview-' + theme + '.svg is missing — run npm run preview:update');
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      rendered[theme],
      'the preview for ' + theme + ' is out of date. If the change is intended, run npm run preview:update ' +
        'and read the diff — it is the colour of every token in the sample'
    );
  }
});

test('the themes give the grammar more than one colour', () => {
  for (const theme of THEMES) {
    const fills = new Set(rendered[theme].match(/fill="[^"]+"/g));
    // One of them is the background. Fewer than five on top of it would mean
    // the tags render as undifferentiated text, whatever the scope names say.
    assert.ok(
      fills.size >= 6,
      theme + ' rendered ' + fills.size + ' distinct colours — the scopes are not being styled'
    );
  }
});

test('the sample exercises a broad part of the grammar', async () => {
  // A preview of two constructs would pass the checks above and show nothing.
  const scopes = new Set();
  for (const line of await tokenize(fs.readFileSync(SAMPLE_PATH, 'utf8'))) {
    for (const token of line.tokens) {
      for (const scope of token.scopes) {
        if (scope !== 'text.html.modx' && scope.endsWith('.modx')) scopes.add(scope);
      }
    }
  }

  assert.ok(
    scopes.size >= 12,
    'the sample only reaches ' + scopes.size + ' scopes: ' + [...scopes].sort().join(', ')
  );
});
