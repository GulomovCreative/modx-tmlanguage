'use strict';

// Поведение MODX-тегов внутри вложенных языков: значений HTML-атрибутов,
// <style> и <script>. Это единственная область, которую раньше нельзя было
// проверить — text.html.basic не публикуется отдельным пакетом. Набор Shiki
// содержит те же грамматики, что использует VS Code, поэтому проверка стала
// возможна.

const test = require('node:test');
const assert = require('node:assert/strict');

const { tokenize, tokensWithScope } = require('./tokenize');

const embedded = (source) => tokenize(source, { embedded: true });

/**
 * Токены, размеченные именно грамматикой MODX. Проверять по префиксу scope
 * нельзя: у HTML есть свои meta.tag.* — например meta.tag.metadata.script
 * у самого тега <script>, — и они дают ложное совпадение.
 * Корневой text.html.modx тоже не в счёт: он стоит на каждом токене.
 */
function modxTokens(tokenized) {
  return tokenized
    .flatMap((line) => line.tokens)
    .filter((token) =>
      token.scopes.some((scope) => scope !== 'text.html.modx' && scope.endsWith('.modx'))
    );
}

test('вложенные грамматики действительно подключаются', async () => {
  // Если бы HTML-грамматика не разрешалась, следующие тесты проверяли бы
  // не то, что заявляют: разметка осталась бы просто текстом.
  const tokenized = await embedded('<div class="a">текст</div>');
  const htmlScopes = tokenized[0].tokens.flatMap((token) => token.scopes)
    .filter((scope) => scope.endsWith('.html'));
  assert.ok(htmlScopes.length > 0, 'грамматика HTML не подключилась');
});

test('тег в значении HTML-атрибута подсвечивается', async () => {
  const tokenized = await embedded('<a href="[[~12]]" class="[[+cls]]">ссылка</a>');
  assert.deepEqual(
    tokensWithScope(tokenized, 'constant.other.link').map((t) => t.text),
    ['12']
  );
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.placeholder').map((t) => t.text),
    ['cls']
  );
});

test('тег внутри <style> подсвечивается', async () => {
  const tokenized = await embedded('<style>\n.box { color: [[++brand_color]]; }\n</style>');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.setting').map((t) => t.text),
    ['brand_color']
  );
});

test('тег внутри строки в <script> подсвечивается', async () => {
  const tokenized = await embedded('<script>\nvar id = "[[*id]]";\n</script>');
  assert.deepEqual(
    tokensWithScope(tokenized, 'variable.other.resource').map((t) => t.text),
    ['id']
  );
});

// Известное ограничение, а не недосмотр.
//
// Голый тег в коде JavaScript не подсвечивается: грамматика JS разбирает
// «[[» как начало вложенного литерала массива и выигрывает у инъекции.
// Проверено, что добавление инъекции в source.js этого не меняет, и что
// ограничение существовало до всех недавних правок грамматики.
//
// Практически это задевает только вставку значений в код без кавычек
// (var n = [[+count]];). Внутри строк — самый частый случай в шаблонах —
// подсветка работает, что закреплено тестом выше.
//
// Тест держит границу зафиксированной: если инъекция когда-нибудь начнёт
// выигрывать, он упадёт и об этом станет известно.
test('голый тег в коде JavaScript не подсвечивается (известное ограничение)', async () => {
  const tokenized = await embedded('<script>\nvar n = [[+count]];\n</script>');
  assert.deepEqual(
    modxTokens(tokenized).map((token) => token.text),
    [],
    'поведение изменилось — ограничение снято, обновите README и этот тест'
  );
  // При этом JS-грамматика работает: токены разобраны, просто как массив.
  const jsScopes = tokenized[1].tokens.flatMap((t) => t.scopes).filter((s) => s.endsWith('.js'));
  assert.ok(jsScopes.length > 0, 'грамматика JS не подключилась — тест проверяет не то');
});
