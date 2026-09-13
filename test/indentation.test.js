'use strict';

// Checks the indentation rules in language-configuration.json.
//
// VS Code applies the two patterns from opposite ends: increaseIndentPattern
// against the line above, to push the next one in, and decreaseIndentPattern
// against the line just typed, to pull it back out. Only one construct here
// spans lines -- a snippet call whose properties sit under it -- so the rules
// have exactly one job: indent inside `[[ … ]]` when it is written over several
// lines, and leave everything else where it is.
//
// "Everything else" is most of a template, which is why this file exists. The
// rules the extension used to carry outdented on every line containing `]]`,
// `[[*pagetitle]]` included, so typing in an ordinary template walked the text
// leftwards. A shape check would not have seen that; these run the patterns.
//
// The template below is both the fixture and the expectation: every line is
// stripped of its indentation and re-indented from scratch, and the result has
// to come back identical. A rule that drifts shows up as the line where the two
// part company.

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const configuration = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'language-configuration.json'), 'utf8')
);

const { increaseIndentPattern, decreaseIndentPattern } = configuration.indentationRules;
const increase = new RegExp(increaseIndentPattern);
const decrease = new RegExp(decreaseIndentPattern);

const INDENT = '    ';

// Correctly indented, in the style the rules are written for: a tag that opens
// a block ends the line, and the `]]` that closes it starts one. Around them the
// ordinary contents of a template -- fields, chunks, link and setting tags, a
// comment, plain markup -- and a line that closes one call and opens another.
const template = `<div class="article">
[[- The list below is the one place where indentation matters here. ]]
<h1>[[*pagetitle]]</h1>
[[!pdoResources?
    &parents=\`0\`
    &limit=\`10\`
    &tpl=\`@INLINE <li>[[+pagetitle]]</li>\`
]]
<p>[[++site_name]] — [[~1? &scheme=\`full\`]]</p>
[[!getResources?
    &where=\`[["published","=",1]]\`
]]
[[!First?
    &a=\`1\`
]] [[!Second?
    &b=\`2\`
]]
<p>[[$footer]]</p>
</div>
`;

/** Re-indents a template the way VS Code would, from a zero-indent starting point. */
function reindent(text) {
  let level = 0;
  return text.split('\n').map((line) => {
    const content = line.trim();
    if (content === '') return '';
    if (decrease.test(content)) level = Math.max(0, level - 1);
    const indented = INDENT.repeat(level) + content;
    if (increase.test(content)) level++;
    return indented;
  });
}

test('a template re-indents to exactly what it already is', () => {
  const expected = template.split('\n');
  const actual = reindent(template);

  const drifted = [];
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) drifted.push(i);
  }

  const report = drifted
    .map((i) => `  line ${i + 1}\n    expected: ${JSON.stringify(expected[i])}\n    actual:   ${JSON.stringify(actual[i])}`)
    .join('\n');

  assert.deepEqual(drifted, [], `${drifted.length} line(s) re-indent differently:\n${report}`);
});

test('the indentation returns to where it started', () => {
  // A rule that increases without a matching decrease leaves every later line
  // one level further right, which the comparison above would catch only if the
  // drift happened before the last line.
  const lines = reindent(template).filter((line) => line !== '');
  assert.equal(lines[lines.length - 1], '</div>');
});

test('a tag left open at the end of a line indents what follows', () => {
  const opens = [
    '[[!pdoResources?',
    '[[$chunk?',
    '<div class="list">[[!Snippet?',
    '[[!Snippet? &tpl=`@INLINE <li>[[+id]]</li>`',
    ']] [[!Another?',
  ];
  for (const line of opens) {
    assert.ok(increase.test(line), `should open a block, but does not: ${line}`);
  }
});

test('a line that closes a tag it did not open is pulled back out', () => {
  const closes = [
    ']]',
    '    ]]',
    ']] and some markup',
    '    &tpl=`row`]]',
    '    &where=`[["published","=",1]]`]]',
  ];
  for (const line of closes) {
    assert.ok(decrease.test(line), `should close a block, but does not: ${line}`);
  }
});

test('a closing `]]` on the same line as the last property outdents that line', () => {
  // The one place the rules are visibly imperfect, and deliberately so. Writing
  //
  //   [[!getResources?
  //       &tpl=`row`]]
  //
  // puts the closer on a property line, and the rules pull that line back out
  // with it. The alternative -- only treating a line that *starts* with `]]` as
  // a close -- leaves the block open instead, and then every line for the rest
  // of the file sits one level too far right. A single misplaced line beats
  // indentation that never comes back.
  assert.ok(decrease.test('    &tpl=`row`]]'));
  assert.equal(increase.test('    &tpl=`row`]]'), false, 'the block must still close');
});

test('the tags a template is mostly made of move nothing', () => {
  // This is the case the rules the extension carried got wrong: every one of
  // these contains `]]`, and every one of them outdented the line it was on.
  const inert = [
    '[[*pagetitle]]',
    '<h1>[[*longtitle]]</h1>',
    '[[++site_name]]',
    '[[~1? &scheme=`full`]]',
    '[[$footer]]',
    '[[$chunk? &a=`1` &b=`2`]]',
    '[[!Snippet? &tpl=`row`]]',
    '[[+placeholder]]',
    '[[%lexicon_key]]',
    '[[a]] and text after it',
    '<p>plain markup</p>',
    '',
  ];

  const misread = inert.filter((line) => increase.test(line) || decrease.test(line));
  assert.deepEqual(misread, [], `these lines are not blocks but change the indentation: ${misread.join(' | ')}`);
});

test('a comment is not an open tag', () => {
  // `[[- … ]]` closing on its own line would be inert anyway. One left open is
  // the case worth pinning: a comment is prose, and indenting prose under it
  // would be wrong even though the brackets are unbalanced.
  const [open] = configuration.comments.blockComment;
  assert.equal(increase.test(open + 'a note about the list'), false);
  assert.equal(increase.test('[[- a note ]]'), false);
  assert.equal(decrease.test('[[- a note ]]'), false);
});

test('`]]` inside a backticked value is neither an opening nor a closing', () => {
  // Property values are arbitrary text, and JSON conditions in them end in `]]`
  // often enough for this to be the difference between usable and not.
  const values = [
    '&tpl=`x]]y`',
    '&where=`[["published","=",1]]`',
    '[[$chunk? &html=`<b>]]</b>`]]',
    '    &tpl=`@INLINE <li>[[+pagetitle]]</li>`',
  ];
  for (const line of values) {
    assert.equal(increase.test(line), false, `wrongly opens a block: ${line}`);
    assert.equal(decrease.test(line), false, `wrongly closes a block: ${line}`);
  }
});

test('neither pattern backtracks catastrophically', () => {
  // The patterns run on every keystroke, on the line being typed. An unclosed
  // backtick is the shape that makes the alternation retry from every position,
  // so it is the one to hold to a budget.
  const lines = [
    '[[' + 'a'.repeat(8000) + '`',
    '[[!S? &tpl=`' + 'b'.repeat(8000),
    '[['.repeat(4000),
    ']]'.repeat(4000),
  ];

  const started = Date.now();
  for (const line of lines) {
    increase.test(line);
    decrease.test(line);
  }
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 200, `the patterns took ${elapsed}ms on pathological lines`);
});
