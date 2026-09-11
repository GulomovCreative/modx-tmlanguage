'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { tokenize, tokensWithScope, GRAMMAR_PATH } = require('./tokenize');
const { fixtureNames, snapshotPathFor, buildSnapshot } = require('./snapshot');

// --- Снапшоты -------------------------------------------------------------
// Ловят любое непреднамеренное изменение разметки. При осознанной правке
// грамматики: npm run test:update, затем глазами проверить диff снапшотов.

test('снапшоты фикстур совпадают', async (t) => {
  for (const name of fixtureNames()) {
    await t.test(name, async () => {
      const snapshotPath = snapshotPathFor(name);
      assert.ok(
        fs.existsSync(snapshotPath),
        'нет снапшота для ' + name + ' — запустите npm run test:update'
      );
      assert.equal(
        await buildSnapshot(name),
        fs.readFileSync(snapshotPath, 'utf8'),
        'разметка ' + name + ' изменилась; если намеренно — npm run test:update'
      );
    });
  }
});

// --- Регрессии ------------------------------------------------------------
// По одному тесту на каждый исправленный баг: снапшот покажет, что что-то
// поменялось, а эти тесты — что именно сломалось.

test('числа вне тегов не считаются числами', async () => {
  const tokenized = await tokenize('<div class="col-6" data-id="42">v1.2.0</div>');
  assert.deepEqual(tokensWithScope(tokenized, 'constant.numeric'), []);
});

test('числа внутри тегов подсвечиваются', async () => {
  const tokenized = await tokenize('[[!Snippet? &depth=2 &limit=`10`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'constant.numeric').map((token) => token.text),
    ['2', '10']
  );
});

test('параметр без значения не съедает следующий', async () => {
  const tokenized = await tokenize('[[!Snippet? &flag &other=`1`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.parameter').map((token) => token.text),
    ['flag', 'other']
  );
});

test('комментарий закрывается на первом ]] в середине строки', async () => {
  const tokenized = await tokenize('[[- коммент ]] код: [[*id]]');
  const commented = tokensWithScope(tokenized, 'comment').map((token) => token.text).join('');
  assert.equal(commented, '[[- коммент ]]');
  // Тег после комментария разбирается как обычный тег.
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.resource').map((token) => token.text),
    ['id']
  );
});

test('вложенный тег не закрывает комментарий и остаётся комментарием', async () => {
  const tokenized = await tokenize('[[- коммент [[+ph]] ещё ]] хвост');
  const commented = tokensWithScope(tokenized, 'comment').map((token) => token.text).join('');
  assert.equal(commented, '[[- коммент [[+ph]] ещё ]]');
  // Инъекция не должна пробивать внутрь комментария.
  assert.deepEqual(tokensWithScope(tokenized, 'meta.tag'), []);
});

test('незакрытый комментарий не течёт за пределы своего ]]', async () => {
  const tokenized = await tokenize('[[- первый ]]\nобычный текст\n[[- второй ]]');
  assert.equal(tokenized[1].tokens.every((token) => !token.scopes.some((s) => s.startsWith('comment'))), true);
});

// --- Типы элементов -------------------------------------------------------
// Каждый тип тега MODX должен получать свой scope: в шаблоне [[*pagetitle]] и
// [[pdoResources]] — разные сущности, темы должны уметь их различать.
// Символы типов взяты из switch ($token) в modParser.php.

test('каждый тип элемента получает свой scope', async () => {
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
    assert.equal(names.length, 1, source + ' — ожидался ровно один токен со scope ' + expected);
  }
});

test('флаг ! не мешает определить тип элемента', async () => {
  const tokenized = await tokenize('[[!$chunk]] [[!+ph]] [[!*tv]] [[!~1]] [[!%lex]]');
  assert.equal(tokensWithScope(tokenized, 'keyword.control.uncached').length, 5);
  for (const scope of [
    'entity.name.type.chunk',
    'variable.other.placeholder',
    'variable.other.resource',
    'constant.other.link',
    'variable.other.lexicon',
  ]) {
    assert.equal(tokensWithScope(tokenized, scope).length, 1, 'не найден ' + scope);
  }
});

// --- Конвенции именования -------------------------------------------------
// Scope, не начинающийся с распознаваемого корня, темами игнорируется:
// токен остаётся неподсвеченным. Тест держит грамматику в конвенциях.

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

test('все scope начинаются с корня, известного темам', () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  // Смотрим только секции с правилами: верхнеуровневые name и scopeName —
  // это имя грамматики и её собственный scope, а не scope токенов.
  const names = collectScopeNames([grammar.patterns, grammar.repository, grammar.injections]);
  assert.ok(names.length > 0, 'ни одного scope не найдено — обход сломан');
  const bad = names.filter((name) => !TEXTMATE_ROOTS.has(name.split('.')[0]));
  assert.deepEqual(bad, [], 'эти scope темы не подсветят: ' + bad.join(', '));
});

test('грамматика — валидный JSON и index.js указывает на неё', () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  assert.equal(grammar.scopeName, 'text.html.modx');
  const exported = require(path.resolve(__dirname, '..', 'index.js'));
  assert.equal(exported, GRAMMAR_PATH);
  assert.ok(fs.existsSync(exported));
});
