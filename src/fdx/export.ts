import { parseTokenString, resolveStyle, type DocumentJSON, type ElementJSON, type TextJSON } from '@sudobility/writing_core';
import { formatNumberLabel, runsFromText, type Run } from '../shared/build.js';
import { DocReader, sceneNumberLabels, scanExportLosses } from '../shared/read.js';
import { FDX_LABEL_TOKENS } from './import.js';
import { escapeAttr, escapeXml, stripXmlIllegal } from '../shared/xml.js';
import { ReportBuilder } from '../report.js';
import type { FdxExportResult } from '../types.js';

const TYPE_BY_ROLE: Partial<Record<string, string>> = {
  normal: 'General', sceneHeading: 'Scene Heading', action: 'Action', character: 'Character', parenthetical: 'Parenthetical',
  dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot', lyrics: 'Lyrics', castList: 'Cast List', actStart: 'New Act',
  actEnd: 'End of Act', sequence: 'Sequence', synopsis: 'Summary', note: 'Note',
};

const FD_FONT: Record<string, string> = {
  'courier-screenplay': 'Courier Final Draft', 'courier-new': 'Courier New', mono: 'Courier New', times: 'Times New Roman',
  serif: 'Times New Roman', arial: 'Arial', sans: 'Arial', calibri: 'Calibri', cambria: 'Cambria', georgia: 'Georgia',
};

const ALIGN_ATTR: Record<string, string> = { left: 'Left', center: 'Center', right: 'Right', justify: 'Full' };

