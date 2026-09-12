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

test('настоящий CHANGELOG готов к тому, что с ним сделает релиз', () => {
  // Версия в package.json поднимается самим npm version, поэтому здесь
  // проверяется текущая — то есть что файл и манифест не разошлись. Под
  // Unreleased при этом могут лежать записи: накапливать их между релизами —
  // это и есть нормальное состояние файла, закрывает раздел скрипт.
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const { version } = require(path.join(__dirname, '..', 'package.json'));
  assert.equal(changelogHasVersion(changelog, version), true, 'нет раздела для ' + version);

  // Скрипту нужны заголовок Unreleased и ссылка на диапазон под ним. Без
  // любого из двух релиз упадёт — но уже после подъёма версии.
  assert.match(changelog, /^## \[Unreleased\]/m, 'нет заголовка Unreleased');
  assert.match(
    changelog,
    /^\[Unreleased\]:[ \t]*\S+\/compare\/\S+\.\.\.HEAD[ \t]*$/m,
    'нет ссылки [Unreleased]: .../compare/<тег>...HEAD'
  );
});

// --- Закрытие раздела Unreleased -------------------------------------------

const { closeUnreleased, today } = require('../scripts/version.js');

const SAMPLE = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '### Added',
  '- новое',
  '',
  '## [1.2.0] — 2026-01-01',
  '',
  '### Fixed',
  '- старое',
  '',
  '[Unreleased]: https://example.com/o/r/compare/v1.2.0...HEAD',
  '[1.2.0]: https://example.com/o/r/releases/tag/v1.2.0',
  ''
].join('\n');

test('содержимое Unreleased переезжает в раздел версии', () => {
  const result = closeUnreleased(SAMPLE, '1.3.0', '2026-02-03');
  assert.match(result, /^## \[1\.3\.0\] — 2026-02-03$/m);

  // Записи должны оказаться под новым заголовком, а не остаться выше него.
  const added = result.indexOf('### Added');
  const heading = result.indexOf('## [1.3.0]');
  assert.ok(heading < added, 'записи остались над заголовком версии');
});

test('пустой Unreleased остаётся на месте для следующего цикла', () => {
  const result = closeUnreleased(SAMPLE, '1.3.0', '2026-02-03');
  assert.match(result, /^## \[Unreleased\]$/m, 'раздел Unreleased исчез');
  assert.equal(unreleasedIsEmpty(result), true, 'под Unreleased что-то осталось');
});

test('ссылки внизу файла переписываются', () => {
  const result = closeUnreleased(SAMPLE, '1.3.0', '2026-02-03');
  assert.match(result, /^\[Unreleased\]: https:\/\/example\.com\/o\/r\/compare\/v1\.3\.0\.\.\.HEAD$/m);
  assert.match(result, /^\[1\.3\.0\]: https:\/\/example\.com\/o\/r\/compare\/v1\.2\.0\.\.\.v1\.3\.0$/m);

  // Прежние определения трогать незачем — на них ссылаются старые разделы.
  assert.match(result, /^\[1\.2\.0\]: https:\/\/example\.com\/o\/r\/releases\/tag\/v1\.2\.0$/m);
});

test('закрытый раздел находится проверкой версии', () => {
  // Две функции описывают один формат заголовка с разных сторон: если он
  // разойдётся, релиз молча перестанет видеть только что записанный раздел.
  const result = closeUnreleased(SAMPLE, '1.3.0', '2026-02-03');
  assert.equal(changelogHasVersion(result, '1.3.0'), true);
});

test('повторное закрытие не наслаивает разделы', () => {
  const once = closeUnreleased(SAMPLE, '1.3.0', '2026-02-03');
  const twice = closeUnreleased(once, '1.4.0', '2026-03-04');
  assert.equal((twice.match(/^## \[1\.3\.0\]/gm) || []).length, 1);
  assert.match(twice, /^\[1\.4\.0\]: https:\/\/example\.com\/o\/r\/compare\/v1\.3\.0\.\.\.v1\.4\.0$/m);
});

test('без раздела Unreleased закрывать нечего', () => {
  assert.throws(
    () => closeUnreleased('# Changelog\n\n## [1.0.0]\n', '1.1.0', '2026-02-03'),
    /Unreleased/
  );
});

test('без ссылки на диапазон закрытие останавливается', () => {
  // Молча пропустить ссылки нельзя: заголовок «## [1.3.0]» без определения
  // остаётся в Markdown просто текстом в скобках.
  const withoutLink = SAMPLE.replace(/^\[Unreleased\]:.*$/m, '');
  assert.throws(() => closeUnreleased(withoutLink, '1.3.0', '2026-02-03'), /compare/);
});

test('дата собирается по местному времени, а не по UTC', () => {
  // new Date().toISOString() отдаёт дату в UTC: вечером в московском поясе
  // это уже завтрашнее число, и релиз получал бы дату из будущего.
  assert.equal(today(new Date(2026, 1, 3, 23, 30)), '2026-02-03');
  assert.equal(today(new Date(2026, 10, 9, 0, 5)), '2026-11-09');
});

// --- Заметки к релизу ------------------------------------------------------

const { sectionFor } = require('../scripts/release-notes.js');

test('раздел версии извлекается без заголовка', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.3.0] — 2026-02-03',
    '',
    '### Added',
    '- новое',
    '',
    '## [1.2.0] — 2026-01-01',
    '',
    '### Fixed',
    '- старое',
    '',
    '[Unreleased]: https://example.com/o/r/compare/v1.3.0...HEAD',
    ''
  ].join('\n');

  const notes = sectionFor(changelog, '1.3.0');
  assert.match(notes, /### Added/);
  assert.match(notes, /- новое/);
  assert.ok(!notes.includes('1.3.0'), 'заголовок версии попал в текст заметок');
  assert.ok(!notes.includes('старое'), 'захвачен раздел предыдущей версии');
});

test('подзаголовки внутри раздела сохраняются', () => {
  // Разделы вида «### Migration» — часть описания версии, а не граница.
  const changelog = '## [2.0.0]\n\nВводный абзац.\n\n### Migration\n\nЧто делать.\n\n## [1.0.0]\n';
  const notes = sectionFor(changelog, '2.0.0');
  assert.match(notes, /### Migration/);
  assert.match(notes, /Что делать/);
});

test('ссылки из подвала файла в заметки не попадают', () => {
  // У самой новой версии следующего заголовка «## [» ниже нет — если не
  // остановиться на определениях ссылок, они уедут в текст релиза.
  const changelog = '## [1.0.0]\n\nПервый выпуск.\n\n[1.0.0]: https://example.com/o/r/releases/tag/v1.0.0\n';
  assert.equal(sectionFor(changelog, '1.0.0'), 'Первый выпуск.');
});

test('отсутствующая версия даёт null, а не пустой текст', () => {
  // Разница существенная: пустой раздел — это допустимый релиз без описания,
  // а отсутствующий — повод остановить публикацию.
  assert.equal(sectionFor('## [1.0.0]\n\nтекст\n', '2.0.0'), null);
  assert.equal(sectionFor('## [1.0.0]\n\n## [0.9.0]\n\nтекст\n', '1.0.0'), '');
});

test('заметки к текущей версии собираются из настоящего CHANGELOG', () => {
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
  const { version } = require(path.join(__dirname, '..', 'package.json'));
  const notes = sectionFor(changelog, version);
  assert.notEqual(notes, null, 'нет раздела для ' + version);
  assert.ok(notes.length > 0, 'раздел пуст — в релизе на GitHub не будет описания');
});
