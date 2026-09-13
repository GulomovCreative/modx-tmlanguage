'use strict';

// MODX tags inside embedded languages: HTML attribute values, <style> and
// <script>. This is the one area that could not be checked before --
// text.html.basic is not published as a package of its own. Shiki's set holds
// the same grammars VS Code uses, which is what makes the check possible.

const test = require('node:test');
const assert = require('node:assert/strict');

const { tokenize, tokensWithScope } = require('./tokenize');

const embedded = (source) => tokenize(source, { embedded: true });

/**
 * The tokens this grammar itself marked up. Matching on a scope prefix will
 * not do: HTML has meta.tag.* of its own -- meta.tag.metadata.script on the
 * <script> tag, for one -- and those match falsely. The root text.html.modx
 * does not count either: it sits on every token.
 */
function modxTokens(tokenized) {
  return tokenized
    .flatMap((line) => line.tokens)
    .filter((token) =>
      token.scopes.some((scope) => scope !== 'text.html.modx' && scope.endsWith('.modx'))
    );
}

test('the embedded grammars really do load', async () => {
  // If the HTML grammar did not resolve, the tests below would be checking
  // something other than what they claim: the markup would be plain text.
  const tokenized = await embedded('<div class="a">text</div>');
  const htmlScopes = tokenized[0].tokens.flatMap((token) => token.scopes)
    .filter((scope) => scope.endsWith('.html'));
  assert.ok(htmlScopes.length > 0, 'the HTML grammar did not load');
});

test('a tag in an HTML attribute value is highlighted', async () => {
  const tokenized = await embedded('<a href="[[~12]]" class="[[+cls]]">link</a>');
  assert.deepEqual(
    tokensWithScope(tokenized, 'constant.other.link').map((t) => t.text),
    ['12']
  );
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.placeholder').map((t) => t.text),
    ['cls']
  );
});

test('a tag inside <style> is highlighted', async () => {
  const tokenized = await embedded('<style>\n.box { color: [[++brand_color]]; }\n</style>');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.setting').map((t) => t.text),
    ['brand_color']
  );
});

test('a tag inside a string in <script> is highlighted', async () => {
  const tokenized = await embedded('<script>\nvar id = "[[*id]]";\n</script>');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.resource').map((t) => t.text),
    ['id']
  );
});

// A known limitation, not an oversight.
//
// A bare tag in JavaScript code is not highlighted: the JS grammar reads "[["
// as the start of a nested array literal and wins against the injection. Adding
// an injection targeted at source.js was tried and does not change it, and the
// limitation predates every recent change to the grammar.
//
// In practice this only affects values pasted into code unquoted
// (var n = [[+count]];). Inside strings -- much the commoner case in templates
// -- highlighting works, which the test above pins down.
//
// This test holds the boundary where it is: if the injection ever starts
// winning, it fails and that becomes known.
test('a bare tag in JavaScript code is not highlighted (known limitation)', async () => {
  const tokenized = await embedded('<script>\nvar n = [[+count]];\n</script>');
  assert.deepEqual(
    modxTokens(tokenized).map((token) => token.text),
    [],
    'the behaviour changed -- the limitation is gone, update the README and this test'
  );
  // The JS grammar is working, though: the tokens are parsed, just as an array.
  const jsScopes = tokenized[1].tokens.flatMap((t) => t.scopes).filter((s) => s.endsWith('.js'));
  assert.ok(jsScopes.length > 0, 'the JS grammar did not load -- this test is checking the wrong thing');
});
