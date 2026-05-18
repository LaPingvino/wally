import { describe, expect, it } from 'vitest';
import { parseBlockMD } from './block/parser';
import { parseInlineMD } from './inline/parser';

describe('parseInlineMD', () => {
  it('renders plain text unchanged', () => {
    expect(parseInlineMD('hello world')).toBe('hello world');
  });

  it('renders bold with data-md', () => {
    expect(parseInlineMD('**hi**')).toBe('<strong data-md="**">hi</strong>');
  });

  it('renders italic with star', () => {
    expect(parseInlineMD('*hi*')).toBe('<em data-md="*">hi</em>');
  });

  it('renders italic with underscore', () => {
    expect(parseInlineMD('_hi_')).toBe('<em data-md="_">hi</em>');
  });

  it('renders __ as underline (Matrix flavor)', () => {
    expect(parseInlineMD('__hi__')).toBe('<u data-md="__">hi</u>');
  });

  it('renders strikethrough', () => {
    expect(parseInlineMD('~~hi~~')).toBe('<s data-md="~~">hi</s>');
  });

  it('renders inline code', () => {
    expect(parseInlineMD('`hi`')).toBe('<code data-md="`">hi</code>');
  });

  it('renders spoiler', () => {
    expect(parseInlineMD('||secret||')).toBe(
      '<span data-md="||" data-mx-spoiler="">secret</span>'
    );
  });

  it('does NOT make k. into an ordered list (block-level only anyway)', () => {
    // inline parser shouldn't touch block syntax
    expect(parseInlineMD('k. word')).toBe('k. word');
  });
});

describe('parseBlockMD', () => {
  it('preserves plain text without block markdown', () => {
    expect(parseBlockMD('hello\nworld\n')).toBe('hello<br/>world<br/>');
  });

  it('does NOT treat "k. foo" as an ordered list', () => {
    const result = parseBlockMD('k. foo\n');
    expect(result).not.toContain('<ol');
    expect(result).toContain('k. foo');
  });

  it('renders ATX heading', () => {
    expect(parseBlockMD('# title\n')).toContain('<h1 data-md="#">');
  });

  it('renders ordered list with digits', () => {
    const result = parseBlockMD('1. one\n2. two\n');
    expect(result).toContain('<ol');
    expect(result).toContain('<li><p>one</p></li>');
  });

  it('renders unordered list with asterisk', () => {
    const result = parseBlockMD('* one\n* two\n');
    expect(result).toContain('<ul data-md="*">');
  });

  it('renders fenced code block', () => {
    const result = parseBlockMD('```js\nfoo\n```\n');
    expect(result).toContain('<pre data-md="```">');
    expect(result).toContain('class="language-js"');
  });

  it('renders blockquote', () => {
    const result = parseBlockMD('> quote\n');
    expect(result).toContain('<blockquote');
  });

  it('passes inline content through parseInline callback', () => {
    const result = parseBlockMD('# title\n', (text) => `[${text}]`);
    expect(result).toBe('<h1 data-md="#">[title]</h1>');
  });

  it('preserves embedded HTML through callback when no block markdown', () => {
    const html = '<a href="x">**not bold**</a>';
    const passthrough = (t: string) => t;
    expect(parseBlockMD(html, passthrough)).toBe(html);
  });
});

describe('regression: URL with underscores', () => {
  it('does not italicize text inside a URL', () => {
    // GFM linkify auto-detects, no _emph_ inside URL
    const result = parseInlineMD('see https://my_weird_link.example.com/foo');
    expect(result).not.toContain('<em');
    expect(result).toContain('my_weird_link.example.com');
  });
});

describe('regression: variable-length backtick fences', () => {
  it('inline code with embedded backtick via double fence', () => {
    expect(parseInlineMD('`` ` ``')).toContain('<code data-md="``">');
  });

  it('block code fence longer than 3', () => {
    const result = parseBlockMD('````\nlet x = `hi`;\n````\n');
    expect(result).toContain('<pre data-md="````">');
    expect(result).toContain('let x = `hi`;');
  });
});

describe('regression: escape sequences', () => {
  it('escaped asterisk does not bold', () => {
    expect(parseInlineMD('\\*not bold\\*')).toBe('*not bold*');
  });

  it('escaped pipe does not start spoiler', () => {
    const result = parseInlineMD('\\|\\|literal\\|\\|');
    expect(result).not.toContain('data-mx-spoiler');
  });
});

describe('GFM-style additions', () => {
  it('renders a table', () => {
    const src = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    const result = parseBlockMD(src);
    expect(result).toContain('<table>');
    expect(result).toContain('<th>a</th>');
    expect(result).toContain('<td>1</td>');
  });

  it('renders horizontal rule', () => {
    expect(parseBlockMD('---\n')).toContain('<hr>');
  });

  it('autolinks bare URL', () => {
    const result = parseInlineMD('see https://example.com here');
    expect(result).toContain('<a href="https://example.com"');
  });
});

describe('regression: pre-escaped content in code spans (K900)', () => {
  // Callers escape text via sanitizeText before invoking the parser, so
  // code_inline / fence content arrives already HTML-encoded. The renderer
  // must NOT re-escape, or `" "` typed in inline code renders as the literal
  // string `&quot; &quot;` (or, in some cases, with whitespace mangled).
  it('inline code does not double-escape entities', () => {
    expect(parseInlineMD('`&quot; &quot;`')).toBe(
      '<code data-md="`">&quot; &quot;</code>'
    );
  });
  it('fenced code does not double-escape entities', () => {
    expect(parseBlockMD('```\n&quot; &quot;\n```\n')).toContain('&quot; &quot;');
    expect(parseBlockMD('```\n&quot; &quot;\n```\n')).not.toContain('&amp;quot;');
  });
});

describe('regression: ordered list edge cases', () => {
  it('does not match alphabetic ordered list (k.)', () => {
    const result = parseBlockMD('k. word\n');
    expect(result).not.toContain('<ol');
  });

  it('matches multi-digit ordered list', () => {
    const result = parseBlockMD('10. ten\n11. eleven\n');
    expect(result).toContain('<ol');
    expect(result).toContain('start="10"');
  });
});
