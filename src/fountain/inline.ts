import type { Run } from '../shared/build.js';

const ESC_STAR = '';
const ESC_UNDER = '';

type Pattern = { re: RegExp; marks: Partial<Record<'b' | 'i' | 'u', true>> };

// Order matters only for ties at the same index (longest delimiter first).
const PATTERNS: Pattern[] = [
  { re: /\*\*\*(?=\S)([^\n]+?)(?<=\S)\*\*\*/, marks: { b: true, i: true } },
  { re: /\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/, marks: { b: true } },
  { re: /\*(?=\S)([^\n]+?)(?<=\S)\*/, marks: { i: true } },
  { re: /(?<![A-Za-z0-9_])_(?=\S)([^\n]+?)(?<=\S)_(?![A-Za-z0-9])/, marks: { u: true } },
];

function restore(s: string): string {
  return s.split(ESC_STAR).join('*').split(ESC_UNDER).join('_');
}

function parseRuns(text: string, marks: Omit<Run, 'text'>, out: Run[]): void {
  let best: { index: number; length: number; inner: string; p: Pattern } | null = null;
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m && (best === null || m.index < best.index)) best = { index: m.index, length: m[0].length, inner: m[1]!, p };
  }
  if (!best) {
    if (text) out.push({ text: restore(text), ...marks });
    return;
  }
  if (best.index > 0) out.push({ text: restore(text.slice(0, best.index)), ...marks });
  parseRuns(best.inner, { ...marks, ...best.p.marks }, out);
  parseRuns(text.slice(best.index + best.length), marks, out);
}

/** Fountain inline emphasis to runs. Per line only: the pattern classes never match across `\n`. */
export function parseEmphasis(text: string): Run[] {
  const prepared = text.replace(/\\\*/g, ESC_STAR).replace(/\\_/g, ESC_UNDER);
  const out: Run[] = [];
  parseRuns(prepared, {}, out);
  return out;
}

function escapeLiteral(s: string): string {
  return s.replace(/([*_])/g, '\\$1');
}

/** Runs to Fountain emphasis. Whitespace at run edges moves outside the delimiters (flanking rule). */
export function serializeEmphasis(runs: readonly Run[], transform: (s: string) => string = (s) => s): string {
  let out = '';
  for (const r of runs) {
    // Emphasis never spans a soft return: close and reopen per line.
    const lines = transform(r.text).split('\n');
    out += lines
      .map((line) => {
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(line)!;
        const [, lead, core, trail] = m;
        if (core === '') return line;
        let s = escapeLiteral(core!);
        if (r.b && r.i) s = `***${s}***`;
        else if (r.b) s = `**${s}**`;
        else if (r.i) s = `*${s}*`;
        if (r.u) s = `_${s}_`;
        return `${lead}${s}${trail}`;
      })
      .join('\n');
  }
  return out;
}
