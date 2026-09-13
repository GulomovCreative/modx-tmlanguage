'use strict';

// A time budget on tokenization.
//
// These patterns run in the editor on every keystroke, once per line. A pattern
// that backtracks catastrophically does not colour anything wrongly -- it stops
// the editor, and that is the failure a user feels immediately. It is also
// invisible to every other suite here: the fixtures are short and well-formed,
// which is exactly the input that never triggers it.
//
// The budget is deliberately loose. Catastrophic backtracking is exponential:
// the cases below run in milliseconds today, and a pattern that starts
// backtracking takes seconds or minutes. A tight budget would only buy flaky
// failures on a loaded runner.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('./tokenize.js');

const BUDGET_MS = 1000;

// Inputs built to make each family of rules work as hard as it can: long
// property lists, unterminated constructs, and deep repetition of the pieces
// that appear inside a tag.
const CASES = {
  'a tag with hundreds of properties': '[[!Snippet?' + ' &p=`1`'.repeat(400) + ']]',
  'an unterminated backticked value': '[[!Snippet? &tpl=`' + 'x'.repeat(4000),
  'a chain of output modifiers': '[[+ph' + ':default=`x`'.repeat(300) + ']]',
  'deeply nested tags': '[[+ph:default=`'.repeat(60) + 'x',
  'an unterminated tag': '[[Snippet' + ' word'.repeat(800),
  'an unterminated comment': '[[- ' + 'text '.repeat(800),
  'many tags on one line': '[[*pagetitle]]'.repeat(400),
  'brackets that open nothing': '[ [ ]] [['.repeat(400),
  'doubled backticks throughout': '[[+ph:default=`' + '``'.repeat(800) + '`]]',
};

test('the tokenizer is warm before anything is measured', async () => {
  // The first call loads the grammar and the regex engine; measuring it would
  // measure the wrong thing.
  const tokenized = await tokenize('[[*pagetitle]]');
  assert.ok(tokenized.length > 0);
});

for (const [name, source] of Object.entries(CASES)) {
  test('tokenizing ' + name + ' stays within the budget', async () => {
    const started = process.hrtime.bigint();
    const tokenized = await tokenize(source);
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;

    assert.ok(tokenized.length > 0, 'nothing was tokenized');
    assert.ok(
      elapsed < BUDGET_MS,
      'took ' + elapsed.toFixed(0) + ' ms, budget is ' + BUDGET_MS + ' ms — a pattern is backtracking'
    );
  });
}
