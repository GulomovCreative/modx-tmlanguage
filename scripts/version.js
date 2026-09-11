'use strict';

// Запускается npm-ом между подъёмом версии в package.json и созданием
// коммита с тегом. Здесь уже известен номер выпускаемой версии, поэтому это
// единственное место, где можно проверить, что CHANGELOG про неё знает.
//
// Без этой проверки правило «пополняйте Unreleased» из CONTRIBUTING держится
// только на внимательности: забытая запись обнаружится уже после публикации,
// а версию в npm не отозвать.

const fs = require('fs');
const path = require('path');

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

function main() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

  if (!changelogHasVersion(changelog, version)) {
    console.error(
      '\nРелиз остановлен: в CHANGELOG.md нет раздела для версии ' + version + '.\n\n' +
      '  Переименуйте «## [Unreleased]» в «## [' + version + '] — ГГГГ-ММ-ДД»,\n' +
      '  заведите новый пустой Unreleased и поправьте ссылки внизу файла.\n'
    );
    process.exit(1);
  }

  if (!unreleasedIsEmpty(changelog)) {
    console.warn(
      '\nПредупреждение: под «## [Unreleased]» остались записи — они не войдут\n' +
      'в описание версии ' + version + '. Если это не задумано, перенесите их.\n'
    );
  }
}

if (require.main === module) main();

module.exports = { changelogHasVersion, unreleasedIsEmpty };
