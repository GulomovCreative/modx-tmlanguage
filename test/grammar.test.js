'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { tokenize, tokensWithScope, normalizeNewlines, GRAMMAR_PATH } = require('./tokenize');
const { fixtureNames, snapshotPathFor, buildSnapshot } = require('./snapshot');

// --- Snapshots -------------------------------------------------------------
// These catch any unintended change in tokenization. After a deliberate change
// to the grammar: npm run test:update, then read the snapshot diff.

test('the fixtures still tokenize as recorded', async (t) => {
  for (const name of fixtureNames()) {
    await t.test(name, async () => {
      const snapshotPath = snapshotPathFor(name);
      assert.ok(
        fs.existsSync(snapshotPath),
        'no snapshot for ' + name + ' -- run npm run test:update'
      );
      assert.equal(
        await buildSnapshot(name),
        normalizeNewlines(fs.readFileSync(snapshotPath, 'utf8')),
        'the tokenization of ' + name + ' changed; if that was intended, npm run test:update'
      );
    });
  }
});

// --- Regressions -----------------------------------------------------------
// One test per bug that was fixed: a snapshot says that something changed,
// these say what broke.

test('digits outside a tag are not numbers', async () => {
  const tokenized = await tokenize('<div class="col-6" data-id="42">v1.2.0</div>');
  assert.deepEqual(tokensWithScope(tokenized, 'constant.numeric'), []);
});

test('numbers inside a tag are highlighted', async () => {
  const tokenized = await tokenize('[[!Snippet? &depth=2 &limit=`10`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'constant.numeric').map((token) => token.text),
    ['2', '10']
  );
});

test('a valueless property does not swallow the next one', async () => {
  const tokenized = await tokenize('[[!Snippet? &flag &other=`1`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.parameter').map((token) => token.text),
    ['flag', 'other']
  );
});

test('a comment ends at the first ]] mid-line', async () => {
  const tokenized = await tokenize('[[- comment ]] code: [[*id]]');
  const commented = tokensWithScope(tokenized, 'comment').map((token) => token.text).join('');
  assert.equal(commented, '[[- comment ]]');
  // The tag after the comment is parsed as an ordinary tag.
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.resource').map((token) => token.text),
    ['id']
  );
});

test('a nested tag neither ends the comment nor escapes it', async () => {
  const tokenized = await tokenize('[[- comment [[+ph]] more ]] tail');
  const commented = tokensWithScope(tokenized, 'comment').map((token) => token.text).join('');
  assert.equal(commented, '[[- comment [[+ph]] more ]]');
  // The injection must not reach inside a comment.
  assert.deepEqual(tokensWithScope(tokenized, 'meta.tag'), []);
});

test('a comment does not leak past its own ]]', async () => {
  const tokenized = await tokenize('[[- first ]]\nordinary text\n[[- second ]]');
  assert.equal(tokenized[1].tokens.every((token) => !token.scopes.some((s) => s.startsWith('comment'))), true);
});

// --- Element types ---------------------------------------------------------
// Every MODX element type gets a scope of its own: in a template [[*pagetitle]]
// and [[pdoResources]] are different things, and a theme has to be able to tell
// them apart. The token characters come from switch ($token) in modParser.php.

test('each element type gets its own scope', async () => {
  const cases = [
    ['[[pdoResources]]', 'entity.name.function.modx'],
    ['[[$chunk]]', 'entity.name.type.chunk.modx'],
    ['[[*pagetitle]]', 'variable.other.resource.modx'],
    ['[[+placeholder]]', 'variable.other.placeholder.modx'],
    ['[[++site_name]]', 'variable.other.setting.modx'],
    ['[[~12]]', 'constant.other.link.modx'],
    ['[[%lexicon.key]]', 'variable.other.lexicon.modx'],
  ];
  for (const [source, expected] of cases) {
    const tokenized = await tokenize(source);
    const names = tokensWithScope(tokenized, expected).map((token) => token.text);
    assert.equal(names.length, 1, source + ' -- expected exactly one token scoped ' + expected);
  }
});

