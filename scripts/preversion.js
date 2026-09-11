'use strict';

// Проверки перед npm version. Нужны потому, что postversion публикует то,
// что сейчас в рабочем дереве, и отправляет текущую ветку: запуск не с
// master выложил бы в npm содержимое случайной ветки, а отменить
// опубликованную версию нельзя.

const { execFileSync } = require('child_process');

const RELEASE_BRANCH = 'master';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * Разбирает вывод git status --porcelain. Вынесено отдельно и не использует
 * git(): тот обрезает пробелы по краям всего вывода, а у строки состояния
 * первый символ значим и часто является пробелом (" M file" — изменён, но не
 * добавлен в индекс), так что обрезка съедала бы первую букву имени файла.
 */
function parseStatus(raw) {
  return raw
    .split('\n')
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3));
}

/**
 * Чистая проверка состояния — вынесена отдельно, чтобы её можно было
 * протестировать без подготовки настоящего репозитория.
 * Возвращает список причин, по которым релиз запускать нельзя.
 */
function releaseBlockers({ branch, dirtyFiles, behindCount }) {
  const blockers = [];

  if (branch !== RELEASE_BRANCH) {
    blockers.push(
      'релиз собирается с ветки "' + branch + '", а не с "' + RELEASE_BRANCH + '" — ' +
      'postversion опубликовал бы содержимое этой ветки'
    );
  }

  if (dirtyFiles.length > 0) {
    blockers.push(
      'в рабочем дереве есть незакоммиченные изменения (' + dirtyFiles.length + '), ' +
      'они попали бы в пакет: ' + dirtyFiles.slice(0, 5).join(', ') +
      (dirtyFiles.length > 5 ? ' и ещё ' + (dirtyFiles.length - 5) : '')
    );
  }

  if (behindCount > 0) {
    blockers.push(
      'локальная ветка отстаёт от origin/' + RELEASE_BRANCH + ' на ' + behindCount +
      ' коммит(ов) — часть изменений не попала бы в релиз'
    );
  }

  return blockers;
}

function collectState() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const dirtyFiles = parseStatus(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
  );

  let behindCount = 0;
  try {
    execFileSync('git', ['fetch', 'origin', RELEASE_BRANCH], { stdio: 'ignore' });
    behindCount = Number(git('rev-list', '--count', 'HEAD..origin/' + RELEASE_BRANCH));
  } catch (error) {
    // Без сети отставание проверить нельзя. Это не повод блокировать релиз,
    // но молчать об этом тоже неправильно.
    console.warn('preversion: не удалось сверить с origin — проверка отставания пропущена');
  }

  return { branch, dirtyFiles, behindCount };
}

function main() {
  const blockers = releaseBlockers(collectState());
  if (blockers.length === 0) return;

  console.error('\nРелиз остановлен:\n');
  for (const blocker of blockers) console.error('  • ' + blocker);
  console.error('\nИсправьте и запустите снова.\n');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { releaseBlockers, parseStatus, RELEASE_BRANCH };
