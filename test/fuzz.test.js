'use strict';

// Generated templates, checked against the rules this grammar must not break.
//
// All three failures below are in this repository's history. Tags, comments and
// timing tags had no terminator, so one forgotten closing bracket coloured the
// rest of the file. A rule that reaches outside a tag colours markup that is not
// MODX at all. Neither shows up in a fixture, because a fixture is written by
// someone who already has the failing case in mind.
//
// The inputs come from a fixed seed, so a failure is reproducible: the seed is
// printed with the input, and FUZZ_SEED runs that exact set again.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('./tokenize.js');

const SEED = Number(process.env.FUZZ_SEED || 20260913);
const CASES = Number(process.env.FUZZ_CASES || 60);

/** mulberry32: small, seedable, and the same sequence everywhere. */
function random(state) {
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (next, list) => list[Math.floor(next() * list.length)];

// Markup with no tag in it, salted with the characters that mean something
// *inside* a tag: the token characters, the property separators, backticks and
// modifier colons. None of them may mean anything out here.
const MARKUP = [
  '<div class="a">', '</div>', '<p>', '</p>', '<br>', '<!-- html comment -->',
  'text', 'Tom &amp; Jerry', '5 &lt; 7', 'v1.2.0', '&amp;p=1', '`backtick`',
  'a:b', '*not a field', '+not a placeholder', '~12', '%lexicon', '[single]',
  '<style>a { color: red }</style>', '<script>var a = [1, 2];</script>',
];

const TAGS = [
  '[[*pagetitle]]', '[[$chunk]]', '[[+placeholder]]', '[[++site_name]]', '[[~12]]',
  '[[%lexicon.key]]', '[[!Snippet? &tpl=`row` &limit=`10`]]', '[[- a comment ]]',
  '[[+ph:default=`fallback`]]', '[[*#pagetitle]]', '[[pdoResources?&parents=`5`]]',
];

const markup = (next, words) =>
  Array.from({ length: 1 + Math.floor(next() * (words || 6)) }, () => pick(next, MARKUP)).join(' ');

const describe = (source) =>
  '\n  seed ' + SEED + ', input: ' + JSON.stringify(source.length > 300 ? source.slice(0, 300) + '…' : source);

/** The scopes this grammar assigned; the root sits on every token and says nothing. */
const ownScopes = (token) =>
  token.scopes.filter((scope) => scope !== 'text.html.modx' && scope.endsWith('.modx'));

test('markup carrying no tag is left to the host grammar', async () => {
  const next = random(SEED);

  for (let i = 0; i < CASES; i++) {
    const source = Array.from({ length: 1 + Math.floor(next() * 4) }, () => markup(next)).join('\n');
    assert.ok(!source.includes('[['), 'the generator produced a tag');

    for (const line of await tokenize(source, { embedded: true })) {
      for (const token of line.tokens) {
        assert.deepEqual(
          ownScopes(token),
          [],
          'markup with no tag in it was scoped as MODX: ' + JSON.stringify(token.text) + describe(source)
        );
      }
    }
  }
});

test('a closed tag does not colour what follows it', async () => {
  const next = random(SEED + 1);

  for (let i = 0; i < CASES; i++) {
    const tail = markup(next, 3);
    const source = markup(next, 3) + ' ' + pick(next, TAGS) + ' ' + tail;
    const [line] = await tokenize(source, { embedded: true });

    // Walk back from the end over exactly the trailing markup and require it
    // untouched by this grammar.
    let remaining = tail.length;
    for (const token of [...line.tokens].reverse()) {
      if (remaining <= 0) break;
      remaining -= token.text.length;
      assert.deepEqual(
        ownScopes(token),
        [],
        'text after a closed tag stayed inside it: ' + JSON.stringify(token.text) + describe(source)
      );
    }
  }
});

test('nothing unterminated survives a blank line', async () => {
  // The terminator is a blank line rather than the end of a line, because
  // multi-line snippet calls are legal and common. Every construct that can be
  // left open has to honour it, or one forgotten bracket colours the rest of
  // the file.
  const next = random(SEED + 2);
  const openings = ['[[Snippet', '[[- a comment', '[[!pdoResources? &parents=`5`', '[[+ph:default=`x'];

  for (let i = 0; i < CASES; i++) {
    const after = markup(next, 3);
    const source = pick(next, openings) + '\n\n' + after;
    const tokenized = await tokenize(source, { embedded: true });

    for (const token of tokenized[2].tokens) {
      assert.deepEqual(
        ownScopes(token),
        [],
        'an unterminated construct crossed the blank line: ' + JSON.stringify(token.text) + describe(source)
      );
    }
  }
});

test('any mixture tokenizes completely and without throwing', async () => {
  const next = random(SEED + 3);

  for (let i = 0; i < CASES; i++) {
    // Deliberately unbalanced: half-typed tags are what an editor sees most.
    const source = Array.from({ length: 1 + Math.floor(next() * 6) }, () =>
      pick(next, MARKUP.concat(TAGS, ['[[', ']]', '[[-', '`', '[[+', '[[!', '&p=']))
    ).join(next() < 0.3 ? '\n' : ' ');

    const tokenized = await tokenize(source, { embedded: true });
    const lines = source.split('\n');
    assert.equal(tokenized.length, lines.length, 'a line went missing' + describe(source));

    tokenized.forEach((line, index) => {
      const covered = line.tokens.map((token) => token.text).join('').replace(/\n$/, '');
      assert.equal(covered, lines[index], 'the tokens do not add up to the line' + describe(source));
    });
  }
});
