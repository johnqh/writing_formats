import { positionBetween, type ElementJSON, type TitleField } from '@sudobility/writing_core';
import { DocBuilder, parseNumberLabel, textFromRuns, type Run } from '../shared/build.js';
import { ReportBuilder } from '../report.js';
import type { ImportOptions, ImportResult } from '../types.js';
import { CENTERED_RE, classifyBlock } from './classify.js';
import { parseEmphasis } from './inline.js';

const NOTE_OPEN = '';
const NOTE_CLOSE = '';
const BONE_OPEN = '';
const BONE_CLOSE = '';

interface Line {
  /** Text with note/boneyard sentinels removed. */
  t: string;
  notes: number[];
  bones: number[];
  /** The line held only notes/boneyard. */
  markerOnly: boolean;
}

const TITLE_KEYS: Record<string, TitleField> = {
  title: 'title', subtitle: 'subtitle', credit: 'credit', author: 'author', authors: 'author', source: 'source',
  'based on': 'basedOn', 'draft date': 'draftDate', date: 'draftDate', contact: 'contact', copyright: 'copyright',
  notes: 'notes', revision: 'revision', series: 'series', episode: 'episode', wga: 'wga',
};

const CENTER_FIELDS: ReadonlySet<TitleField> = new Set(['title', 'subtitle', 'credit', 'author', 'source', 'basedOn', 'series', 'episode']);
const TITLE_ORDER: TitleField[] = ['title', 'subtitle', 'series', 'episode', 'credit', 'author', 'source', 'basedOn', 'draftDate', 'revision', 'contact', 'copyright', 'wga', 'notes'];

