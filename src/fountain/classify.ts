export type BlockKind =
  | 'pagebreak' | 'section' | 'synopsis' | 'lyrics' | 'forcedAction' | 'forcedCharacter' | 'forcedHeading' | 'heading'
  | 'centered' | 'forcedTransition' | 'transition' | 'character' | 'action';

export const HEADING_RE = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[.\s]/i;
const FORCED_HEADING_RE = /^\.(?=[A-Za-z0-9])/;
const CENTERED_RE = /^>\s*(.*?)\s*<$/;

/** True when `line` has at least one letter and no lowercase letters, ignoring `(...)` groups and a trailing `^`. */
export function isAllCapsLine(line: string): boolean {
  const core = line.replace(/\^\s*$/, '').replace(/\([^)]*\)/g, '').trim();
  return /[A-Za-zÀ-￿]/.test(core) && core === core.toUpperCase() && core !== core.toLowerCase();
}

/** Classifies a blank-line-delimited block by its first line (spec 04 §4.5.1, first match wins). */
export function classifyBlock(lines: readonly string[]): BlockKind {
  const first = (lines[0] ?? '').replace(/\s+$/, '');
  const t = first.trimStart();
  const single = lines.length === 1;
  if (single && /^={3,}\s*$/.test(t)) return 'pagebreak';
  if (/^#+/.test(t)) return 'section';
  if (/^=(?!=)/.test(t)) return 'synopsis';
  if (t.startsWith('~')) return 'lyrics';
  if (t.startsWith('!')) return 'forcedAction';
  if (t.startsWith('@')) return 'forcedCharacter';
  if (FORCED_HEADING_RE.test(t)) return 'forcedHeading';
  if (HEADING_RE.test(t)) return 'heading';
  if (CENTERED_RE.test(t)) return 'centered';
  if (t.startsWith('>')) return 'forcedTransition';
  if (single && isAllCapsLine(t) && /TO:$/.test(t)) return 'transition';
  if (!single && isAllCapsLine(t) && !/^\(.*\)$/.test(t)) return 'character';
  return 'action';
}

export { CENTERED_RE };
