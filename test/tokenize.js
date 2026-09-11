'use strict';

const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const GRAMMAR_PATH = path.resolve(__dirname, '..', 'modx.tmLanguage.json');
const SCOPE_NAME = 'text.html.modx';

let registryPromise = null;

function getRegistry() {
  if (registryPromise === null) {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    const onigLib = oniguruma.loadWASM(wasm).then(() => ({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (str) => new oniguruma.OnigString(str),
    }));

    registryPromise = Promise.resolve(
      new vsctm.Registry({
        onigLib,
        loadGrammar: async (scopeName) => {
          if (scopeName !== SCOPE_NAME) {
            // text.html.basic не публикуется отдельным пакетом, поэтому
            // вложенная HTML-грамматика в тестах не разрешается. Проверяем
            // только собственные правила: всё, что грамматика делегирует в
            // text.html.basic, остаётся неразмеченным.
            return null;
          }
          const raw = fs.readFileSync(GRAMMAR_PATH, 'utf8');
          return vsctm.parseRawGrammar(raw, GRAMMAR_PATH);
        },
      })
    );
  }
  return registryPromise;
}

/**
 * Разбивает текст на строки и токенизирует их грамматикой MODX.
 * Возвращает массив строк вида { line, tokens: [{ text, scopes }] }.
 */
async function tokenize(source) {
  const registry = await getRegistry();
  const grammar = await registry.loadGrammar(SCOPE_NAME);
  if (!grammar) {
    throw new Error('Не удалось загрузить грамматику ' + SCOPE_NAME);
  }

  const lines = source.replace(/\n$/, '').split(/\r?\n/);
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

/** Человекочитаемый снапшот: его диff в PR должен быть осмысленным. */
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

/** Все scope у всех токенов строки, сплющенные в один список. */
function scopesOf(tokenized) {
  return tokenized.flatMap((entry) => entry.tokens.flatMap((token) => token.scopes));
}

/** Токены, у которых есть scope, начинающийся с префикса. */
function tokensWithScope(tokenized, prefix) {
  return tokenized
    .flatMap((entry) => entry.tokens)
    .filter((token) => token.scopes.some((scope) => scope === prefix || scope.startsWith(prefix + '.')));
}

module.exports = { tokenize, formatSnapshot, scopesOf, tokensWithScope, GRAMMAR_PATH, SCOPE_NAME };
