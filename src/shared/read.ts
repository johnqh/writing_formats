import {
  assignNumbers, createSeededIdSource, materializeDocument, openDocument, resolveStyle, type DocumentJSON, type ElementJSON, type StyleRole,
} from '@sudobility/writing_core';
import { formatNumberLabel } from './build.js';
import type { ReportBuilder } from '../report.js';
import type { FormatId } from '../types.js';

/** Read helpers over a `DocumentJSON` used by every exporter. */
export class DocReader {
  private readonly roleCache = new Map<string, StyleRole>();
  private readonly capsCache = new Map<string, boolean>();
  constructor(readonly doc: DocumentJSON) {}

  roleOf(el: ElementJSON): StyleRole {
    let r = this.roleCache.get(el.style);
    if (!r) {
      r = this.doc.template.styles.find((s) => s.id === el.style)?.role ?? 'normal';
      this.roleCache.set(el.style, r);
    }
    return r;
  }

  styleName(el: ElementJSON): string {
    return this.doc.template.styles.find((s) => s.id === el.style)?.name ?? 'Action';
  }

  allCaps(el: ElementJSON): boolean {
    let c = this.capsCache.get(el.style);
    if (c === undefined) {
      try { c = resolveStyle(this.doc.template, el.style as never).allCaps; } catch { c = false; }
      this.capsCache.set(el.style, c);
    }
    return c;
  }

  outlineLevel(el: ElementJSON): number {
    const lvl = this.doc.template.styles.find((s) => s.id === el.style)?.outlineLevel;
    return Math.min(Math.max(lvl ?? 1, 1), 3);
  }

  align(el: ElementJSON): string | undefined {
    return el.ov?.align;
  }

  notesFor(elementId: string): string[] {
    return this.doc.notes
      .filter((n) => (n.anchor.kind === 'element' || n.anchor.kind === 'scene') && n.anchor.elementId === elementId)
      .map((n) => n.body.plain);
  }

  scenes(): number {
    return this.doc.elements.filter((e) => this.roleOf(e) === 'sceneHeading').length;
  }
}

const KEPT_MARKS = new Set(['b', 'i', 'u', 's']);

/** Records, as `loss` diagnostics, model features a thin writer cannot carry. */
export function scanExportLosses(r: DocReader, report: ReportBuilder, opts: { format: FormatId; keepNotes: boolean; keepStrike: boolean }): void {
  const d = r.doc;
  const marks = new Set<string>();
  let alts = 0, tc = 0, embeds = 0;
  for (const el of [...d.elements, ...d.titlePage.elements]) {
    if (el.alts?.length) alts++;
    if (el.tc) tc++;
    if (el.text.embeds.length) embeds += el.text.embeds.length;
    for (const run of el.text.runs) for (const k of Object.keys(run.attrs)) if (!KEPT_MARKS.has(k)) marks.add(k);
    if (!opts.keepStrike && el.text.runs.some((x) => x.attrs.s)) marks.add('s');
  }
  const F = opts.format.toUpperCase();
  if (marks.size) report.loss(`${F}_MARKS_DROPPED`, 'formatting', `Inline formatting other than bold, italic and underline was dropped (${[...marks].join(', ')}).`);
  if (alts) report.loss(`${F}_ALTERNATES`, 'alternates', 'Alternate dialogue is not written.');
  if (tc) report.loss(`${F}_TRACK_CHANGES`, 'track_changes', 'Tracked changes are written as plain text.');
  if (embeds) report.loss(`${F}_EMBEDS`, 'revisions', 'Embedded images and revision deletions are not written.');
  if (d.revisions.sets.length && d.revisions.activeSetId) report.loss(`${F}_REVISIONS`, 'revisions', 'Revision sets and colours are not written.');
  if (d.tags.length) report.loss(`${F}_TAGS`, 'tags', 'Tags are not written.');
  if (d.production.pagesLocked || d.production.pageLocks.length) report.loss(`${F}_PAGE_LOCKS`, 'locking', 'Locked pages and A pages are not written; the file paginates freely.');
  if (d.production.scenesLocked) report.info(`${F}_SCENE_LOCKS`, 'locking', 'Locked scene numbers (including A-numbers such as 12A) are written as fixed numbers; the locked flag itself is not.');
  if (d.beats.length) report.loss(`${F}_BEAT_BOARD`, 'beat_board', 'Beat Board content is not written.');
  if (d.notes.some((n) => n.replies.length)) report.loss(`${F}_NOTE_REPLIES`, 'notes', 'Note replies are not written.');
  if (!opts.keepNotes && d.notes.length) report.loss(`${F}_NOTES`, 'notes', 'Notes are not written.');
  if (d.notes.some((n) => n.anchor.kind === 'range' || n.anchor.kind === 'document' || n.anchor.kind === 'beat')) {
    report.loss(`${F}_NOTE_ANCHORS`, 'notes', 'Notes not anchored to a whole element are not written.');
  }
}

/**
 * Scene number text per element id, as the layout engine would show it (auto numbers included, omitted scenes keep their slot).
 * Empty when scene numbering is not enabled for the scene heading style, so exporters only write numbers the writer sees.
 */
export function sceneNumberLabels(doc: DocumentJSON): Map<string, string> {
  const out = new Map<string, string>();
  const t = doc.template;
  const style = t.styles.find((s) => s.id === t.sceneNumbering.styleId);
  if (!style?.numbering?.enabled) return out;
  const ids = createSeededIdSource(7);
  const ydoc = materializeDocument(doc, { preserveIds: true, ids });
  try {
    const model = openDocument(ydoc, { ids, clock: () => 0, locale: 'en' });
    for (const [id, a] of assignNumbers(model).labels) {
      if (a.label.custom === '') continue;
      const text = formatNumberLabel(a.label);
      if (text) out.set(String(id), text);
    }
    model.dispose();
  } finally {
    ydoc.destroy();
  }
  return out;
}