export function exportFdx(document: DocumentJSON): FdxExportResult {
  const report = new ReportBuilder('export', 'fdx');
  const r = new DocReader(document);
  scanExportLosses(r, report, { format: 'fdx', keepNotes: true, keepStrike: true });
  const customTypes = new Set<string>();
  const sceneNums = sceneNumberLabels(document);

  const fontOf = (el: ElementJSON, titlePage: boolean): { font: string; size: number; upper: boolean; underline: boolean } => {
    try {
      const st = resolveStyle(document.template, el.style as never);
      return { font: FD_FONT[st.font.family] ?? 'Courier Final Draft', size: st.font.size, upper: titlePage && st.allCaps, underline: titlePage && st.font.underline !== null };
    } catch {
      return { font: 'Courier Final Draft', size: 12, upper: false, underline: false };
    }
  };

  const textXml = (text: TextJSON, f: { font: string; size: number; upper: boolean; underline: boolean }): string => {
    const runs: Run[] = runsFromText(text);
    if (runs.length === 0) return `<Text Font="${escapeAttr(f.font)}" Size="${f.size}"></Text>`;
    return runs
      .map((run) => {
        const toks: string[] = [];
        if (run.b) toks.push('Bold');
        if (run.i) toks.push('Italic');
        if (run.u || f.underline) toks.push('Underline');
        if (run.s) toks.push('Strikeout');
        const t = stripXmlIllegal(f.upper ? run.text.toUpperCase() : run.text);
        return `<Text Font="${escapeAttr(f.font)}" Size="${f.size}" Style="${toks.join('+')}">${escapeXml(t)}</Text>`;
      })
      .join('');
  };

  let noteId = 0;
  const paragraphXml = (el: ElementJSON, indent: string): string => {
    const role = r.roleOf(el);
    let type = TYPE_BY_ROLE[role];
    if (role === 'outline') type = `Outline ${r.outlineLevel(el)}`;
    if (!type) { type = r.styleName(el); customTypes.add(type); }
    const attrs = [`Type="${escapeAttr(type)}"`];
    const num = sceneNums.get(el.id) ?? (el.num ? formatNumberLabel(el.num.label) : undefined);
    if (num) attrs.push(`Number="${escapeAttr(num)}"`);
    if (el.ov?.align) attrs.push(`Alignment="${ALIGN_ATTR[el.ov.align] ?? 'Left'}"`);
    if (el.ov?.pageBreakBefore) attrs.push('StartsNewPage="Yes"');
    let inner = '';
    if (role === 'sceneHeading' && el.scene?.title) inner += `<SceneProperties Length="" Page="" Title="${escapeAttr(el.scene.title)}"/>`;
    for (const n of document.notes) {
      if ((n.anchor.kind === 'element' || n.anchor.kind === 'scene') && n.anchor.elementId === el.id) {
        noteId++;
        inner += `<ScriptNote ID="${noteId}" Author="" Color="#FFFF00000000" DateTime="" DateModified="" Name="${escapeAttr(n.title)}" Type=""><Paragraph Type="Action"><Text>${escapeXml(stripXmlIllegal(n.body.plain))}</Text></Paragraph></ScriptNote>`;
      }
    }
    inner += textXml(el.text, fontOf(el, false));
    return `${indent}<Paragraph ${attrs.join(' ')}>${inner}</Paragraph>`;
  };

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>');
  out.push('<FinalDraft DocumentType="Script" Template="No" Version="6">');
  out.push('  <Content>');
  const els = document.elements;
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!;
    if (el.dual) {
      const group = el.dual.group;
      let j = i;
      const inner: string[] = [];
      while (j < els.length && els[j]!.dual?.group === group) { inner.push(paragraphXml(els[j]!, '        ')); j++; }
      out.push('    <Paragraph>', '      <DualDialogue>', ...inner, '      </DualDialogue>', '    </Paragraph>');
      i = j - 1;
    } else out.push(paragraphXml(el, '    '));
  }
  out.push('  </Content>');

  // Header and footer: one paragraph per non-empty slot; the slot becomes the paragraph alignment.
  const REVERSE_LABELS = new Map(Object.entries(FDX_LABEL_TOKENS).map(([label, tok]) => [tok, label]));
  const titleText = (field: string) => {
    const id = document.titlePage.fields[field as keyof typeof document.titlePage.fields];
    return document.titlePage.elements.find((e) => e.id === id)?.text.plain.split('\n')[0] ?? '';
  };
  const hfParagraphs = (kind: 'header' | 'footer'): string[] => {
    const spec = document.template[kind];
    const paras: string[] = [];
    for (const slot of ['left', 'center', 'right'] as const) {
      const src = spec.enabled ? spec[slot] : '';
      if (!src) continue;
      let inner = '';
      for (const node of parseTokenString(src)) {
        if (node.kind === 'literal') inner += `<Text>${escapeXml(stripXmlIllegal(node.text))}</Text>`;
        else if (node.kind === 'token') {
          const name = node.name.toLowerCase();
          const label = REVERSE_LABELS.get(`{${name}}`);
          if (label) inner += `<DynamicLabel Type="${escapeAttr(label)}"/>`;
          else if (name === 'title' || name === 'draft' || name === 'field') {
            const field = name === 'field' ? node.args[0] ?? '' : name === 'draft' ? 'draftDate' : 'title';
            inner += `<Text>${escapeXml(stripXmlIllegal(titleText(field)))}</Text>`;
            report.info('FDX_HEADER_STATIC', 'headers_footers', 'Title-page tokens in headers and footers were written as their current text.');
          } else report.warn('FDX_HEADER_TOKEN', 'headers_footers', `Header/footer token {${node.name}} has no Final Draft equivalent and was dropped.`);
        } else report.warn('FDX_HEADER_TOKEN', 'headers_footers', 'Conditional header/footer text was dropped.');
      }
      paras.push(`        <Paragraph Alignment="${ALIGN_ATTR[slot]}">${inner || '<Text/>'}</Paragraph>`);
    }
    return paras;
  };
  const hdr = hfParagraphs('header');
  const ftr = hfParagraphs('footer');
  const tplH = document.template.header, tplF = document.template.footer;
  out.push(
    `  <HeaderAndFooter FooterFirstPage="${tplF.showOnFirstPage ? 'Yes' : 'No'}" FooterVisible="${ftr.length ? 'Yes' : 'No'}" HeaderFirstPage="${tplH.showOnFirstPage ? 'Yes' : 'No'}" HeaderVisible="${hdr.length ? 'Yes' : 'No'}" StartingPage="${tplH.startAtPage}">`,
    '    <Header>', ...(hdr.length ? hdr : ['        <Paragraph><Text/></Paragraph>']), '    </Header>',
    '    <Footer>', ...(ftr.length ? ftr : ['        <Paragraph><Text/></Paragraph>']), '    </Footer>',
    '  </HeaderAndFooter>',
  );

  if (document.titlePage.elements.some((e) => e.text.plain.trim())) {
    out.push('  <TitlePage>', '    <Content>');
    for (const el of document.titlePage.elements) {
      if (el.field && el.text.plain.trim() === '') continue; // an unfilled field prints nothing
      const st = document.template.titlePageStyles.find((s) => s.id === el.style);
      const align = el.ov?.align ?? st?.align ?? 'left';
      // Final Draft has no vertical positioning: leading space becomes blank paragraphs.
      const lead = Math.min(el.ov?.spaceBefore ?? 0, 30);
      for (let k = 0; k < lead; k++) out.push(`      <Paragraph Alignment="${ALIGN_ATTR[align] ?? 'Left'}"><Text/></Paragraph>`);
      out.push(`      <Paragraph Alignment="${ALIGN_ATTR[align] ?? 'Left'}">${textXml(el.text, fontOf(el, true))}</Paragraph>`);
    }
    out.push('    </Content>', '  </TitlePage>');
  }
  out.push('</FinalDraft>');

  report.info('FDX_NO_ELEMENT_SETTINGS', 'styles', 'ElementSettings were not written; Final Draft applies its own element formatting.');
  if (customTypes.size) report.warn('FDX_CUSTOM_TYPES', 'styles', `Styles with no Final Draft element type were written under their own names (${[...customTypes].join(', ')}).`);
  if (els.some((e) => e.ov && (e.ov.indentLeft !== undefined || e.ov.indentRight !== undefined || e.ov.spaceBefore !== undefined))) {
    report.loss('FDX_OVERRIDES', 'page_layout', 'Per-element indent and spacing overrides were not written.');
  }
  return { xml: `${out.join('\n')}\n`, report: report.build({ elements: els.length, scenes: r.scenes() }, { sourceVersion: '6' }) };
}