test('the ! flag does not hide the element type', async () => {
  const tokenized = await tokenize('[[!$chunk]] [[!+ph]] [[!*tv]] [[!~1]] [[!%lex]]');
  assert.equal(tokensWithScope(tokenized, 'keyword.control.uncached').length, 5);
  for (const scope of [
    'entity.name.type.chunk',
    'variable.other.placeholder',
    'variable.other.resource',
    'constant.other.link',
    'variable.other.lexicon',
  ]) {
    assert.equal(tokensWithScope(tokenized, scope).length, 1, 'not found: ' + scope);
  }
});

// --- Where an unterminated construct stops ---------------------------------
// Tags, comments and timing tags had no terminator, so one forgotten closing
// bracket coloured the rest of the file. The terminator is a blank line:
// multi-line snippet calls are legal and common, so the end of a line cannot be
// used.

test('an unterminated tag does not survive a blank line', async () => {
  const tokenized = await tokenize('[[Snippet\n\nordinary text\nand more');
  const inTag = (line) => line.tokens.some((t) => t.scopes.some((s) => s.startsWith('meta.tag')));
  assert.equal(inTag(tokenized[0]), true, 'the first line should be inside the tag');
  assert.equal(inTag(tokenized[2]), false, 'text after the blank line should not be inside the tag');
  assert.equal(inTag(tokenized[3]), false);
});

test('an unterminated comment does not survive a blank line', async () => {
  const tokenized = await tokenize('[[- comment\n\n<p>markup</p>');
  const commented = tokenized[2].tokens.some((t) => t.scopes.some((s) => s.startsWith('comment')));
  assert.equal(commented, false);
});

test('an unterminated backticked value does not survive a blank line', async () => {
  // Found by the fuzz suite. Tags, comments and timing tags all carried the
  // blank-line terminator; the value inside a tag did not, so one forgotten
  // backtick coloured the rest of the file as a string.
  const tokenized = await tokenize('[[+ph:default=`x\n\nplain markup 5');
  const scoped = tokenized[2].tokens.filter((token) =>
    token.scopes.some((scope) => scope !== 'text.html.modx' && scope.endsWith('.modx'))
  );
  assert.deepEqual(scoped.map((token) => token.text), [], 'the value crossed the blank line');
});

test('a backticked value still ends at its own backtick', async () => {
  // The terminator must not cost the ordinary case its string.
  const tokenized = await tokenize('[[!Snippet? &tpl=`row`]] after');
  const value = tokensWithScope(tokenized, 'string.other').map((token) => token.text).join('');
  assert.equal(value, '`row`');
  const after = tokenized[0].tokens.filter((token) => token.text === ' after');
  assert.equal(after.length, 1, 'the text after the tag went missing');
  assert.equal(
    after[0].scopes.some((scope) => scope.startsWith('meta.tag')),
    false,
    'the tag did not end'
  );
});

test('a legal multi-line tag is not broken', async () => {
  const tokenized = await tokenize('[[!pdoResources?\n  &parents=`5`\n  &limit=`10`\n]]\nafter');
  for (const index of [0, 1, 2, 3]) {
    assert.equal(
      tokenized[index].tokens.some((t) => t.scopes.some((s) => s.startsWith('meta.tag'))),
      true,
      'line ' + (index + 1) + ' should still be inside the tag'
    );
  }
  assert.equal(
    tokenized[4].tokens.some((t) => t.scopes.some((s) => s.startsWith('meta.tag'))),
    false,
    'the tag should not continue past its close'
  );
});

// --- False positives on [[ -------------------------------------------------

test('a bare [[ does not open a tag', async () => {
  for (const source of ['a { content: "[["; }', 'var s = "[[";']) {
    const tokenized = await tokenize(source);
    assert.deepEqual(
      tokensWithScope(tokenized, 'meta.tag'),
      [],
      source + ' -- should not parse as a tag'
    );
  }
});

test('the legal shapes of a name still parse', async () => {
  // The parser trims the name, so spaces inside the brackets are allowed.
  // A name may itself be a tag -- that is a dynamic call.
  for (const source of ['[[Snippet]]', '[[ Snippet ]]', '[[[[+dynamicName]]]]', '[[$[[+chunkName]]]]']) {
    const tokenized = await tokenize(source);
    assert.ok(
      tokensWithScope(tokenized, 'meta.tag').length > 0,
      source + ' -- should still be a tag'
    );
  }
});

// --- Syntax read off the parser's source -----------------------------------
// Every case here was checked against core/src/Revolution/modParser.php.

