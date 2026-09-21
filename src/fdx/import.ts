import { roleForImportedStyle, type ElementJSON, type StyleRole, type TitleField } from '@sudobility/writing_core';
import { DocBuilder, parseNumberLabel, textFromRuns, type Run } from '../shared/build.js';
import { child, childrenNamed, parseXml, type XNode } from '../shared/xml.js';
import { ReportBuilder } from '../report.js';
import { FormatError, type ImportOptions, type ImportResult } from '../types.js';

const BUILTIN_ROLES: Record<string, StyleRole> = {
  general: 'normal', 'scene heading': 'sceneHeading', action: 'action', character: 'character', parenthetical: 'parenthetical',
  dialogue: 'dialogue', transition: 'transition', shot: 'shot', 'cast list': 'castList', 'new act': 'actStart', 'end of act': 'actEnd',
  sequence: 'sequence', summary: 'synopsis', note: 'note', singing: 'lyrics', lyrics: 'lyrics',
};

/** Top-level FDX sections that carry data this slice does not import, with the feature they belong to. */
const IGNORED_SECTIONS: Record<string, { feature: 'headers_footers' | 'smarttype' | 'watermark' | 'macros' | 'table_read' | 'beat_board' | 'dictionaries' | 'unknown_content' | 'page_layout'; label: string; severity: 'info' | 'loss' }> = {
  SmartType: { feature: 'smarttype', label: 'SmartType lists', severity: 'info' },
  Watermarking: { feature: 'watermark', label: 'watermark settings', severity: 'loss' },
  Macros: { feature: 'macros', label: 'macros', severity: 'loss' },
  Actors: { feature: 'table_read', label: 'table read actors', severity: 'loss' },
  Cast: { feature: 'table_read', label: 'table read cast', severity: 'loss' },
  DisplayBoards: { feature: 'beat_board', label: 'Beat Board view state', severity: 'loss' },
  Lanes: { feature: 'beat_board', label: 'outline lanes', severity: 'loss' },
  SpellCheckIgnoreLists: { feature: 'dictionaries', label: 'spell-check ignore lists', severity: 'info' },
  PageLayout: { feature: 'page_layout', label: 'page layout (the template geometry is used)', severity: 'info' },
  MoresAndContinueds: { feature: 'page_layout', label: 'MORE/CONT\'D settings', severity: 'info' },
  SceneNumberOptions: { feature: 'scene_numbers', label: 'scene number display options', severity: 'info' } as never,
};

/** FDX header/footer DynamicLabel types to spec 02 §20.2 tokens (the table there, run backwards). */
export const FDX_LABEL_TOKENS: Record<string, string> = {
  'Page #': '{page}', Date: '{date}', Scene: '{scene.heading}', Label: '{label}', 'Active Revision': '{revision.active}',
  'Collated Revisions': '{revision.collated}', 'File Name': '{filename}', 'Last Revised': '{lastRevised}',
};

const CREDIT_RE = /^(written|screenplay|teleplay|story|adapted|prepared)\b.*\b(by|for)\b|^by$/i;
const CONTACT_RE = /@|\b\d{3}[-.\s]\d{3,4}\b|\bstreet\b|\bst\.\b|\bave\b|agency|management|entertainment/i;
const DRAFT_RE = /^(draft|revised|revision|first|second|final|shooting|production)\b.*|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/i;
const COPYRIGHT_RE = /^(copyright|©|\(c\))/i;

interface Made { el: ElementJSON; role: StyleRole }

