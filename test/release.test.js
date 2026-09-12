'use strict';

// Логика проверок перед релизом. Сам скрипт ходит в git, поэтому проверяемая
// часть вынесена в чистую функцию — так она тестируется без подготовки
// настоящего репозитория с нужным состоянием.

const fs = require('fs');
const path = require('path');
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

// --- Проверка CHANGELOG перед релизом --------------------------------------

const { changelogHasVersion, unreleasedIsEmpty } = require('../scripts/version.js');

test('раздел версии в CHANGELOG находится', () => {
  const changelog = '# Changelog\n\n## [Unreleased]\n\n## [2.0.0] — 2026-09-11\n\n### Fixed\n';
  assert.equal(changelogHasVersion(changelog, '2.0.0'), true);
  assert.equal(changelogHasVersion(changelog, '2.0.1'), false);
  assert.equal(changelogHasVersion(changelog, '1.2.0'), false);
});

test('заголовок версии без даты тоже считается', () => {
  assert.equal(changelogHasVersion('## [3.1.0]\n', '3.1.0'), true);
});

test('точки в номере версии не считаются любым символом', () => {
  // Наивное «2.0.0» в регулярном выражении совпало бы и с «21000».
  assert.equal(changelogHasVersion('## [21000]\n', '2.0.0'), false);
});

test('непустой Unreleased распознаётся', () => {
  const empty = '## [Unreleased]\n\n## [2.0.0]\n\n### Fixed\n- что-то\n';
  const filled = '## [Unreleased]\n\n### Added\n- забытая запись\n\n## [2.0.0]\n';
  assert.equal(unreleasedIsEmpty(empty), true);
  assert.equal(unreleasedIsEmpty(filled), false);
});

test('настоящий CHANGELOG содержит раздел готовящейся версии', () => {
  // Версия в package.json поднимается самим npm version, поэтому здесь
  // проверяется текущая — то есть что файл и манифест не разошлись.
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  assert.equal(changelogHasVersion(changelog, '2.0.0'), true, 'нет раздела для 2.0.0');
  assert.equal(unreleasedIsEmpty(changelog), true, 'под Unreleased остались записи');
});
