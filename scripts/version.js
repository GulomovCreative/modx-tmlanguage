'use strict';

// Запускается npm-ом между подъёмом версии в package.json и созданием
// коммита с тегом. Здесь уже известен номер выпускаемой версии, поэтому это
// единственное место, где можно привести CHANGELOG в соответствие с ней.
//
// Скрипт закрывает раздел «Unreleased»: переименовывает его в раздел версии
// с датой, заводит новый пустой Unreleased и правит ссылки внизу файла.
// Раньше это описывалось в CONTRIBUTING как ручная работа, и держалось только
// на внимательности: забытая или наполовину сделанная правка обнаруживалась
// уже после публикации, а версию в npm не отозвать.
//
// Изменённый файл добавляется в индекс — npm включает в коммит версии всё,
// что скрипт этого этапа успел проиндексировать.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/**
 * Есть ли в CHANGELOG раздел для этой версии. Вынесено отдельно ради тестов:
 * проверять формат заголовка, не выпуская настоящую версию, иначе нечем.
 */
function changelogHasVersion(changelog, version) {
  // Заголовок вида «## [2.0.0] — 2026-09-11» или просто «## [2.0.0]».
  const heading = new RegExp('^## \\[' + version.replace(/\./g, '\\.') + '\\]', 'm');
  return heading.test(changelog);
}

/** Остались ли под Unreleased незаписанные пункты. */
function unreleasedIsEmpty(changelog) {
  const match = changelog.match(/^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[)/m);
  if (!match) return true;
  return match[1].trim() === '';
}

/**
 * Переносит содержимое Unreleased в раздел выпускаемой версии.
 *
 * Чистая функция над текстом файла: так её можно проверить на всех формах
 * changelog-а, не выпуская настоящих версий. Возвращает новый текст.
 *
 * Ссылки внизу файла правятся вместе с заголовками. Это половина работы,
 * которую легче всего забыть: заголовок «## [2.1.0]» без определения ссылки
 * остаётся в Markdown просто текстом в скобках, и ни одна проверка в
 * репозитории этого не замечает.
 */
function closeUnreleased(changelog, version, date) {
  const heading = /^## \[Unreleased\][^\n]*\n/m;
  if (!heading.test(changelog)) {
    throw new Error('в CHANGELOG.md нет раздела «## [Unreleased]»');
  }

  // Ссылка Unreleased несёт предыдущий тег: именно от него ведётся диапазон
  // сравнения для выпускаемой версии.
  const link = /^\[Unreleased\]:[ \t]*(\S+)\/compare\/(\S+)\.\.\.HEAD[ \t]*$/m;
  const parsed = changelog.match(link);
  if (!parsed) {
    throw new Error(
      'внизу CHANGELOG.md нет ссылки вида «[Unreleased]: <url>/compare/<тег>...HEAD» — ' +
      'без неё не из чего собрать диапазон сравнения для новой версии'
    );
  }

  const [, base, previousTag] = parsed;

  return changelog
    .replace(heading, (matched) => matched + '\n## [' + version + '] — ' + date + '\n')
    .replace(
      link,
      '[Unreleased]: ' + base + '/compare/v' + version + '...HEAD\n' +
      '[' + version + ']: ' + base + '/compare/' + previousTag + '...v' + version
    );
}

/** Сегодняшняя дата по местному времени, в формате ГГГГ-ММ-ДД. */
function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
}

function main() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  const changelog = fs.readFileSync(changelogPath, 'utf8');

  // Раздел уже закрыт вручную — оставляем как есть: переписывать чужую правку
  // хуже, чем ничего не делать.
  if (changelogHasVersion(changelog, version)) {
    if (!unreleasedIsEmpty(changelog)) {
      console.warn(
        '\nПредупреждение: под «## [Unreleased]» остались записи — они не войдут\n' +
        'в описание версии ' + version + '. Если это не задумано, перенесите их.\n'
      );
    }
    return;
  }

  if (unreleasedIsEmpty(changelog)) {
    console.error(
      '\nРелиз остановлен: под «## [Unreleased]» в CHANGELOG.md ничего нет.\n\n' +
      '  Выпускать нечего, либо изменения не описаны. Опишите их и запустите снова.\n'
    );
    process.exit(1);
  }

  let updated;
  try {
    updated = closeUnreleased(changelog, version, today());
  } catch (error) {
    console.error('\nРелиз остановлен: ' + error.message + '.\n');
    process.exit(1);
  }

  fs.writeFileSync(changelogPath, updated);
  execFileSync('git', ['add', '--', changelogPath], { cwd: ROOT });
  console.log('CHANGELOG.md: раздел Unreleased закрыт как ' + version + '.');
}

if (require.main === module) main();

module.exports = { changelogHasVersion, unreleasedIsEmpty, closeUnreleased, today };
