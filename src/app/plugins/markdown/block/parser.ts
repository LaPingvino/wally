import type Token from 'markdown-it/lib/token.mjs';
import { markdownIt } from '../markdownit';
import { replaceMatch } from '../internal';
import { ESC_BLOCK_SEQ } from './rules';
import { BlockMDParser } from './type';

const PASSTHROUGH_TOKEN_TYPES = new Set([
  'paragraph_open',
  'paragraph_close',
  'inline',
  'text',
  'softbreak',
  'hardbreak',
]);

const hasBlockStructure = (tokens: Token[]): boolean => {
  for (const t of tokens) {
    if (!PASSTHROUGH_TOKEN_TYPES.has(t.type)) return true;
  }
  return false;
};

const renderWithInlineCallback = (
  tokens: Token[],
  env: Record<string, unknown>,
  parseInline?: (text: string) => string
): string => {
  const renderer = markdownIt.renderer;
  const options = markdownIt.options;
  let result = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.type === 'inline') {
      result += parseInline
        ? parseInline(t.content)
        : renderer.renderInline(t.children || [], options, env);
    } else if (renderer.rules[t.type]) {
      const rule = renderer.rules[t.type];
      if (rule) result += rule(tokens, i, options, env, renderer);
    } else {
      result += renderer.renderToken(tokens, i, options);
    }
  }
  return result;
};

export const parseBlockMD: BlockMDParser = (text, parseInline) => {
  if (text === '') return text;

  const env = {};
  const tokens = markdownIt.parse(text, env);

  if (!hasBlockStructure(tokens)) {
    return text
      .split('\n')
      .map((lineText) => {
        const match = lineText.match(ESC_BLOCK_SEQ);
        if (!match) {
          return parseInline?.(lineText) ?? lineText;
        }
        const [, g1] = match;
        return replaceMatch(lineText, match, g1, (t) => [parseInline?.(t) ?? t]).join('');
      })
      .join('<br/>');
  }

  return renderWithInlineCallback(tokens, env, parseInline).replace(/\n+$/, '');
};
