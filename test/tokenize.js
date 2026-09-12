'use strict';

const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const GRAMMAR_PATH = path.resolve(__dirname, '..', 'modx.tmLanguage.json');
const SCOPE_NAME = 'text.html.modx';

// The HTML, JS and CSS grammars are not published separately, but Shiki's set
// is the same grammars VS Code uses. They are what makes it possible to check
// MODX tags inside <script>, <style> and HTML attribute values: without them
// text.html.basic does not resolve and the whole embedded area goes
// unchecked.
let embeddedPromise = null;

function getEmbeddedGrammars() {
  if (embeddedPromise === null) {
    embeddedPromise = import('@shikijs/langs/html').then((module) => {
      const bundle = module.default;
      return new Map(bundle.map((grammar) => [grammar.scopeName, grammar]));
    });
  }
  return embeddedPromise;
}

const registries = new Map();

function getRegistry(withEmbedded) {
  if (!registries.has(withEmbedded)) {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    const onigLib = oniguruma.loadWASM(wasm).then(() => ({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (str) => new oniguruma.OnigString(str),
    }));

    registries.set(
      withEmbedded,
      new vsctm.Registry({
        onigLib,
        loadGrammar: async (scopeName) => {
          if (scopeName === SCOPE_NAME) {
            const raw = fs.readFileSync(GRAMMAR_PATH, 'utf8');
            return vsctm.parseRawGrammar(raw, GRAMMAR_PATH);
          }
          if (!withEmbedded) {
            // By default the embedded grammars are left out: the snapshots
            // then describe this grammar's own rules only, and do not depend
            // on the version of somebody else's HTML grammar.
            return null;
          }
          const embedded = await getEmbeddedGrammars();
          return embedded.get(scopeName) ?? null;
        },
      })
    );
  }
  return registries.get(withEmbedded);
}

/**
 * Splits text into lines and tokenizes them with the MODX grammar.
 * Returns an array of lines shaped { line, tokens: [{ text, scopes }] }.
 */
async function tokenize(source, { embedded = false } = {}) {
  const registry = getRegistry(embedded);
  const grammar = await registry.loadGrammar(SCOPE_NAME);
  if (!grammar) {
    throw new Error('Could not load the grammar ' + SCOPE_NAME);
  }

  // Normalizing line endings is not optional: on Windows git hands out files
  // with CRLF by default, and naively stripping only \n would leave the \r at
  // the end of the last line, where it would show up as a character of text.
  const lines = normalizeNewlines(source).replace(/\n$/, '').split('\n');
  const result = [];
  let ruleStack = vsctm.INITIAL;

  for (const line of lines) {
    const parsed = grammar.tokenizeLine(line, ruleStack);
    result.push({
      line,
      tokens: parsed.tokens.map((token) => ({
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      })),
    });
    ruleStack = parsed.ruleStack;
  }

  return result;
}

/**
 * CRLF -> LF. Snapshots are stored and compared in one form, whatever the
 * developer's system and git are configured to do with line endings.
 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
}

/** A human-readable snapshot: its diff in a pull request has to mean something. */
function formatSnapshot(tokenized) {
  const out = [];
  tokenized.forEach((entry, index) => {
    out.push('line ' + (index + 1) + ': ' + JSON.stringify(entry.line));
    for (const token of entry.tokens) {
      out.push('  ' + JSON.stringify(token.text).padEnd(28) + ' ' + token.scopes.join(' '));
    }
  });
  return out.join('\n') + '\n';
}

/** Every scope of every token on the line, flattened into one list. */
function scopesOf(tokenized) {
  return tokenized.flatMap((entry) => entry.tokens.flatMap((token) => token.scopes));
}

/** The tokens carrying a scope that starts with the given prefix. */
function tokensWithScope(tokenized, prefix) {
  return tokenized
    .flatMap((entry) => entry.tokens)
    .filter((token) => token.scopes.some((scope) => scope === prefix || scope.startsWith(prefix + '.')));
}

module.exports = { tokenize, formatSnapshot, normalizeNewlines, scopesOf, tokensWithScope, GRAMMAR_PATH, SCOPE_NAME };