export function importFdx(xml: string, options: ImportOptions = {}): ImportResult {
  const report = new ReportBuilder('import', 'fdx');
  let root: XNode;
  try { root = parseXml(xml); } catch (e) { throw new FormatError('FORMAT_CORRUPT', `Not well-formed XML: ${(e as Error).message}`); }
  if (root.name !== 'FinalDraft') throw new FormatError('FORMAT_UNRECOGNIZED', 'Root element is not <FinalDraft>.');
  const b = new DocBuilder(options);
  const version = root.attrs.Version ?? '';
  if (root.attrs.DocumentType && root.attrs.DocumentType !== 'Script') report.warn('FDX_DOCUMENT_TYPE', 'metadata', `DocumentType "${root.attrs.DocumentType}" was imported as a script.`);
  if (root.attrs.Template === 'Yes') report.warn('FDX_TEMPLATE', 'metadata', 'This is a Final Draft template; only its content was imported.');

  const resolveStyle = (type: string | undefined, where: number): string => {
    const name = (type ?? 'Action').trim();
    const direct = b.styleByName(name);
    if (direct) return direct.id;
    const lower = name.toLowerCase();
    let role: StyleRole | undefined = BUILTIN_ROLES[lower];
    if (!role) {
      const r = roleForImportedStyle({ name, builtinIndex: null, actBreak: false, baseRole: null });
      if (r.role !== 'normal') role = r.role;
    }
    if (!role) {
      report.warn('FDX_UNKNOWN_TYPE', 'styles', 'Paragraph types with no matching style were imported as Action.', { elementIndex: where });
      return b.styleForRole('action').id;
    }
    if (role === 'outline') return b.styleForRole('outline', Number(/(\d)$/.exec(lower)?.[1] ?? '1')).id;
    return b.styleForRole(role).id;
  };

  const readRuns = (p: XNode): Run[] => {
    const runs: Run[] = [];
    for (const t of childrenNamed(p, 'Text')) {
      const run: Run = { text: t.text };
      const tokens = (t.attrs.Style ?? '').split('+').map((x) => x.trim().toLowerCase()).filter(Boolean);
      for (const tok of tokens) {
        if (tok === 'bold') run.b = true;
        else if (tok === 'italic') run.i = true;
        else if (tok === 'underline') run.u = true;
        else if (tok === 'strikeout' || tok === 'strikethrough') run.s = true;
        else if (tok === 'allcaps' || tok === 'smallcaps' || tok === 'subscript' || tok === 'superscript' || tok === 'hidden') {
          report.loss('FDX_RUN_STYLE', 'formatting', 'Run styles AllCaps, SmallCaps, Subscript, Superscript and Hidden were dropped.');
        }
      }
      if (t.attrs.RevisionID && t.attrs.RevisionID !== '0') report.loss('FDX_REVISION_MARKS', 'revisions', 'Revision marks on text runs were dropped (the text is kept).');
      if (t.attrs.TagNumber) report.loss('FDX_TAG_MARKS', 'tags', 'Tag marks on text runs were dropped.');
      runs.push(run);
    }
    return runs;
  };

  const alignOf = (a: string | undefined): 'left' | 'center' | 'right' | 'justify' | undefined => {
    switch ((a ?? '').toLowerCase()) {
      case 'center': case 'centered': return 'center';
      case 'right': return 'right';
      case 'full': case 'justify': return 'justify';
      default: return undefined;
    }
  };

  const made: Made[] = [];
  const readParagraph = (p: XNode, dualGroup: { id: string; rightStarted: boolean; leftChars: number } | null): void => {
    const dual = child(p, 'DualDialogue');
    if (dual) {
      const group = { id: b.newDualGroup(), rightStarted: false, leftChars: 0 };
      for (const inner of childrenNamed(dual, 'Paragraph')) readParagraph(inner, group);
      return;
    }
    const styleId = resolveStyle(p.attrs.Type, b.json.elements.length);
    const role = b.roleOfStyle(styleId);
    const extra: Partial<ElementJSON> = {};
    const ov: NonNullable<ElementJSON['ov']> = {};
    const al = alignOf(p.attrs.Alignment);
    if (al) ov.align = al;
    if (p.attrs.StartsNewPage === 'Yes') ov.pageBreakBefore = true;
    if (Object.keys(ov).length) extra.ov = ov;
    if (p.attrs.Number) extra.num = { label: parseNumberLabel(p.attrs.Number), locked: false, manual: true };
    if (dualGroup) {
      if (role === 'character') {
        if (dualGroup.leftChars >= 1) dualGroup.rightStarted = true;
        dualGroup.leftChars++;
      }
      extra.dual = { group: dualGroup.id as never, side: dualGroup.rightStarted ? 'right' : 'left' };
    }
    const el = b.makeElement(styleId, textFromRuns(readRuns(p)), extra);
    const sp = child(p, 'SceneProperties');
    if (sp && el.scene) {
      if (sp.attrs.Title) el.scene.title = sp.attrs.Title;
      if (sp.attrs.Color) report.info('FDX_SCENE_COLOR', 'metadata', 'Scene colours were not imported.');
    }
    if (child(p, 'SceneArcBeats')) report.loss('FDX_ARC_BEATS', 'entities', 'Character arc beats were dropped.');
    b.add(el);
    made.push({ el, role });
    for (const n of childrenNamed(p, 'ScriptNote')) {
      const body = childrenNamed(n, 'Paragraph').map((np) => childrenNamed(np, 'Text').map((t) => t.text).join('')).join('\n').trim();
      b.addNote(el.id, body, n.attrs.Name ?? '');
    }
    if (p.attrs.FirstIndent || p.attrs.LeftIndent || p.attrs.RightIndent || p.attrs.SpaceBefore || p.attrs.Spacing) {
      report.info('FDX_PARAGRAPH_LAYOUT', 'page_layout', 'Per-paragraph indents and spacing were not imported; template styles are used.');
    }
  };

  const content = child(root, 'Content');
  if (!content) report.warn('FDX_NO_CONTENT', 'unknown_content', 'The file has no <Content> element.');
  else {
    for (const c of content.children) {
      if (c.name === 'Paragraph') readParagraph(c, null);
      else if (c.name === 'DualDialogue') {
        const group = { id: b.newDualGroup(), rightStarted: false, leftChars: 0 };
        for (const inner of childrenNamed(c, 'Paragraph')) readParagraph(inner, group);
      }
    }
  }

  // Title page: free-form paragraphs, kept in order; fields are guessed.
  const tp = child(root, 'TitlePage');
  const tpParas = tp ? childrenNamed(child(tp, 'Content') ?? tp, 'Paragraph') : [];
  if (tpParas.length) {
    let stage: 'title' | 'credit' | 'author' | 'rest' = 'title';
    const have = new Set<TitleField>();
    for (const p of tpParas) {
      const runs = readRuns(p);
      const text = runs.map((r) => r.text).join('').trim();
      const al = alignOf(p.attrs.Alignment) ?? (p.attrs.Alignment?.toLowerCase() === 'left' ? 'left' : undefined);
      const align = al === 'center' || al === 'right' ? al : 'left';
      let field: TitleField | undefined;
      if (text) {
        if (stage === 'title' && align === 'center') { field = 'title'; stage = 'credit'; }
        else if (stage === 'credit' && CREDIT_RE.test(text)) { field = 'credit'; stage = 'author'; }
        else if (stage === 'author' && align === 'center') { field = 'author'; stage = 'rest'; }
        else if (COPYRIGHT_RE.test(text)) field = 'copyright';
        else if (CONTACT_RE.test(text)) field = 'contact';
        else if (DRAFT_RE.test(text)) field = 'draftDate';
        if (field && have.has(field)) field = undefined;
        if (field) have.add(field);
      }
      b.addTitleElement(b.titleStyleFor(null, align), textFromRuns(runs), field);
    }
    if (have.size) report.warn('FDX_TITLE_FIELDS_GUESSED', 'title_page', 'Title page fields (title, credit, author, contact, draft, copyright) were guessed from position and wording; check them.');
  }

  // Header and footer: paragraphs of literal text and DynamicLabels; the paragraph alignment picks the slot.
  const hfNode = child(root, 'HeaderAndFooter');
  if (hfNode) {
    const tpl = b.json.template;
    const start = Number(hfNode.attrs.StartingPage);
    for (const kind of ['Header', 'Footer'] as const) {
      const spec = kind === 'Header' ? tpl.header : tpl.footer;
      const node = child(hfNode, kind);
      spec.left = spec.center = spec.right = '';
      for (const p of node ? childrenNamed(node, 'Paragraph') : []) {
        let text = '';
        for (const c of p.children) {
          if (c.name === 'Text') text += c.text.replace(/[{}]/g, (ch) => ch + ch);
          else if (c.name === 'DynamicLabel') {
            const tok = FDX_LABEL_TOKENS[c.attrs.Type ?? ''];
            if (tok) text += tok;
            else report.warn('FDX_HEADER_LABEL', 'headers_footers', `Header/footer label "${c.attrs.Type ?? ''}" has no equivalent and was dropped.`);
          }
        }
        if (text.trim() === '') continue;
        const slot = alignOf(p.attrs.Alignment) === 'center' ? 'center' : alignOf(p.attrs.Alignment) === 'right' ? 'right' : 'left';
        spec[slot] = spec[slot] ? `${spec[slot]} ${text}` : text;
      }
      const visible = hfNode.attrs[`${kind}Visible`] !== 'No';
      spec.enabled = visible && (spec.left !== '' || spec.center !== '' || spec.right !== '');
      spec.showOnFirstPage = hfNode.attrs[`${kind}FirstPage`] === 'Yes';
      if (Number.isFinite(start) && start >= 1) spec.startAtPage = start;
    }
  }

  // Sections whose data is not imported: say so instead of dropping silently.
  const revs = child(root, 'Revisions');
  if (revs && childrenNamed(revs, 'Revision').length) report.loss('FDX_REVISION_SETS', 'revisions', 'Revision sets and colours were not imported.');
  const locks = child(root, 'LockedPages');
  if (locks && locks.children.length) report.loss('FDX_LOCKED_PAGES', 'locking', 'Locked pages were not imported.');
  const tagData = child(root, 'TagData');
  if (tagData && tagData.children.some((c) => c.children.length)) report.loss('FDX_TAG_DATA', 'tags', 'Tag categories and definitions were not imported.');
  const sn = child(root, 'ScriptNotes');
  if (sn && sn.children.length) report.loss('FDX_RANGE_NOTES', 'notes', 'Notes anchored to character ranges were not imported (inline element notes were).');
  const usn = child(root, 'UnanchoredScriptNotes');
  if (usn && usn.children.length) report.loss('FDX_UNANCHORED_NOTES', 'notes', 'Document-level notes were not imported.');
  const alt = child(root, 'AltCollection');
  if (alt && alt.children.length) report.loss('FDX_ALTERNATES', 'alternates', 'Alternate dialogue was not imported.');
  const imgs = child(root, 'Images');
  if (imgs && imgs.children.length) report.loss('FDX_IMAGES', 'images', 'Embedded images were not imported.');
  if (child(root, 'Writers')?.children.length || child(root, 'WriterMarkup')) report.loss('FDX_TRACK_CHANGES', 'track_changes', 'Track Changes writers and markup were not imported.');
  for (const [name, info] of Object.entries(IGNORED_SECTIONS)) {
    const node = child(root, name);
    if (node && (node.children.length || Object.keys(node.attrs).length)) {
      report.add(info.severity, `FDX_${name.toUpperCase()}`, info.feature, `${info.label[0]!.toUpperCase()}${info.label.slice(1)} ${info.severity === 'info' ? 'were not imported' : 'were dropped'}.`);
    }
  }
  const settings = childrenNamed(root, 'ElementSettings');
  if (settings.length) report.info('FDX_ELEMENT_SETTINGS', 'styles', 'ElementSettings (fonts, indents, spacing per element type) were not applied; the template styles are used.');

  const document = b.finish({ source: 'fdx', fileName: options.fileName, fdxVersion: version || undefined });
  return { document, report: report.build({ elements: document.elements.length, scenes: b.countScenes() }, { sourceVersion: version || undefined }) };
}
