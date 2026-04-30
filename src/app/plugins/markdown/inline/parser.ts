import { markdownIt } from '../markdownit';
import { InlineMDParser } from './type';

export const parseInlineMD: InlineMDParser = (text) => {
  if (text === '') return text;
  return markdownIt.renderInline(text);
};
