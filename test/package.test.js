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

// Имя берётся из манифеста, а не пишется здесь: иначе при переименовании
// пакета тесты продолжили бы проверять старое имя и ничего бы не заметили.
const PACKAGE_NAME = require(path.join(ROOT, 'package.json')).name;

/**
 * Окружение для вложенного вызова npm. Родительский npm передаёт свою
 * конфигурацию через переменные npm_config_*, и они наследуются дочерним
 * процессом. Для --dry-run это означает, что npm install внутри теста
 * ничего не устанавливает и тест падает на разрешении модуля — то есть
 * `npm publish --dry-run` не проходит на здоровом коде.
 *
 * Настоящая публикация этим не задета: там переменная не выставлена. Но
 * сухой прогон — главный способ проверить релиз заранее, и он должен
 * работать.
 */
function nestedNpmEnv() {
  const env = { ...process.env };
  delete env.npm_config_dry_run;
  return env;
}

/**
 * Как именно запускать npm.
 *
 * На Windows npm — это npm.cmd, а Node начиная с 18.20.2 отказывается
 * запускать .cmd и .bat без shell (исправление CVE-2024-27980) и падает с
 * EINVAL. Поэтому:
 *
 * 1. Если тест запущен самим npm, тот передаёт в npm_execpath путь к своему
 *    JS-файлу. Запускаем его текущим Node — никакого .cmd, одинаково на всех
 *    системах. Это и есть случай prepublishOnly, то есть публикации.
 * 2. Иначе (node --test напрямую) на Windows зовём npm через shell, экранируя
 *    аргументы: Node при shell не экранирует их сам, а во временных путях
 *    встречаются пробелы.
 */
function npmCommand(args) {
  const viaNpm = process.env.npm_execpath;
  if (viaNpm && viaNpm.endsWith('.js')) {
    return { file: process.execPath, args: [viaNpm, ...args], shell: false };
  }
  if (process.platform === 'win32') {
    return { file: 'npm', args: args.map((arg) => '"' + arg + '"'), shell: true };
  }
  return { file: 'npm', args, shell: false };
}

