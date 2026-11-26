const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTables, removeNewlines } = require('../src/renderer/tools.js');

const GOOD = [
  '| Shortcut | Action |',
  '| -------- | ------ |',
  '| Cmd + Z  | Undo   |',
  '| Tab      | Indent |',
].join('\n');

test('splits rows that were merged onto one line (two lines)', () => {
  const bad = '| Shortcut | Action | | -------- | ------ |\n| Cmd + Z  | Undo   | | Tab      | Indent |';
  assert.equal(formatTables(bad), GOOD);
});

test('splits a whole table merged onto a single line', () => {
  const bad = '| Shortcut | Action | | -------- | ------ | | Cmd + Z  | Undo   | | Tab      | Indent |';
  assert.equal(formatTables(bad), GOOD);
});

test('aligns a valid but ragged table', () => {
  const ragged = '|Shortcut|Action|\n|-|-|\n|Cmd + Z|Undo|\n| Tab | Indent |';
  assert.equal(formatTables(ragged), GOOD);
});

test('is idempotent on a well-formatted table', () => {
  assert.equal(formatTables(GOOD), GOOD);
});

test('works without leading/trailing pipes and pads short rows', () => {
  const input = 'a | b | c\n--- | --- | ---\n1 | 2';
  assert.equal(formatTables(input), '| a   | b   | c   |\n| --- | --- | --- |\n| 1   | 2   |     |');
});

test('keeps legitimately empty cells', () => {
  const input = '| a | b |\n| --- | --- |\n|  | x |';
  assert.equal(formatTables(input), '| a   | b   |\n| --- | --- |\n|     | x   |');
});

test('preserves column alignment markers', () => {
  const input = '| Left | Center | Right |\n|:--|:-:|--:|\n| a | b | c |';
  assert.equal(formatTables(input), [
    '| Left | Center | Right |',
    '| :--- | :----: | ----: |',
    '| a    |   b    |     c |',
  ].join('\n'));
});

test('keeps escaped pipes inside cells', () => {
  const input = '| Expr | Meaning |\n| --- | --- |\n| a \\| b | or |';
  assert.equal(formatTables(input), '| Expr   | Meaning |\n| ------ | ------- |\n| a \\| b | or      |');
});

test('leaves surrounding text, code fences and non-tables untouched', () => {
  const input = [
    '# Title',
    'Some text with a | pipe.',
    '',
    '```',
    '|a|b|',
    '|-|-|',
    '```',
    '',
    '|x|y|',
    '|-|-|',
    '|1|2|',
    '',
    'After.',
  ].join('\n');
  const expected = input.replace('|x|y|\n|-|-|\n|1|2|', '| x   | y   |\n| --- | --- |\n| 1   | 2   |');
  assert.equal(formatTables(input), expected);
});

test('only reformats from the header row when a paragraph line precedes the table', () => {
  const input = 'intro | text\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(formatTables(input), 'intro | text\n| a   | b   |\n| --- | --- |\n| 1   | 2   |');
});

test('formats multiple tables and keeps trailing newline', () => {
  const input = '|a|b|\n|-|-|\n\ntext\n\n|c|\n|-|\n';
  assert.equal(formatTables(input), '| a   | b   |\n| --- | --- |\n\ntext\n\n| c   |\n| --- |\n');
});

test('removeNewlines still joins paragraph lines', () => {
  assert.equal(removeNewlines('a\nb\n\nc\nd\n'), 'a b\n\nc d\n');
});

test('removeNewlines leaves tables, lists, code and headings alone', () => {
  const input = [
    '# Heading',
    'wrapped paragraph',
    'continues here',
    '',
    '- item one',
    '- item two',
    '  continued item',
    '1. first',
    '2. second',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '```js',
    'const a = 1;',
    'const b = 2;',
    '```',
    '',
    '    indented code',
    '    more code',
    '',
    'last',
    'para',
    '',
  ].join('\n');
  const expected = input
    .replace('wrapped paragraph\ncontinues here', 'wrapped paragraph continues here')
    .replace('last\npara', 'last para');
  assert.equal(removeNewlines(input), expected);
});

test('removeNewlines joins blockquote paragraphs under one marker', () => {
  const input = '> Tip: select some text\n> to only join lines.\n\n> - a\n> - b';
  assert.equal(removeNewlines(input), '> Tip: select some text to only join lines.\n\n> - a\n> - b');
});

test('removeNewlines does not break a table directly after a paragraph', () => {
  const input = 'Intro line\nwraps\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  assert.equal(removeNewlines(input), 'Intro line wraps\n| a | b |\n| --- | --- |\n| 1 | 2 |');
});

test('removeNewlines leaves the welcome document structure intact', () => {
  const doc = '## Features\n\n- Live preview\n- Dark mode\n\n```js\nconsole.log(1);\n```\n\n| Shortcut | Action |\n| -------- | ------ |\n| Cmd + Z  | Undo   |\n';
  assert.equal(removeNewlines(doc), doc);
});

// ---------- changeCase ----------
const { changeCase } = require('../src/renderer/tools.js');

test('changeCase upper/lower on plain Markdown text', () => {
  assert.equal(changeCase('# Hello World\n\nSome *Text* and **More**.', 'upper'), '# HELLO WORLD\n\nSOME *TEXT* AND **MORE**.');
  assert.equal(changeCase('- Item ONE\n- Item Two', 'lower'), '- item one\n- item two');
});

test('changeCase leaves code, URLs, HTML tags and entities alone', () => {
  const src = 'See [the Docs](https://Example.com/Guide "Title") and `npm Run Build`, <span class="Big">Hi</span> &nbsp; www.Site.com/Path or Me@Mail.com';
  assert.equal(
    changeCase(src, 'upper'),
    'SEE [THE DOCS](https://Example.com/Guide "Title") AND `npm Run Build`, <span class="Big">HI</span> &nbsp; www.Site.com/Path OR Me@Mail.com',
  );
});

