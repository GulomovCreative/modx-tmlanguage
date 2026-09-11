'use strict';

// Проверка того, что получает установивший пакет, а не того, что лежит в
// репозитории. Разница принципиальная: поле exports в package.json меняет
// разрешение имён, поэтому подключение файла напрямую по относительному пути
// (как в grammar.test.js) успешно проходит даже тогда, когда сам пакет сломан.
//
// Тест собирает тарбол через npm pack, ставит его в пустой проект и
// подключает по имени — и из CommonJS, и из ESM.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

function npm(args, cwd) {
  return execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Собирает пакет и ставит его в одноразовый проект. Возвращает путь проекта. */
function installPackedPackage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modx-tmlanguage-pack-'));
  // prepublishOnly запускает тесты; изнутри теста это дало бы рекурсию.
  const packed = npm(['pack', '--ignore-scripts', '--pack-destination', dir], ROOT).trim().split('\n').pop();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }) + '\n'
  );
  npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', path.join(dir, packed)], dir);
  return dir;
}

/** Выполняет код в установленном проекте и возвращает напечатанное. */
function runInConsumer(dir, code, moduleType) {
  const args = moduleType === 'esm' ? ['--input-type=module', '-e', code] : ['-e', code];
  return execFileSync(process.execPath, args, { cwd: dir, encoding: 'utf8' }).trim();
}

let consumerDir;

test.before(() => {
  consumerDir = installPackedPackage();
});

test.after(() => {
  if (consumerDir) fs.rmSync(consumerDir, { recursive: true, force: true });
});

test('require по имени пакета отдаёт путь к файлу грамматики', () => {
  const out = runInConsumer(consumerDir, `
    const grammarPath = require('modx-tmlanguage');
    if (typeof grammarPath !== 'string') {
      throw new Error('ожидалась строка с путём, получено: ' + typeof grammarPath);
    }
    console.log(require('fs').existsSync(grammarPath) ? 'ok' : 'файла нет: ' + grammarPath);
  `);
  assert.equal(out, 'ok');
});

test('import по имени пакета отдаёт тот же путь', () => {
  const out = runInConsumer(consumerDir, `
    const { default: grammarPath } = await import('modx-tmlanguage');
    if (typeof grammarPath !== 'string') {
      throw new Error('ожидалась строка с путём, получено: ' + typeof grammarPath);
    }
    console.log('ok');
  `, 'esm');
  assert.equal(out, 'ok');
});

test('сам файл грамматики доступен подпутём', () => {
  const out = runInConsumer(consumerDir, `
    const grammar = require('modx-tmlanguage/modx.tmLanguage.json');
    console.log(grammar.scopeName);
  `);
  assert.equal(out, 'text.html.modx');
});

test('путь из пакета указывает на разбираемую грамматику', () => {
  const out = runInConsumer(consumerDir, `
    const fs = require('fs');
    const grammar = JSON.parse(fs.readFileSync(require('modx-tmlanguage'), 'utf8'));
    console.log(grammar.scopeName + ' ' + Object.keys(grammar.repository).length);
  `);
  const [scopeName, ruleCount] = out.split(' ');
  assert.equal(scopeName, 'text.html.modx');
  assert.ok(Number(ruleCount) > 0, 'в грамматике нет правил');
});

// --- Метаданные ------------------------------------------------------------
// Поля, по которым npm строит страницу пакета. Ошибка в них не ломает код и
// потому легко живёт незамеченной, пока кто-то не пойдёт искать, куда сообщить
// об ошибке, и не обнаружит, что ссылки нет.

test('метаданные пакета заполнены и в формате, который понимает npm', () => {
  const pkg = require(path.join(ROOT, 'package.json'));

  assert.match(
    pkg.repository.url,
    /^git\+https:\/\//,
    'npm ожидает repository.url в форме git+https://…, иначе ссылка на исходники не строится'
  );
  assert.ok(pkg.bugs && pkg.bugs.url, 'без bugs.url на странице пакета нет ссылки «сообщить об ошибке»');
  assert.ok(pkg.homepage, 'нет homepage');
  assert.ok(pkg.engines && pkg.engines.node, 'не указана минимальная версия Node');

  const repo = 'https://github.com/GulomovCreative/modx-tmlanguage';
  assert.ok(pkg.bugs.url.startsWith(repo), 'bugs.url ведёт не в этот репозиторий');
  assert.ok(pkg.homepage.startsWith(repo), 'homepage ведёт не в этот репозиторий');
});

test('в LICENSE указан автор пакета', () => {
  // Файл лицензии и манифест — два независимых места, где записан
  // правообладатель. Разойтись они могут незаметно: лицензия почти никогда
  // не открывается, а публикуется при этом в каждом релизе.
  const pkg = require(path.join(ROOT, 'package.json'));
  const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');

  assert.ok(
    license.includes(pkg.author.name),
    'в LICENSE нет имени автора из package.json: ' + pkg.author.name
  );
  assert.match(license, /^Copyright \(c\) \d{4} /m, 'строка копирайта не в ожидаемом виде');
});
