import {
  createSeededIdSource, materializeDocument, validateDocument, type DocumentJSON,
} from '@sudobility/writing_core';

/** The comparable shape of an element sequence: style, text, marks, number, dual side, alignment, page break. */
export function elementSequence(doc: DocumentJSON) {
  return doc.elements.map((e) => ({
    style: e.style,
    text: e.text.plain,
    marks: e.text.runs.map((r) => `${r.text}|${Object.keys(r.attrs).sort().join(',')}`),
    num: e.num ? `${e.num.label.prefix.length}:${e.num.label.base}:${e.num.label.suffix.length}:${e.num.label.custom ?? ''}` : null,
    dual: e.dual ? e.dual.side : null,
    align: e.ov?.align ?? null,
    pageBreak: e.ov?.pageBreakBefore ?? false,
    synopsis: e.scene?.synopsis.plain ?? null,
  }));
}

export function validate(doc: DocumentJSON) {
  const ydoc = materializeDocument(doc, { preserveIds: true, ids: createSeededIdSource(7) });
  const { issues } = validateDocument(ydoc);
  ydoc.destroy();
  return issues.map((i) => `${i.code} ${i.severity}: ${i.message}`);
}

import { createSeededIdSource as seeded, layoutDocument, openDocument } from '@sudobility/writing_core';

/** Lays a document out with writing_core's engine and returns page count and diagnostic count. */
export function layoutPages(doc: DocumentJSON): { pages: number; diagnostics: number } {
  const ids = seeded(11);
  const ydoc = materializeDocument(doc, { preserveIds: true, ids });
  const model = openDocument(ydoc, { ids, clock: () => 0, locale: 'en' });
  const layout = layoutDocument(model);
  const out = { pages: layout.pages.length, diagnostics: layout.diagnostics.length };
  ydoc.destroy();
  return out;
}