function npm(args, cwd) {
  const { file, args: spawnArgs, shell } = npmCommand(args);
  return execFileSync(file, spawnArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: nestedNpmEnv(),
    shell,
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
    const grammarPath = require(${JSON.stringify(PACKAGE_NAME)});
    if (typeof grammarPath !== 'string') {
      throw new Error('ожидалась строка с путём, получено: ' + typeof grammarPath);
    }
    console.log(require('fs').existsSync(grammarPath) ? 'ok' : 'файла нет: ' + grammarPath);
  `);
  assert.equal(out, 'ok');
});

test('import по имени пакета отдаёт тот же путь', () => {
  const out = runInConsumer(consumerDir, `
    const { default: grammarPath } = await import(${JSON.stringify(PACKAGE_NAME)});
    if (typeof grammarPath !== 'string') {
      throw new Error('ожидалась строка с путём, получено: ' + typeof grammarPath);
    }
    console.log('ok');
  `, 'esm');
  assert.equal(out, 'ok');
});

test('сам файл грамматики доступен подпутём', () => {
  const out = runInConsumer(consumerDir, `
    const grammar = require(${JSON.stringify(PACKAGE_NAME + '/modx.tmLanguage.json')});
    console.log(grammar.scopeName);
  `);
  assert.equal(out, 'text.html.modx');
});

test('путь из пакета указывает на разбираемую грамматику', () => {
  const out = runInConsumer(consumerDir, `
    const fs = require('fs');
    const grammar = JSON.parse(fs.readFileSync(require(${JSON.stringify(PACKAGE_NAME)}), 'utf8'));
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

test('вложенный npm не наследует --dry-run родительского процесса', () => {
  // Прямая проверка причины, по которой npm publish --dry-run падал:
  // переменная должна быть снята именно для дочернего процесса, а не
  // глобально, иначе тест менял бы окружение всего прогона.
  const before = process.env.npm_config_dry_run;
  process.env.npm_config_dry_run = 'true';
  try {
    assert.equal('npm_config_dry_run' in nestedNpmEnv(), false);
    assert.equal(process.env.npm_config_dry_run, 'true', 'окружение процесса изменено');
  } finally {
    if (before === undefined) delete process.env.npm_config_dry_run;
    else process.env.npm_config_dry_run = before;
  }
});

test('npm запускается без обращения к .cmd, когда его путь известен', () => {
  // Windows: Node с 18.20.2 не запускает .cmd без shell и падает с EINVAL.
  // Под самим npm обходимся его JS-файлом и текущим Node.
  const before = process.env.npm_execpath;
  process.env.npm_execpath = '/opt/npm/bin/npm-cli.js';
  try {
    const command = npmCommand(['pack']);
    assert.equal(command.file, process.execPath);
    assert.deepEqual(command.args, ['/opt/npm/bin/npm-cli.js', 'pack']);
    assert.equal(command.shell, false, 'shell не нужен, когда путь к JS известен');
  } finally {
    if (before === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = before;
  }
});

test('обёртка npm-cli.js не используется, если путь не на JS', () => {
  // npm_execpath может указывать на .cmd — тогда запускать его через Node нельзя.
  const before = process.env.npm_execpath;
  process.env.npm_execpath = 'C:\\Program Files\\nodejs\\npm.cmd';
  try {
    assert.notEqual(npmCommand(['pack']).file, process.execPath);
  } finally {
    if (before === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = before;
  }
});

test('бейджи в README ведут на этот репозиторий и этот пакет', () => {
  // Бейджи копируют из других проектов чаще, чем пишут с нуля, и чужой
  // адрес в них выглядит совершенно нормально — зелёная галочка от чужого
  // CI ничем не отличается на вид.
  const pkg = require(path.join(ROOT, 'package.json'));
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const badges = readme.slice(0, readme.indexOf('\n\nPrevious'));

  const repo = 'GulomovCreative/modx-tmlanguage';
  const foreign = [...badges.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)/g)]
    .map((match) => match[1])
    .filter((slug) => slug !== repo);
  assert.deepEqual(foreign, [], 'бейдж ведёт в чужой репозиторий');

  assert.ok(
    badges.includes('/npm/v/' + pkg.name),
    'бейдж версии не про пакет ' + pkg.name
  );
  assert.ok(
    badges.includes('npmjs.com/package/' + pkg.name),
    'ссылка бейджа версии ведёт не на пакет ' + pkg.name
  );
  assert.ok(
    badges.includes('license-' + pkg.license + '-'),
    'бейдж лицензии не совпадает с полем license: ' + pkg.license
  );
});

// --- Состав тарбола --------------------------------------------------------
// Тесты выше проверяют, что установленный пакет работает. Здесь — что в него
// попадает ровно то, что задумано: лишний файл в архиве заметить иначе можно
// только вручную, а публикация необратима.
//
// Проверка раньше жила отдельным шагом в CI и потому не запускалась локально —
// о лишнем файле сообщал уже сервер. Здесь она идёт вместе с остальными и в
// том числе перед публикацией, через prepublishOnly.

// Список записан здесь, а не выводится из package.json: вывод из того же поля
// files, которое и правят, не поймал бы ничего. README, LICENSE и package.json
// npm кладёт в архив сам, независимо от files.
const EXPECTED_FILES = [
  'LICENSE',
  'README.md',
  'index.js',
  'modx.tmLanguage.json',
  'package.json',
];

test('в тарбол попадают ровно ожидаемые файлы', () => {
  const [tarball] = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], ROOT));
  const actual = tarball.files.map((file) => file.path).sort();

  assert.deepEqual(
    actual,
    [...EXPECTED_FILES].sort(),
    'состав пакета изменился. Если это намеренно, обновите EXPECTED_FILES в этом тесте'
  );
});
