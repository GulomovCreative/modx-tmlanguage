'use strict';

// Renders the sample template with real editor themes, as SVG.
//
// Two things at once. It is the screenshot in the README -- a grammar is a
// visual thing and prose cannot show it -- and it is a check no other suite
// makes: a scope can be spelled correctly, start with a root themes recognise,
// be documented in the README, and still be coloured by nothing at all, because
// no theme targets it. Only rendering through a real theme shows that.
//
// SVG rather than a bitmap: it needs no browser to produce, it is text, and its
// diff in a pull request says which token changed colour.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const THEMES = ['github-light', 'github-dark'];
const SAMPLE_PATH = path.join(ROOT, 'docs', 'preview.tpl');
const svgPathFor = (theme) => path.join(ROOT, 'docs', 'preview-' + theme + '.svg');

// A monospace grid: every glyph is one cell wide, so a token's x is its column.
const FONT_SIZE = 13;
const CHAR_WIDTH = 7.8;
const LINE_HEIGHT = 20;
const PADDING = 18;

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The SVG for one already-tokenized sample. Pure, so the test can call it. */
function renderSvg(lines, { background, foreground }) {
  const columns = Math.max(...lines.map((line) => line.reduce((n, token) => n + token.content.length, 0)));
  const width = Math.ceil(columns * CHAR_WIDTH + PADDING * 2);
  const height = lines.length * LINE_HEIGHT + PADDING * 2;

  const body = lines
    .map((line, index) => {
      let column = 0;
      const spans = line
        .map((token) => {
          const x = (PADDING + column * CHAR_WIDTH).toFixed(1);
          column += token.content.length;
          if (token.content.trim() === '') return '';
          return '<tspan x="' + x + '" fill="' + (token.color || foreground) + '">' + escape(token.content) + '</tspan>';
        })
        .join('');
      const y = (PADDING + index * LINE_HEIGHT + FONT_SIZE).toFixed(1);
      return spans === '' ? '' : '    <text y="' + y + '">' + spans + '</text>';
    })
    .filter(Boolean)
    .join('\n');

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="' + FONT_SIZE + '">',
    '  <rect width="' + width + '" height="' + height + '" rx="8" fill="' + background + '"/>',
    '  <g xml:space="preserve">',
    body,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

/** The SVG for every theme, keyed by theme name. */
async function renderAll() {
  const { createHighlighter } = await import('shiki');
  const grammar = JSON.parse(fs.readFileSync(path.join(ROOT, 'modx.tmLanguage.json'), 'utf8'));
  const source = fs.readFileSync(SAMPLE_PATH, 'utf8').replace(/\n$/, '');

  const highlighter = await createHighlighter({
    themes: THEMES,
    langs: [{ ...grammar, name: 'modx', embeddedLangs: ['html'] }, 'html', 'css', 'javascript'],
  });

  const rendered = {};
  for (const theme of THEMES) {
    const { tokens, bg, fg } = highlighter.codeToTokens(source, { lang: 'modx', theme });
    rendered[theme] = renderSvg(tokens, { background: bg, foreground: fg });
  }
  return rendered;
}

async function main() {
  const rendered = await renderAll();
  for (const theme of THEMES) {
    fs.writeFileSync(svgPathFor(theme), rendered[theme]);
    console.log('wrote ' + path.relative(ROOT, svgPathFor(theme)));
  }
}

if (require.main === module) main();

module.exports = { renderAll, renderSvg, THEMES, SAMPLE_PATH, svgPathFor };
