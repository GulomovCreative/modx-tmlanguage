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

// --- Границы незакрытых конструкций ---------------------------------------
// У тегов, комментариев и timing-тегов не было ограничителя, поэтому одна
// забытая закрывающая скобка красила весь остаток файла. Ограничитель —
// пустая строка: многострочные вызовы сниппетов законны и распространены,
// поэтому привязать к концу строки нельзя.

test('незакрытый тег не переживает пустую строку', async () => {
  const tokenized = await tokenize('[[Snippet\n\nобычный текст\nи ещё');
  const inTag = (line) => line.tokens.some((t) => t.scopes.some((s) => s.startsWith('meta.tag')));
  assert.equal(inTag(tokenized[0]), true, 'первая строка должна быть тегом');
  assert.equal(inTag(tokenized[2]), false, 'текст после пустой строки не должен быть в теге');
  assert.equal(inTag(tokenized[3]), false);
});

test('незакрытый комментарий не переживает пустую строку', async () => {
  const tokenized = await tokenize('[[- коммент\n\n<p>разметка</p>');
  const commented = tokenized[2].tokens.some((t) => t.scopes.some((s) => s.startsWith('comment')));
  assert.equal(commented, false);
});

test('законный многострочный тег не ломается', async () => {
  const tokenized = await tokenize('[[!pdoResources?\n  &parents=`5`\n  &limit=`10`\n]]\nпосле');
  for (const index of [0, 1, 2, 3]) {
    assert.equal(
      tokenized[index].tokens.some((t) => t.scopes.some((s) => s.startsWith('meta.tag'))),
      true,
      'строка ' + (index + 1) + ' должна оставаться внутри тега'
    );
  }
  assert.equal(
    tokenized[4].tokens.some((t) => t.scopes.some((s) => s.startsWith('meta.tag'))),
    false,
    'после закрытия тег продолжаться не должен'
  );
});

// --- Ложные срабатывания на [[ ---------------------------------------------

test('голая [[ в строке не открывает тег', async () => {
  for (const source of ['a { content: "[["; }', 'var s = "[[";']) {
    const tokenized = await tokenize(source);
    assert.deepEqual(
      tokensWithScope(tokenized, 'meta.tag'),
      [],
      source + ' — не должно разбираться как тег'
    );
  }
});

test('законные формы имени сохранены', async () => {
  // Парсер делает trim() над именем, поэтому пробелы внутри скобок допустимы.
  // Имя может быть и вложенным тегом — это динамический вызов.
  for (const source of ['[[Snippet]]', '[[ Snippet ]]', '[[[[+dynamicName]]]]', '[[$[[+chunkName]]]]']) {
    const tokenized = await tokenize(source);
    assert.ok(
      tokensWithScope(tokenized, 'meta.tag').length > 0,
      source + ' — должно оставаться тегом'
    );
  }
});

// --- Синтаксис из исходника парсера ---------------------------------------
// Каждый случай сверен с core/src/Revolution/modParser.php.

test('# после * относится к символу типа, а не к имени', async () => {
  // case '*': если следующий символ '#', парсер его срезает.
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

test('префикс amp; не попадает в имя параметра', async () => {
  // parsePropertyString: if (substr($propName, 0, 4) == "amp;") — префикс срезается.
  const tokenized = await tokenize('[[!Snippet? &amp;limit=`5`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.parameter').map((token) => token.text),
    ['limit']
  );
});

test('двойной бэктик — экранирование, а не конец значения', async () => {
  // parsePropertyString: str_replace("``", "`", $propValue).
  const tokenized = await tokenize('[[+ph:default=`он сказал ``привет`` вчера`]]');
  assert.equal(tokensWithScope(tokenized, 'constant.character.escape').length, 2);
  // Значение остаётся одной строкой: ровно одна открывающая и одна закрывающая.
  assert.equal(tokensWithScope(tokenized, 'punctuation.definition.string.begin').length, 1);
  assert.equal(tokensWithScope(tokenized, 'punctuation.definition.string.end').length, 1);
});

test('значение без бэктиков — рабочий синтаксис, а не ошибка', async () => {
  // parsePropertyString снимает бэктики только если они есть, поэтому
  // &tpl=row парсится штатно и помечать его invalid нельзя.
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

test('вложенный тег внутри значения по-прежнему разбирается', async () => {
  const tokenized = await tokenize('[[+ph:default=`значение [[*id]] внутри`]]');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.resource').map((token) => token.text),
    ['id']
  );
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

test('каждый scope задокументирован в README', () => {
  // Без этой проверки таблица в README протухнет на первой же правке
  // грамматики: новый scope просто не попадёт в документацию.
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  const names = [...new Set(collectScopeNames([grammar.patterns, grammar.repository, grammar.injections]))];
  const undocumented = names.filter((name) => !readme.includes(name)).sort();
  assert.deepEqual(
    undocumented,
    [],
    'нет в README — допишите в раздел Scopes: ' + undocumented.join(', ')
  );
});

test('заявленные расширения файлов описаны в README', () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(grammar.fileTypes.length > 0, 'fileTypes пуст — грамматика не включится ни на чём');
  const undocumented = grammar.fileTypes.filter((type) => !readme.includes('`.' + type + '`'));
  assert.deepEqual(undocumented, [], 'нет в README: ' + undocumented.join(', '));
});

test('грамматика — валидный JSON и index.js указывает на неё', () => {
  const grammar = JSON.parse(fs.readFileSync(GRAMMAR_PATH, 'utf8'));
  assert.equal(grammar.scopeName, 'text.html.modx');
  const exported = require(path.resolve(__dirname, '..', 'index.js'));
  assert.equal(exported, GRAMMAR_PATH);
  assert.ok(fs.existsSync(exported));
});