test('changeCase skips fenced and indented code but not list continuations', () => {
  const src = [
    'Intro text',
    '```js',
    'const Value = 1;',
    '```',
    '',
    '    indented Code',
    '',
    '- List item',
    '',
    '    continued Paragraph',
  ].join('\n');
  assert.equal(changeCase(src, 'upper'), [
    'INTRO TEXT',
    '```js',
    'const Value = 1;',
    '```',
    '',
    '    indented Code',
    '',
    '- LIST ITEM',
    '',
    '    CONTINUED PARAGRAPH',
  ].join('\n'));
});

test('changeCase keeps reference definitions and (whole document) front matter', () => {
  const src = '---\nTitle: My Post\n---\n# Post\n\n[Ref]: https://X.com/A\nText';
  assert.equal(changeCase(src, 'lower', { wholeDocument: true }), '---\nTitle: My Post\n---\n# post\n\n[Ref]: https://X.com/A\ntext');
  // A selection that starts with a rule isn't front matter.
  assert.equal(changeCase('---\nAbc\n---', 'lower'), '---\nabc\n---');
});

test('changeCase leaves table structure intact', () => {
  assert.equal(changeCase('| Name | Role |\n| :--- | ---: |\n| Ada | Eng |', 'upper'), '| NAME | ROLE |\n| :--- | ---: |\n| ADA | ENG |');
});

// ---------- Title Case / Sentence case ----------

test('Title Case: short words lowercase except first/last/after a colon; acronyms and brands kept', () => {
  assert.equal(changeCase('# the lord of the rings: the return of the king', 'title'), '# The Lord of the Rings: The Return of the King');
  assert.equal(changeCase('- get an iPhone from the NASA store\n- what is it for', 'title'), '- Get an iPhone from the NASA Store\n- What Is It For');
  assert.equal(changeCase('A TALE OF TWO CITIES', 'title'), 'A Tale of Two Cities'); // all caps: no acronyms to keep
  assert.equal(changeCase('a well-known fact', 'title'), 'A Well-Known Fact');
});

test('Sentence case: capitalizes sentence starts across wrapped lines, keeps acronyms, fixes "i"', () => {
  assert.equal(
    changeCase('Use The NASA API On My iPhone And i Think\nIt Continues Here. Next Sentence!', 'sentence'),
    'Use the NASA API on my iPhone and I think\nit continues here. Next sentence!',
  );
  assert.equal(changeCase('THIS IS ALL CAPS. SECOND ONE.', 'sentence'), 'This is all caps. Second one.');
  // A shouted run inside a mixed line is re-cased; a lone acronym is kept.
  assert.equal(changeCase('THIS LINE WAS SHOUTED. it uses the NASA API.', 'sentence'), 'This line was shouted. It uses the NASA API.');
  assert.equal(changeCase('READ THIS NOW about NASA', 'title'), 'Read This Now About NASA');
  assert.equal(changeCase('| Name Here | Some Role |\n| --- | --- |\n| Big Cell | Other Cell |', 'sentence'),
    '| Name here | Some role |\n| --- | --- |\n| Big cell | Other cell |');
});

test('Title/Sentence case skip code and URLs in Markdown; markdown:false changes everything', () => {
  assert.equal(changeCase('read [the docs](https://X.com/A) and `npm Run`', 'title'), 'Read [the Docs](https://X.com/A) and `npm Run`');
  assert.equal(changeCase('```\nconst Value\n```\nthe end', 'title'), '```\nconst Value\n```\nThe End');
  assert.equal(changeCase('hello world. again', 'sentence', { markdown: false }), 'Hello world. Again');
});

// ---------- Clean up pasted text ----------
const { cleanUpText, toTable } = require('../src/renderer/tools.js');

test('cleanUpText rejoins hyphenated words, collapses spaces, converts bullets', () => {
  const src = 'The exam-\nple shows a fact.   Too   many  spaces.\n• First bullet\n  ◦ Nested\n– Dash item';
  assert.equal(cleanUpText(src), 'The example\nshows a fact. Too many spaces.\n- First bullet\n  - Nested\n- Dash item');
});

test('cleanUpText fixes odd spaces, invisible characters, trailing spaces and extra blank lines', () => {
  const src = 'no break​ here­   \n\n\n\nhard break  \nnext line';
  assert.equal(cleanUpText(src), 'no break here\n\nhard break  \nnext line');
});

test('cleanUpText leaves code and tables alone', () => {
  const src = '```\nkeep   this  \n```\n\n| a  | b |\n| -- | - |\n| 1  | 2 |';
  assert.equal(cleanUpText(src), src);
});

// ---------- Convert to table ----------

test('toTable converts tab-, comma- (quoted), and space-separated rows', () => {
  assert.equal(toTable('Name\tRole\nAda\tEngineer'), '| Name | Role     |\n| ---- | -------- |\n| Ada  | Engineer |');
  assert.equal(toTable('Name,Role\n"Smith, J",Lead'), '| Name     | Role |\n| -------- | ---- |\n| Smith, J | Lead |');
  assert.equal(toTable('Product    Units\nWidget     12'), '| Product | Units |\n| ------- | ----- |\n| Widget  | 12    |');
});

test('toTable escapes pipes, pads short rows, and leaves non-tabular text alone', () => {
  assert.equal(toTable('a\tb\tc\nx|y\t1'), '| a    | b   | c   |\n| ---- | --- | --- |\n| x\\|y | 1   |     |');
  assert.equal(toTable('Just a sentence, with a comma.'), 'Just a sentence, with a comma.');
});