export function importFountain(input: string, options: ImportOptions = {}): ImportResult {
  const report = new ReportBuilder('import', 'fountain');
  const b = new DocBuilder(options);
  const src = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  // Pre-pass 1: boneyard (may span blank lines). Unterminated `/*` stays literal.
  const boneyards: string[] = [];
  let text = src.replace(/\/\*([\s\S]*?)\*\//g, (_m, body: string) => {
    boneyards.push(body);
    return `${BONE_OPEN}${boneyards.length - 1}${BONE_CLOSE}`;
  });
  if (text.includes('/*')) report.warn('FOUNTAIN_UNTERMINATED_BONEYARD', 'unknown_content', 'Unterminated /* was kept as literal text.');

  // Pre-pass 2: notes (may span lines and blank lines). Unterminated `[[` stays literal.
  const notes: string[] = [];
  text = text.replace(/\[\[([\s\S]*?)\]\]/g, (_m, body: string) => {
    notes.push(body.replace(/\n{2,}/g, '\n').trim());
    return `${NOTE_OPEN}${notes.length - 1}${NOTE_CLOSE}`;
  });
  if (text.includes('[[')) report.warn('FOUNTAIN_UNTERMINATED_NOTE', 'notes', 'Unterminated [[ was kept as literal text.');

  const lines: Line[] = text.split('\n').map((raw) => {
    const ns: number[] = [];
    const bs: number[] = [];
    const t = raw
      .replace(new RegExp(`${NOTE_OPEN}(\\d+)${NOTE_CLOSE}`, 'g'), (_m, n: string) => { ns.push(Number(n)); return ''; })
      .replace(new RegExp(`${BONE_OPEN}(\\d+)${BONE_CLOSE}`, 'g'), (_m, n: string) => { bs.push(Number(n)); return ''; });
    return { t, notes: ns, bones: bs, markerOnly: (ns.length > 0 || bs.length > 0) && t.trim() === '' };
  });

  let i = 0;

  // Title page: `Key: value` lines until the first blank line.
  while (i < lines.length && lines[i]!.t.trim() === '' && !lines[i]!.markerOnly) i++;
  const titleFields = new Map<TitleField, string[]>();
  const extras: Record<string, string> = {};
  if (i < lines.length && /^[A-Za-z][A-Za-z ]{0,30}:/.test(lines[i]!.t)) {
    let key = '';
    while (i < lines.length && lines[i]!.t.trim() !== '') {
      const line = lines[i]!.t;
      const kv = /^([A-Za-z][A-Za-z ]{0,30}):\s*(.*)$/.exec(line);
      if (kv && !/^(\s{3,}|\t)/.test(line)) {
        key = kv[1]!.trim();
        const field = TITLE_KEYS[key.toLowerCase()];
        const value = kv[2]!.trim();
        if (field) titleFields.set(field, [...(titleFields.get(field) ?? []), ...(value ? [value] : [])]);
        else { extras[key] = value; report.info('FOUNTAIN_TITLE_KEY', 'title_page', 'Unrecognised title page keys were kept in import metadata only.'); }
      } else if (key) {
        const value = line.trim();
        const field = TITLE_KEYS[key.toLowerCase()];
        if (field) titleFields.set(field, [...(titleFields.get(field) ?? []), value]);
        else extras[key] = `${extras[key] ?? ''}\n${value}`.trim();
      }
      i++;
    }
  }
  for (const field of TITLE_ORDER) {
    const vals = titleFields.get(field);
    if (!vals || vals.length === 0) continue;
    const align = CENTER_FIELDS.has(field) ? 'center' : 'left';
    const runs = vals.flatMap((v, k) => [...(k > 0 ? [{ text: '\n' }] : []), ...parseEmphasis(v)]);
    b.addTitleElement(b.titleStyleFor(field, align), textFromRuns(runs), field, align === 'left' ? { anchor: 'bottom' } : undefined);
  }

  // Body.
  type Pending = { notes: number[]; bones: number[] };
  const pending: Pending = { notes: [], bones: [] };
  let pageBreak = false;
  const boneQueue: { boneIdx: number; elementIndex: number }[] = [];
  let lastCharStart = -1;
  let lastBlockEnd = -1;

  const attachNotes = (el: ElementJSON, ids: number[]) => {
    for (const n of ids) b.addNote(el.id, notes[n] ?? '');
  };
  const emit = (styleId: string, runs: Run[], lineNotes: number[], extra: Partial<ElementJSON> = {}): ElementJSON => {
    const el = b.makeElement(styleId, textFromRuns(runs), extra);
    if (pageBreak) {
      el.ov = { ...(el.ov ?? {}), pageBreakBefore: true };
      pageBreak = false;
    }
    b.add(el);
    attachNotes(el, [...pending.notes, ...lineNotes]);
    pending.notes = [];
    for (const bi of pending.bones) boneQueue.push({ boneIdx: bi, elementIndex: b.json.elements.length - 1 });
    pending.bones = [];
    return el;
  };
  const S = (role: Parameters<DocBuilder['styleForRole']>[0], level?: number) => b.styleForRole(role, level).id;
  const inline = (s: string): Run[] => parseEmphasis(s);
  const lastEl = () => b.json.elements[b.json.elements.length - 1];

  const flushBlock = (block: Line[]) => {
    // Note/boneyard-only lines: notes wait for the next element; a note-only block is not an element.
    const real: Line[] = [];
    for (const ln of block) {
      if (ln.markerOnly) { pending.notes.push(...ln.notes); pending.bones.push(...ln.bones); } else real.push(ln);
    }
    if (real.length === 0) return;
    const texts = real.map((l) => l.t.replace(/\s+$/, ''));
    const kind = classifyBlock(texts);
    const noteIds = (idx: number) => real[idx]!.notes;
    const allNotes = real.flatMap((l) => l.notes);
    for (const l of real) pending.bones.push(...l.bones);
    const first = texts[0]!.trimStart();

    switch (kind) {
      case 'pagebreak': pageBreak = true; pending.notes.push(...allNotes); return;
      case 'section': {
        const m = /^(#+)\s*(.*)$/.exec(first)!;
        const level = Math.min(m[1]!.length, 3);
        if (m[1]!.length > 3) report.info('FOUNTAIN_SECTION_DEPTH', 'structure', 'Section depth above 3 was flattened to 3.');
        emit(S('outline', level), inline(m[2]!), allNotes);
        return;
      }
      case 'synopsis': {
        const body = texts.map((t) => t.trimStart().replace(/^=\s?/, '')).join('\n');
        const prev = lastEl();
        if (prev?.scene && b.roleOfStyle(prev.style) === 'sceneHeading') {
          const cur = prev.scene.synopsis.plain;
          const joined = cur ? `${cur}\n${body}` : body;
          prev.scene.synopsis = { plain: joined, runs: [{ text: joined, attrs: {} }], embeds: [] };
          for (const n of allNotes) b.addNote(prev.id, notes[n] ?? '');
        } else emit(S('synopsis'), inline(body), allNotes);
        return;
      }
      case 'lyrics': {
        const body = texts.map((t) => t.trimStart().replace(/^~\s?/, '')).join('\n');
        emit(S('lyrics'), inline(body), allNotes);
        return;
      }
      case 'forcedAction': {
        const body = [first.replace(/^!/, ''), ...texts.slice(1)].join('\n');
        emit(S('action'), inline(body.replace(/\t/g, '    ')), allNotes);
        return;
      }
      case 'forcedHeading':
      case 'heading': {
        let head = kind === 'forcedHeading' ? first.slice(1) : first;
        let numberText: string | null = null;
        const nm = /\s*#([A-Za-z0-9.\-]+)#\s*$/.exec(head);
        if (nm) { numberText = nm[1]!; head = head.slice(0, nm.index); }
        emit(S('sceneHeading'), inline(head.trim()), noteIds(0), numberText
          ? { num: { label: parseNumberLabel(numberText), locked: false, manual: true } } : {});
        if (texts.length > 1) emit(S('action'), inline(texts.slice(1).join('\n').replace(/\t/g, '    ')), real.slice(1).flatMap((l) => l.notes));
        return;
      }
      case 'centered': {
        const m = CENTERED_RE.exec(first)!;
        emit(S('action'), inline(m[1]!), allNotes, { ov: { align: 'center' } });
        return;
      }
      case 'forcedTransition':
        emit(S('transition'), inline(first.replace(/^>\s*/, '')), allNotes);
        return;
      case 'transition':
        emit(S('transition'), inline(first), allNotes);
        return;
      case 'forcedCharacter':
      case 'character': {
        let name = kind === 'forcedCharacter' ? first.slice(1).trim() : first.trim();
        let dualRight = false;
        if (/\s*\^$/.test(name)) { dualRight = true; name = name.replace(/\s*\^$/, ''); }
        const startIdx = b.json.elements.length;
        const runs = [inline(name)];
        emit(S('character'), runs[0]!, noteIds(0));
        // Dialogue block: parentheticals, dialogue paragraphs (two-space lines separate paragraphs).
        let dialogue: string[] = [];
        let dialogueNotes: number[] = [];
        const flushDialogue = () => {
          if (dialogue.length) emit(S('dialogue'), inline(dialogue.join('\n')), dialogueNotes);
          dialogue = [];
          dialogueNotes = [];
        };
        for (let k = 1; k < real.length; k++) {
          if (real[k]!.t === '  ') { flushDialogue(); continue; }
          const tl = texts[k]!.trim();
          if (/^\(.*\)$/.test(tl)) { flushDialogue(); emit(S('parenthetical'), inline(tl), real[k]!.notes); }
          else { dialogue.push(tl); dialogueNotes.push(...real[k]!.notes); }
        }
        flushDialogue();
        if (dualRight) {
          if (lastCharStart >= 0 && lastBlockEnd === startIdx) {
            const group = b.newDualGroup();
            for (let k = lastCharStart; k < startIdx; k++) b.json.elements[k]!.dual = { group: group as never, side: 'left' };
            for (let k = startIdx; k < b.json.elements.length; k++) b.json.elements[k]!.dual = { group: group as never, side: 'right' };
          } else report.warn('FOUNTAIN_DUAL_NO_PARTNER', 'dual_dialogue', 'A dual dialogue marker (^) had no preceding dialogue block; it was read as single dialogue.');
        } else lastCharStart = startIdx;
        lastBlockEnd = b.json.elements.length;
        return;
      }
      default: {
        // Action: keep every line; tabs become four spaces.
        const body = texts.join('\n').replace(/\t/g, '    ');
        emit(S('action'), inline(body), allNotes);
      }
    }
  };

  // Group lines into blocks separated by blank lines. A line of exactly two spaces continues a dialogue block.
  let block: Line[] = [];
  let inDialogue = false;
  const endBlock = () => { if (block.length) flushBlock(block); block = []; inDialogue = false; };
  for (; i < lines.length; i++) {
    const ln = lines[i]!;
    const blank = ln.t.trim() === '' && !ln.markerOnly;
    if (blank) {
      if (inDialogue && /^ {2}$/.test(ln.t) && block.length > 0) { block.push(ln); continue; }
      endBlock();
      continue;
    }
    block.push(ln);
    if (block.length === 2 && !ln.markerOnly) {
      const kind = classifyBlock(block.filter((l) => !l.markerOnly).map((l) => l.t));
      inDialogue = kind === 'character' || kind === 'forcedCharacter';
    }
  }
  endBlock();

  // Boneyard becomes Bin items anchored to the element that followed it.
  const allBones = new Map<number, number>();
  for (const q of boneQueue) allBones.set(q.boneIdx, q.elementIndex);
  boneyards.forEach((body, idx) => {
    const anchor = b.json.elements[allBones.get(idx) ?? b.json.elements.length - 1];
    const prev = b.json.bin[b.json.bin.length - 1]?.pos ?? null;
    const content = b.makeElement(S('action'), textFromRuns([{ text: body.trim() }]));
    b.json.bin.push({
      id: `bin_${content.id.slice(3)}` as never, pos: positionBetween(prev, null, null), title: 'Boneyard', createdBy: b.uid, createdAt: b.now,
      source: { elementIds: anchor ? [anchor.id] : [], sceneId: null }, content: [content],
    });
  });
  if (boneyards.length) report.info('FOUNTAIN_BONEYARD', 'unknown_content', 'Boneyard text was moved to the Bin.');
  if (/\{\{[\s\S]*?\}\}/.test(src)) report.warn('FOUNTAIN_BEAT_TAGS', 'unknown_content', '{{...}} (Beat tags) were kept as literal text.');
  if (b.json.notes.length) report.info('FOUNTAIN_NOTES', 'notes', 'Notes ([[...]]) became script notes anchored to their element.');

  const document = b.finish({ source: 'fountain', fileName: options.fileName, unknown: Object.keys(extras).length ? { titleExtras: extras } : {} });
  return {
    document,
    report: report.build({ elements: document.elements.length, scenes: b.countScenes() }, { sourceVersion: '1.1' }),
  };
}
