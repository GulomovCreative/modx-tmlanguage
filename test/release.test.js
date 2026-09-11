'use strict';

// Логика проверок перед релизом. Сам скрипт ходит в git, поэтому проверяемая
// часть вынесена в чистую функцию — так она тестируется без подготовки
// настоящего репозитория с нужным состоянием.

const test = require('node:test');
const assert = require('node:assert/strict');

const { releaseBlockers, parseStatus, RELEASE_BRANCH } = require('../scripts/preversion.js');

const clean = { branch: RELEASE_BRANCH, dirtyFiles: [], behindCount: 0 };

test('чистое состояние на master релиз не блокирует', () => {
  assert.deepEqual(releaseBlockers(clean), []);
});

test('релиз не с master блокируется', () => {
  const blockers = releaseBlockers({ ...clean, branch: 'verify-master3' });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /verify-master3/);
});

test('незакоммиченные изменения блокируют релиз', () => {
  const blockers = releaseBlockers({ ...clean, dirtyFiles: ['modx.tmLanguage.json'] });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /modx\.tmLanguage\.json/);
});

test('список изменённых файлов в сообщении обрезается', () => {
  const many = Array.from({ length: 9 }, (_, i) => 'file' + i + '.txt');
  const [blocker] = releaseBlockers({ ...clean, dirtyFiles: many });
  assert.match(blocker, /file0/);
  assert.match(blocker, /и ещё 4/);
  assert.ok(!blocker.includes('file8'), 'длинный список не обрезан');
});

test('отставание от origin блокирует релиз', () => {
  const blockers = releaseBlockers({ ...clean, behindCount: 3 });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /на 3 коммит/);
});

test('несколько проблем перечисляются разом', () => {
  const blockers = releaseBlockers({ branch: 'wip', dirtyFiles: ['a.js'], behindCount: 2 });
  assert.equal(blockers.length, 3, 'должны быть названы все причины, а не первая');
});

test('имя файла не теряет первый символ при разборе git status', () => {
  // " M package.json" — изменён, но не добавлен в индекс: первый символ
  // строки значим и является пробелом.
  assert.deepEqual(
    parseStatus(' M package.json\n?? scripts/\nM  index.js\n'),
    ['package.json', 'scripts/', 'index.js']
  );
});

test('пустой вывод git status даёт пустой список', () => {
  assert.deepEqual(parseStatus(''), []);
  assert.deepEqual(parseStatus('\n'), []);
});