test('a # after * belongs to the token character, not the name', async () => {
  // case '*': when the next character is '#', the parser strips it.
  const tokenized = await tokenize('[[*#pagetitle]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'support.type.field').map((token) => token.text),
    ['*#']
  );
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.resource').map((token) => token.text),
    ['pagetitle']
  );
});

test('an amp; prefix stays out of the property name', async () => {
  // parsePropertyString: if (substr($propName, 0, 4) == "amp;") -- it is stripped.
  const tokenized = await tokenize('[[!Snippet? &amp;limit=`5`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.parameter').map((token) => token.text),
    ['limit']
  );
});

test('a doubled backtick is an escape, not the end of the value', async () => {
  // parsePropertyString: str_replace("``", "`", $propValue).
  const tokenized = await tokenize('[[+ph:default=`he said ``hello`` yesterday`]]');
  assert.equal(tokensWithScope(tokenized, 'constant.character.escape').length, 2);
  // The value stays one string: exactly one opening and one closing backtick.
  assert.equal(tokensWithScope(tokenized, 'punctuation.definition.string.begin').length, 1);
  assert.equal(tokensWithScope(tokenized, 'punctuation.definition.string.end').length, 1);
});

test('a value without backticks is working syntax, not an error', async () => {
  // parsePropertyString strips backticks only when they are there, so &tpl=row
  // parses fine and must not be flagged invalid.
  const tokenized = await tokenize('[[!Snippet? &tpl=row &limit=5]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'string.unquoted').map((token) => token.text),
    ['row']
  );
  assert.deepEqual(
    tokensWithScope(tokenized, 'constant.numeric').map((token) => token.text),
    ['5']
  );
  assert.deepEqual(tokensWithScope(tokenized, 'invalid'), []);
});

test('a tag nested inside a value still parses', async () => {
  const tokenized = await tokenize('[[+ph:default=`value [[*id]] inside`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.resource').map((token) => token.text),
    ['id']
  );
});

// --- Naming conventions ----------------------------------------------------
// A scope that does not start with a root themes recognise is ignored by them:
// the token renders unstyled. These tests hold the grammar to the convention.

const TEXTMATE_ROOTS = new Set([
  'comment', 'constant', 'entity', 'invalid', 'keyword', 'markup', 'meta',
  'punctuation', 'source', 'storage', 'string', 'support', 'text', 'variable',
]);

function collectScopeNames(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectScopeNames(item, found);
    return found;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if ((key === 'name' || key === 'contentName') && typeof value === 'string') {
        found.push(value);
      } else {
        collectScopeNames(value, found);
      }
    }
  }
  return found;
}

test('every scope starts with a root themes recognise', () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  // Only the rule sections are walked: the top-level name and scopeName are
  // the grammar's own name and scope, not scopes of tokens.
  const names = collectScopeNames([grammar.patterns, grammar.repository, grammar.injections]);
  assert.ok(names.length > 0, 'no scopes found at all -- the walk is broken');
  const bad = names.filter((name) => !TEXTMATE_ROOTS.has(name.split('.')[0]));
  assert.deepEqual(bad, [], 'themes will not colour these: ' + bad.join(', '));
});

test('every scope is documented in the README', () => {
  // Without this the table in the README goes stale on the first change to the
  // grammar: a new scope simply never reaches the documentation.
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  const names = [...new Set(collectScopeNames([grammar.patterns, grammar.repository, grammar.injections]))];
  const undocumented = names.filter((name) => !readme.includes(name)).sort();
  assert.deepEqual(
    undocumented,
    [],
    'missing from the README -- add it to the Scopes section: ' + undocumented.join(', ')
  );
});

test('the file types the grammar claims are documented', () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(grammar.fileTypes.length > 0, 'fileTypes is empty -- the grammar activates on nothing');
  const undocumented = grammar.fileTypes.filter((type) => !readme.includes('`.' + type + '`'));
  assert.deepEqual(undocumented, [], 'not in the README: ' + undocumented.join(', '));
});

test('the grammar is valid JSON and index.js points at it', () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  assert.equal(grammar.scopeName, 'text.html.modx');
  const exported = require(path.resolve(__dirname, '..', 'index.js'));
  assert.equal(exported, GRAMMAR_PATH);
  assert.ok(fs.existsSync(exported));
});
