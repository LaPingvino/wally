import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

const SPOILER_MARKER = 0x7c; /* | */

// Adapted from markdown-it-mark (MIT). Pairs `||` delimiters and converts
// them into spoiler tokens after the inline tokenizer runs.
const spoilerPlugin = (md: MarkdownIt): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenize = (state: any, silent: boolean): boolean => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== SPOILER_MARKER) return false;
    if (silent) return false;

    const scanned = state.scanDelims(state.pos, true);
    let len: number = scanned.length;
    if (len < 2) return false;

    if (len % 2) {
      const tok = state.push('text', '', 0);
      tok.content = '|';
      len -= 1;
    }

    for (let i = 0; i < len; i += 2) {
      const token = state.push('text', '', 0);
      token.content = '||';
      if (!scanned.can_open && !scanned.can_close) continue;
      state.delimiters.push({
        marker: SPOILER_MARKER,
        length: 0,
        token: state.tokens.length - 1,
        end: -1,
        open: scanned.can_open,
        close: scanned.can_close,
      });
    }

    state.pos += scanned.length;
    return true;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const postProcess = (state: any, delimiters: any[]): void => {
    const loneMarkers: number[] = [];
    const max = delimiters.length;

    for (let i = 0; i < max; i += 1) {
      const startDelim = delimiters[i];
      if (startDelim.marker !== SPOILER_MARKER) continue;
      if (startDelim.end === -1) continue;

      const endDelim = delimiters[startDelim.end];

      let token: Token = state.tokens[startDelim.token];
      token.type = 'spoiler_open';
      token.tag = 'span';
      token.nesting = 1;
      token.markup = '||';
      token.content = '';

      token = state.tokens[endDelim.token];
      token.type = 'spoiler_close';
      token.tag = 'span';
      token.nesting = -1;
      token.markup = '||';
      token.content = '';

      if (
        state.tokens[endDelim.token - 1].type === 'text' &&
        state.tokens[endDelim.token - 1].content === '|'
      ) {
        loneMarkers.push(endDelim.token - 1);
      }
    }

    while (loneMarkers.length) {
      const i = loneMarkers.pop() as number;
      let j = i + 1;
      while (j < state.tokens.length && state.tokens[j].type === 'spoiler_close') {
        j += 1;
      }
      j -= 1;
      if (i !== j) {
        const swap = state.tokens[j];
        state.tokens[j] = state.tokens[i];
        state.tokens[i] = swap;
      }
    }
  };

  md.inline.ruler.before('text', 'spoiler', tokenize);

  // markdown-it's built-in `text` rule does not treat `|` as a terminator,
  // so it greedily consumes spoiler closers. Replace `text` with a version
  // that also stops at `|`.
  const TERMINATORS = new Set([
    0x0a, 0x21, 0x23, 0x24, 0x25, 0x26, 0x2a, 0x2b, 0x2d, 0x3a, 0x3c, 0x3d,
    0x3e, 0x40, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x60, 0x7b, 0x7c, 0x7d, 0x7e,
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.inline.ruler.at('text', (state: any, silent: boolean): boolean => {
    let pos = state.pos;
    while (pos < state.posMax && !TERMINATORS.has(state.src.charCodeAt(pos))) {
      pos += 1;
    }
    if (pos === state.pos) return false;
    if (!silent) state.pending += state.src.slice(state.pos, pos);
    state.pos = pos;
    return true;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.inline.ruler2.before('emphasis', 'spoiler', (state: any) => {
    const tokensMeta = state.tokens_meta;
    postProcess(state, state.delimiters);
    for (let curr = 0; curr < tokensMeta.length; curr += 1) {
      if (tokensMeta[curr] && tokensMeta[curr].delimiters) {
        postProcess(state, tokensMeta[curr].delimiters);
      }
    }
    return true;
  });

  md.renderer.rules.spoiler_open = () => '<span data-md="||" data-mx-spoiler="">';
  md.renderer.rules.spoiler_close = () => '</span>';
};

const buildMarkdownIt = (): MarkdownIt => {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    typographer: false,
  });

  md.disable(['code']);
  md.use(spoilerPlugin);

  const origStrongOpen =
    md.renderer.rules.strong_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  const origStrongClose =
    md.renderer.rules.strong_close ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));

  md.renderer.rules.strong_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    if (t.markup === '__') return '<u data-md="__">';
    return `<strong data-md="**">`;
  };
  md.renderer.rules.strong_close = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    if (t.markup === '__') return '</u>';
    return '</strong>';
  };

  md.renderer.rules.em_open = (tokens, idx) => {
    const t = tokens[idx];
    return `<em data-md="${t.markup}">`;
  };
  md.renderer.rules.em_close = () => '</em>';

  md.renderer.rules.s_open = () => '<s data-md="~~">';
  md.renderer.rules.s_close = () => '</s>';

  const escapeHtml = md.utils.escapeHtml;

  md.renderer.rules.code_inline = (tokens, idx) => {
    const t = tokens[idx];
    const fence = t.markup || '`';
    return `<code data-md="${fence}">${escapeHtml(t.content)}</code>`;
  };

  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const info = t.info ? t.info.trim() : '';
    const fence = t.markup || '```';
    const lang = info ? info.substring(info.lastIndexOf('.') + 1) : '';
    const filename = info && info !== lang ? info : '';
    const classAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    const labelAttr = filename ? ` data-label="${escapeHtml(filename)}"` : '';
    const escaped = escapeHtml(t.content);
    return `<pre data-md="${fence}"><code${classAttr}${labelAttr}>${escaped}</code></pre>\n`;
  };

  md.renderer.rules.heading_open = (tokens, idx) => {
    const t = tokens[idx];
    const level = Number(t.tag.slice(1));
    const hashes = '#'.repeat(level);
    return `<${t.tag} data-md="${hashes}">`;
  };

  md.renderer.rules.bullet_list_open = (tokens, idx) => {
    const t = tokens[idx];
    const marker = t.markup || '*';
    return `<ul data-md="${marker}">`;
  };

  md.renderer.rules.ordered_list_open = (tokens, idx) => {
    const t = tokens[idx];
    const start = t.attrGet('start');
    const startAttr = start ? ` start="${start}"` : '';
    const dataMd = start ? `${start}.` : '1.';
    return `<ol data-md="${dataMd}"${startAttr}>`;
  };

  md.renderer.rules.list_item_open = () => '<li><p>';
  md.renderer.rules.list_item_close = () => '</p></li>';

  md.renderer.rules.blockquote_open = () => '<blockquote data-md="&gt;">';

  const origLinkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const t = tokens[idx];
    if (t.markup === 'linkify' || t.markup === 'autolink') {
      return origLinkOpen(tokens, idx, opts, env, self);
    }
    t.attrJoin('data-md', '');
    return origLinkOpen(tokens, idx, opts, env, self);
  };

  return md;
};

export const markdownIt = buildMarkdownIt();
