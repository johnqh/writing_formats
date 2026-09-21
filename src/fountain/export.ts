import type { ElementJSON, TitleField } from '@sudobility/writing_core';
import { runsFromText } from '../shared/build.js';
import { DocReader, sceneNumberLabels, scanExportLosses } from '../shared/read.js';
import { ReportBuilder } from '../report.js';
import type { FountainExportResult } from '../types.js';
import { classifyBlock, HEADING_RE, isAllCapsLine } from './classify.js';
import { serializeEmphasis } from './inline.js';
import type { DocumentJSON } from '@sudobility/writing_core';
import { formatNumberLabel } from '../shared/build.js';

export interface FountainExportOptions {
  /** Append Bin items as `/* ... *\/` blocks (default false). */
  includeBin?: boolean;
}

const KEYS: [TitleField, string][] = [
  ['title', 'Title'], ['subtitle', 'Subtitle'], ['series', 'Series'], ['episode', 'Episode'], ['credit', 'Credit'], ['author', 'Author'],
  ['source', 'Source'], ['basedOn', 'Based on'], ['draftDate', 'Draft date'], ['revision', 'Revision'], ['contact', 'Contact'],
  ['copyright', 'Copyright'], ['wga', 'WGA'], ['notes', 'Notes'],
];

export function exportFountain(document: DocumentJSON, options: FountainExportOptions = {}): FountainExportResult {
  const report = new ReportBuilder('export', 'fountain');
  const r = new DocReader(document);
  scanExportLosses(r, report, { format: 'fountain', keepNotes: true, keepStrike: false });
  const blocks: string[] = [];
  const sceneNums = sceneNumberLabels(document);
  const hf = [document.template.footer.enabled && 'footer', document.template.header.enabled && document.template.header.right !== '{page}.' && 'header'].filter(Boolean);
  if (hf.length) report.loss('FOUNTAIN_HEADERS', 'headers_footers', `Fountain has no syntax for custom ${hf.join(' and ')} text; it was not written.`);

  // Title page from semantic fields.
  const titleLines: string[] = [];
  for (const [field, label] of KEYS) {
    const id = document.titlePage.fields[field];
    const el = id ? document.titlePage.elements.find((e) => e.id === id) : undefined;
    if (!el || el.text.plain.trim() === '') continue;
    const lines = serializeEmphasis(runsFromText(el.text)).split('\n');
    if (lines.length === 1) titleLines.push(`${label}: ${lines[0]}`);
    else titleLines.push(`${label}:`, ...lines.map((l) => `    ${l}`));
  }
  if (titleLines.length) blocks.push(titleLines.join('\n'));
  else if (document.titlePage.elements.some((e) => e.text.plain.trim())) {
    report.loss('FOUNTAIN_TITLE_UNBOUND', 'title_page', 'Title page text not bound to a field was not written.');
  }

  const lineOf = (el: ElementJSON, upper: boolean): string =>
    serializeEmphasis(runsFromText(el.text), upper ? (s) => s.toUpperCase() : undefined);
  const noteSuffix = (el: ElementJSON): string =>
    r.notesFor(el.id).map((n) => ` [[${n.replace(/\]\]/g, '] ]').replace(/\s*\n\s*/g, ' ')}]]`).join('');
  const withNotes = (text: string, el: ElementJSON): string => text + noteSuffix(el);

  const els = document.elements;
  const lossRoles = new Set<string>();
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!;
    const role = r.roleOf(el);
    const caps = r.allCaps(el);
    if (el.ov?.pageBreakBefore) blocks.push('===');

    if (role === 'character') {
      const nameLine = lineOf(el, true).replace(/\n/g, ' ').trim();
      const lines: string[] = [];
      let j = i + 1;
      let prevDialogue = false;
      for (; j < els.length; j++) {
        const f = els[j]!;
        const fr = r.roleOf(f);
        if (fr !== 'parenthetical' && fr !== 'dialogue') break;
        if (f.ov?.pageBreakBefore) break;
        if (fr === 'parenthetical') {
          let t = lineOf(f, caps && false).replace(/\n/g, ' ').trim();
          if (!/^\(.*\)$/.test(t)) t = `(${t.replace(/^\(|\)$/g, '')})`;
          lines.push(withNotes(t, f));
          prevDialogue = false;
        } else {
          const t = withNotes(lineOf(f, false), f);
          if (prevDialogue) lines.push('  ');
          // Blank lines inside dialogue text would end the block: use a two-space line.
          lines.push(...t.split('\n').map((l) => (l.trim() === '' ? '  ' : l)));
          prevDialogue = true;
        }
      }
      const head = `${nameLine}${el.dual?.side === 'right' ? ' ^' : ''}`;
      const kind = classifyBlock([head, ...(lines.length ? lines : ['x'])]);
      const lead = kind === 'character' && lines.length > 0 ? head : `@${head}`;
      if (nameLine === '') { i = j - 1; continue; }
      blocks.push([withNotes(lead, el), ...lines].join('\n'));
      i = j - 1;
      continue;
    }

    if (el.text.plain === '' && r.notesFor(el.id).length === 0) continue;

    switch (role) {
      case 'sceneHeading': {
        let t = lineOf(el, true).replace(/\n/g, ' ').trim();
        if (!HEADING_RE.test(t)) t = `.${t}`;
        const num = sceneNums.get(el.id) ?? (el.num ? formatNumberLabel(el.num.label) : undefined);
        if (num) t += ` #${num}#`;
        blocks.push(withNotes(t, el));
        const syn = el.scene?.synopsis.plain;
        if (syn) blocks.push(syn.split('\n').map((l) => `= ${l}`).join('\n'));
        break;
      }
      case 'transition': {
        const t = lineOf(el, true).replace(/\n/g, ' ').trim();
        blocks.push(withNotes(isAllCapsLine(t) && /TO:$/.test(t) ? t : `> ${t}`, el));
        break;
      }
      case 'parenthetical':
      case 'dialogue': {
        // Orphan dialogue (no preceding character): keep as action.
        blocks.push(forceAction(withNotes(lineOf(el, false), el)));
        report.warn('FOUNTAIN_ORPHAN_DIALOGUE', 'styles', 'Dialogue without a character was written as action.');
        break;
      }
      case 'lyrics':
        blocks.push(withNotes(lineOf(el, false).split('\n').map((l) => `~${l}`).join('\n'), el));
        break;
      case 'outline':
        blocks.push(withNotes(`${'#'.repeat(r.outlineLevel(el))} ${lineOf(el, false).replace(/\n/g, ' ')}`, el));
        break;
      case 'actStart':
        blocks.push(withNotes(`# ${lineOf(el, false).replace(/\n/g, ' ')}`, el));
        break;
      case 'synopsis':
        blocks.push(lineOf(el, false).split('\n').map((l) => `= ${l}`).join('\n'));
        break;
      case 'note':
        blocks.push(`[[${el.text.plain.replace(/\]\]/g, '] ]').replace(/\s*\n\s*/g, ' ')}]]`);
        break;
      default: {
        if (role !== 'action' && role !== 'normal') lossRoles.add(role);
        const upper = caps && role !== 'action' && role !== 'normal';
        const raw = lineOf(el, upper);
        if (el.ov?.align === 'center' && !raw.includes('\n')) {
          blocks.push(withNotes(`> ${raw.trim()} <`, el));
        } else {
          const lines = raw.split('\n').map((l) => (l.trim() === '' ? '  ' : l));
          blocks.push(forceAction(withNotes(lines.join('\n'), el)));
        }
      }
    }
  }
  if (lossRoles.size) report.loss('FOUNTAIN_STYLES', 'styles', `Styles with no Fountain equivalent were written as action (${[...lossRoles].join(', ')}).`);
  if (els.some((e) => e.ov?.align && e.ov.align !== 'center')) report.loss('FOUNTAIN_ALIGN', 'page_layout', 'Paragraph alignment other than centred was not written.');

  if (document.bin.length) {
    if (options.includeBin) {
      for (const item of document.bin) blocks.push(`/*\n${item.content.map((c) => c.text.plain).join('\n\n')}\n*/`);
    } else report.loss('FOUNTAIN_BIN', 'unknown_content', 'Bin items were not written (enable includeBin to write them as boneyard).');
  }

  const text = `${blocks.join('\n\n')}\n`;
  return { text, report: report.build({ elements: els.length, scenes: r.scenes() }, { sourceVersion: '1.1' }) };
}

/** Prefixes `!` when the block would not read back as action. */
function forceAction(block: string): string {
  const lines = block.split('\n');
  return classifyBlock(lines) === 'action' ? block : `!${block}`;
}
