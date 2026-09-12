'use strict';

const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const GRAMMAR_PATH = path.resolve(__dirname, '..', 'modx.tmLanguage.json');
const SCOPE_NAME = 'text.html.modx';

// Грамматики HTML, JS и CSS не публикуются по отдельности, но набор Shiki —
// это те же грамматики, что использует VS Code. Благодаря им проверяется
// поведение MODX-тегов внутри <script>, <style> и значений HTML-атрибутов:
// без них грамматика text.html.basic не разрешается и вся вложенная область
// остаётся непроверенной.
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
            // По умолчанию вложенные грамматики не подключаются: снапшоты
            // тогда описывают только собственные правила и не зависят от
            // версии чужой грамматики HTML.
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
 * Разбивает текст на строки и токенизирует их грамматикой MODX.
 * Возвращает массив строк вида { line, tokens: [{ text, scopes }] }.
 */
async function tokenize(source, { embedded = false } = {}) {
  const registry = getRegistry(embedded);
  const grammar = await registry.loadGrammar(SCOPE_NAME);
  if (!grammar) {
    throw new Error('Не удалось загрузить грамматику ' + SCOPE_NAME);
  }

  // Приведение переводов строк обязательно: на Windows git по умолчанию
  // выдаёт файлы с CRLF, и наивное срезание только \n оставляло бы \r в
  // конце последней строки — она попадала бы в разметку как символ текста.
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
 * CRLF -> LF. Снапшоты хранятся и сравниваются в одном виде независимо от
 * того, как система разработчика и git настроены переводить строки.
 */
function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
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

module.exports = { tokenize, formatSnapshot, normalizeNewlines, scopesOf, tokensWithScope, GRAMMAR_PATH, SCOPE_NAME };
