'use strict';

// The half of editor support that is not colour.
//
// A grammar says what a token is; this file says what the editor does around
// it -- which brackets pair, what the comment command inserts, what a quote
// wraps a selection in. Without it an editor treats a template as plain text
// for every one of those: no bracket matching on `[[ ]]`, and the comment
// command inserts nothing at all.
//
// The tests below are not shape checks. Each takes what the configuration
// claims and puts it through the grammar, because the two can disagree: a
// comment marker the editor inserts and the grammar does not recognise is worse
// than none, and nothing else in this repository would notice.

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, tokensWithScope } = require('./tokenize.js');

const ROOT = path.resolve(__dirname, '..');
const configuration = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'language-configuration.json'), 'utf8')
);

test('the comment the editor inserts is a comment to the grammar', async () => {
  // What VS Code writes when the comment command runs on a selection.
  const [open, close] = configuration.comments.blockComment;
  const commented = open + 'a note about [[*pagetitle]]' + close;

  const tokenized = await tokenize(commented);
  const scoped = tokensWithScope(tokenized, 'comment').map((token) => token.text).join('');

  assert.equal(scoped, commented, 'the grammar does not read the inserted comment as one');
});

test('uncommenting removes exactly what commenting added', async () => {
  // The command is its own inverse, so the markers must not be swallowed into
  // the text they wrap.
  const [open, close] = configuration.comments.blockComment;
  const text = 'plain markup';
  const commented = open + text + close;

  assert.equal(commented.slice(open.length, commented.length - close.length), text);

  const tokenized = await tokenize(commented + '\nafter');
  const after = tokenized[1].tokens.some((token) =>
    token.scopes.some((scope) => scope.startsWith('comment'))
  );
  assert.equal(after, false, 'the comment did not end where the marker did');
});

test('the tag brackets are a pair the editor can match', () => {
  const pairs = configuration.brackets.map((pair) => pair.join(''));
  assert.ok(pairs.includes('[[]]'), 'MODX tags are not listed as a bracket pair: ' + pairs.join(' '));

  const autoClosing = configuration.autoClosingPairs.find((pair) => pair.open === '[[');
  assert.ok(autoClosing, 'typing [[ does not close the tag');
  assert.equal(autoClosing.close, ']]');
});

test('the backtick is closed and can surround a selection', async () => {
  // Property values are written in backticks, and they are the one delimiter
  // here that is not already familiar from HTML.
  assert.ok(
    configuration.autoClosingPairs.some((pair) => pair.open === '`' && pair.close === '`'),
    'typing a backtick does not close it'
  );
  assert.ok(
    configuration.surroundingPairs.some(([open, close]) => open === '`' && close === '`'),
    'a backtick does not wrap a selection'
  );

  const tokenized = await tokenize('[[!Snippet? &tpl=`row`]]');
  const value = tokensWithScope(tokenized, 'string.other').map((token) => token.text).join('');
  assert.equal(value, '`row`', 'the backticked value, delimiters included, is not scoped as a string');
});

test('every pair is balanced and non-empty', () => {
  const groups = [configuration.brackets, configuration.surroundingPairs];
  for (const group of groups) {
    for (const [open, close] of group) {
      assert.ok(open.length > 0 && close.length > 0, 'an empty delimiter in ' + JSON.stringify([open, close]));
    }
  }
  for (const pair of configuration.autoClosingPairs) {
    assert.ok(pair.open && pair.close, 'an incomplete auto-closing pair: ' + JSON.stringify(pair));
  }
});
