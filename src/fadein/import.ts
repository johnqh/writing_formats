import { strFromU8, unzipSync } from 'fflate';
import {
  BUILTIN_SLOT_ROLES, newId, roleForImportedStyle, type ElementJSON, type StyleDef, type StyleRole, type TitleField,
} from '@sudobility/writing_core';
import { DocBuilder, parseNumberLabel, textFromRuns, type Run } from '../shared/build.js';
import { child, childrenNamed, parseXml, type XNode } from '../shared/xml.js';
import { ReportBuilder } from '../report.js';
import { FormatError, type ImportOptions, type ImportResult } from '../types.js';

/** Highest OSF version this reader has seen real files for. */
export const FADEIN_KNOWN_VERSION = 50;
const EMU_PER_OSF_UNIT = 3600;

/** Lowercases and drops underscores so v1.2 snake_case, v2 camelCase and v30+ spellings all collapse to one key. */
function canon(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    let key = k.toLowerCase().replace(/_/g, '');
    if (key === 'basestylename') key = 'basestyle';
    if (key === 'scenenumber') key = 'number';
    out[key] = v;
  }
  return out;
}

const truthy = (v: string | undefined): boolean => v === '1' || v === 'true' || v === 'True' || v === 'yes';
const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const emu = (v: string | undefined): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n * EMU_PER_OSF_UNIT);
};
/** Lines are multiples of 0.25 in the model. */
const quarter = (n: number): number => Math.min(40, Math.max(0, Math.round(n * 4) / 4));

const TITLE_BOOKMARKS: Record<string, TitleField> = {
  title: 'title', subtitle: 'subtitle', author: 'author', copyright: 'copyright', draft: 'draftDate', contact: 'contact', credit: 'credit',
};

interface FileStyle {
  name: string;
  a: Record<string, string>;
  role: StyleRole;
  builtinIndex: number | null;
}

function unpack(input: Uint8Array | string, report: ReportBuilder): { xml: string; extraEntries: string[] } {
  if (typeof input === 'string') return { xml: input, extraEntries: [] };
  if (input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b) {
    const names: string[] = [];
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(input, { filter: (f) => { names.push(f.name); return f.name === 'document.xml'; } });
    } catch (e) {
      throw new FormatError('FORMAT_CORRUPT', `Not a readable zip archive: ${(e as Error).message}`);
    }
    const doc = files['document.xml'];
    if (!doc) throw new FormatError('FORMAT_UNRECOGNIZED', 'The archive has no document.xml.');
    const extra = names.filter((n) => n !== 'document.xml' && !n.endsWith('/'));
    if (extra.length) report.loss('FADEIN_EXTRA_ENTRIES', 'images', 'Additional archive entries (such as embedded images) were not imported.');
    return { xml: strFromU8(doc), extraEntries: extra };
  }
  return { xml: strFromU8(input), extraEntries: [] };
}

export function importFadeIn(input: Uint8Array | string, options: ImportOptions = {}): ImportResult {
  const report = new ReportBuilder('import', 'fadein');
  const { xml } = unpack(input, report);
  let root: XNode;
  try { root = parseXml(xml); } catch (e) { throw new FormatError('FORMAT_CORRUPT', `document.xml is not well-formed XML: ${(e as Error).message}`); }
  if (root.name !== 'document' || !/Open Screenplay Format/i.test(root.attrs.type ?? '')) {
    throw new FormatError('FORMAT_UNRECOGNIZED', 'document.xml is not an Open Screenplay Format document.');
  }
  const version = num(root.attrs.version) ?? 0;
  if (version > FADEIN_KNOWN_VERSION) report.warn('FADEIN_NEWER_VERSION', 'unknown_content', `Saved by a newer Fade In (format version ${version}); unknown settings were ignored.`);
  else if (version < FADEIN_KNOWN_VERSION) report.info('FADEIN_OLDER_VERSION', 'metadata', `Format version ${version} was read with tolerant attribute names; only version ${FADEIN_KNOWN_VERSION} is verified against real files.`);

  const b = new DocBuilder(options);
  const tpl = b.json.template;

  // <info>
  const info = child(root, 'info');
  const infoA = info ? canon(info.attrs) : {};
  const sourcePageCount = num(infoA.pagecount);

  // <settings> -> page geometry and pagination
  const st = child(root, 'settings');
  if (st) {
    const s = canon(st.attrs);
    const w = emu(s.pagewidth), h = emu(s.pageheight);
    if (w && h) {
      tpl.page.width = w; tpl.page.height = h;
      const isLetter = Math.abs(w - 7_772_400) < 3 * EMU_PER_OSF_UNIT && Math.abs(h - 10_058_400) < 3 * EMU_PER_OSF_UNIT;
      const isA4 = Math.abs(w - 7_560_000) < 3 * EMU_PER_OSF_UNIT && Math.abs(h - 10_692_000) < 3 * EMU_PER_OSF_UNIT;
      tpl.page.paper = isLetter ? 'letter' : isA4 ? 'a4' : 'custom';
    }
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const v = emu(s[`margin${side}`]);
      if (v !== undefined) tpl.page.margins[side] = v;
    }
    const lpi = num(s.normallinesperinch);
    if (lpi && lpi > 0) tpl.page.linesPerInch = lpi;
    const spacing = num(s.elementspacing);
    if (spacing && spacing > 0) tpl.page.elementSpacing = spacing;
    if (s.breakonsentences !== undefined) tpl.pagination.breakOnSentences = truthy(s.breakonsentences);
    if (s.dialoguepagebreaks !== undefined) tpl.pagination.dialogue.allowBreaks = truthy(s.dialoguepagebreaks);
    if (s.dialoguecontinues !== undefined) tpl.pagination.automaticContinueds.enabled = truthy(s.dialoguecontinues);
    if (s.moretext) tpl.continueds.more = s.moretext;
    if (s.conttext) tpl.continueds.cont = s.conttext;
    if (s.scenescontinue !== undefined) {
      const on = truthy(s.scenescontinue);
      tpl.pagination.sceneContinueds.top = on; tpl.pagination.sceneContinueds.bottom = on;
    }
    if (s.pageheader !== undefined) {
      const text = s.pageheader.replace(/#/g, '{page}');
      const hdr = tpl.header;
      hdr.left = hdr.center = hdr.right = '';
      const al = num(s.headeralignment) ?? 3;
      if (al === 1) hdr.left = text; else if (al === 2) hdr.center = text; else hdr.right = text;
      hdr.enabled = text !== '';
      hdr.showOnFirstPage = truthy(s.headerfirstpage);
    }
    if (truthy(s.pageslocked)) report.loss('FADEIN_PAGES_LOCKED', 'locking', 'Locked pages were not imported.');
    if (s.revision && s.revision !== '0' && truthy(s.revisionmode)) report.loss('FADEIN_REVISION_MODE', 'revisions', 'Revision mode and revision sets were not imported.');
    const snp = num(s.scenenumberposition);
    if (snp === 1) b.sceneNumberPosition = 'left'; else if (snp === 2) b.sceneNumberPosition = 'right'; else if (snp === 3) b.sceneNumberPosition = 'both';
    const pn = tpl.pageNumbering;
    if (num(s.pagenumberstart)) pn.start = num(s.pagenumberstart)!;
  }

  // <styles>: the eight builtin slots patch the matching template style; other styles are added.
  const fileStyles = new Map<string, FileStyle>();
  const stylesNode = child(root, 'styles');
  for (const sn of stylesNode ? childrenNamed(stylesNode, 'style') : []) {
    const a = canon(sn.attrs);
    const name = sn.attrs.name ?? a.name ?? '';
    if (!name) continue;
    const builtinIndex = truthy(a.builtin) ? (num(a.builtinindex) ?? null) : null;
    const base = a.basestyle ? fileStyles.get(a.basestyle) : undefined;
    const r = roleForImportedStyle({ name, builtinIndex, actBreak: truthy(a.actbreak), baseRole: base?.role ?? null });
    fileStyles.set(name, { name, a, role: r.role, builtinIndex });
  }
  const effective = (fs: FileStyle, key: string, depth = 0): string | undefined => {
    if (fs.a[key] !== undefined) return fs.a[key];
    const base = fs.a.basestyle ? fileStyles.get(fs.a.basestyle) : undefined;
    return base && depth < 6 ? effective(base, key, depth + 1) : undefined;
  };
  const applyStyle = (target: StyleDef, fs: FileStyle) => {
    const size = num(effective(fs, 'size'));
    const font = effective(fs, 'font');
    if (size) target.font = { ...target.font, size: Math.round(size * 2) / 2 };
    if (font) {
      const f = font.toLowerCase();
      const family = f.startsWith('courier new') ? 'courier-new' : f.startsWith('courier') ? 'courier-screenplay' : f.includes('times') ? 'times' : f.includes('arial') || f.includes('helvetica') ? 'arial' : null;
      if (family) target.font = { ...target.font, family };
      else report.warn('FADEIN_FONT_SUBSTITUTED', 'fonts', 'Fonts other than Courier, Times and Arial families were not imported; the template font is used.');
    }
    for (const k of ['bold', 'italic'] as const) if (truthy(effective(fs, k))) target.font = { ...target.font, [k]: true };
    if (effective(fs, 'underline') !== undefined && truthy(effective(fs, 'underline'))) target.font = { ...target.font, underline: 'single' };
    target.allCaps = truthy(effective(fs, 'allcaps'));
    target.spaceBefore = quarter(num(effective(fs, 'spacebefore')) ?? 0);
    target.indentLeft = emu(effective(fs, 'leftindent')) ?? 0;
    target.indentRight = emu(effective(fs, 'rightindent')) ?? 0;
    target.indentFirstLine = emu(effective(fs, 'firstlineindent')) ?? 0;
    target.keepWithNext = truthy(effective(fs, 'keepwithnext'));
    const al = effective(fs, 'align');
    target.align = al === 'center' || al === 'right' || al === 'justify' ? al : 'left';
    const ls = num(effective(fs, 'linespacing'));
    if (ls && ls >= 0.5 && ls <= 4) target.lineSpacing = ls;
    if (truthy(effective(fs, 'pagebreakbefore'))) target.pageBreakBefore = true;
  };
  const templateStyleFor = new Map<string, string>(); // file style name -> template StyleId
  const usedCustom: string[] = [];
  for (const fs of fileStyles.values()) {
    if (fs.builtinIndex !== null && fs.builtinIndex < BUILTIN_SLOT_ROLES.length) {
      const role = BUILTIN_SLOT_ROLES[fs.builtinIndex]!;
      const target = tpl.styles.find((s) => s.role === role);
      if (target) { applyStyle(target, fs); templateStyleFor.set(fs.name, target.id); continue; }
    }
    // Same-named template style, else a new style based on the base style's template style.
    const same = tpl.styles.find((s) => s.name.toLowerCase() === fs.name.toLowerCase());
    if (same) { templateStyleFor.set(fs.name, same.id); continue; }
    const basedOn = (fs.a.basestyle && templateStyleFor.get(fs.a.basestyle)) || tpl.defaults.root;
    const created: StyleDef = {
      id: newId('st', b.ids) as never, name: fs.name.slice(0, 60), nameKey: null, role: fs.role, basedOn: basedOn as never, shortcut: null, font: {},
    };
    applyStyle(created, fs);
    tpl.styles.push(created);
    templateStyleFor.set(fs.name, created.id);
    usedCustom.push(fs.name);
  }
  if (usedCustom.length) report.warn('FADEIN_CUSTOM_STYLES', 'styles', `Custom styles were added to the document's template (${usedCustom.length}); their pagination behaviour follows the role guessed from the name.`);

  const styleIdFor = (name: string | undefined, where: number): string => {
    const key = (name ?? '').trim();
    const mapped = templateStyleFor.get(key);
    if (mapped) return mapped;
    const byName = b.styleByName(key);
    if (byName) return byName.id;
    report.warn('FADEIN_UNDEFINED_STYLE', 'styles', 'Paragraphs referencing a style the file does not define were imported as Action.', { elementIndex: where });
    return b.styleForRole('action').id;
  };

  const readRuns = (p: XNode): Run[] => {
    const runs: Run[] = [];
    for (const t of childrenNamed(p, 'text')) {
      const a = canon(t.attrs);
      const run: Run = { text: t.text };
      if (truthy(a.bold)) run.b = true;
      if (truthy(a.italic)) run.i = true;
      if (truthy(a.underline)) run.u = true;
      if (truthy(a.strikethrough)) run.s = true;
      for (const k of ['font', 'size', 'color', 'bgcolor', 'link']) if (a[k] !== undefined) report.loss('FADEIN_RUN_ATTRS', 'formatting', 'Run-level font, size, colour, highlight and link attributes were dropped (the text is kept).');
      if (a.revision !== undefined && a.revision !== '0') report.loss('FADEIN_RUN_REVISIONS', 'revisions', 'Revision marks on text runs were dropped (the text is kept).');
      if (t.children.length) report.loss('FADEIN_RUN_CHILDREN', 'unknown_content', 'Unrecognised content inside text runs was dropped.');
      runs.push(run);
    }
    return runs;
  };

  const paragraphOverrides = (sn: XNode | undefined): ElementJSON['ov'] | undefined => {
    if (!sn) return undefined;
    const a = canon(sn.attrs);
    const ov: NonNullable<ElementJSON['ov']> = {};
    if (a.align === 'left' || a.align === 'center' || a.align === 'right' || a.align === 'justify') ov.align = a.align;
    const l = emu(a.leftindent), r = emu(a.rightindent), f = emu(a.firstlineindent);
    if (l !== undefined) ov.indentLeft = l;
    if (r !== undefined) ov.indentRight = r;
    if (f !== undefined) ov.indentFirstLine = f;
    const sb = num(a.spacebefore);
    if (sb !== undefined) ov.spaceBefore = quarter(sb);
    const ls = num(a.linespacing);
    if (ls && ls >= 0.5 && ls <= 4) ov.lineSpacing = ls;
    if (a.keepwithnext !== undefined) ov.keepWithNext = truthy(a.keepwithnext);
    if (truthy(a.pagebreakbefore)) ov.pageBreakBefore = true;
    return Object.keys(ov).length ? ov : undefined;
  };

  // <paragraphs>
  const dualStarts: number[] = [];
  const paraNode = child(root, 'paragraphs');
  for (const p of paraNode ? childrenNamed(paraNode, 'para') : []) {
    const pa = canon(p.attrs);
    const sn = child(p, 'style');
    const styleId = styleIdFor(sn?.attrs.basestyle ?? sn?.attrs.basestylename ?? canon(sn?.attrs ?? {}).basestyle, b.json.elements.length);
    const extra: Partial<ElementJSON> = {};
    const ov = paragraphOverrides(sn);
    if (ov) extra.ov = ov;
    if (pa.number) extra.num = { label: parseNumberLabel(pa.number), locked: truthy(pa.locked), manual: true };
    const el = b.makeElement(styleId, textFromRuns(readRuns(p)), extra);
    const idx = b.json.elements.length;
    b.add(el);
    if (sn && truthy(canon(sn.attrs).dualdialogue)) dualStarts.push(idx);
    if (pa.note) b.addNote(el.id, pa.note);
    if (pa.synopsis) {
      if (el.scene) el.scene.synopsis = { plain: pa.synopsis, runs: [{ text: pa.synopsis, attrs: {} }], embeds: [] };
      else report.loss('FADEIN_SYNOPSIS', 'synopses', 'Synopses on non-scene paragraphs were dropped.');
    }
    if (pa.pagenumber) report.loss('FADEIN_PAGE_NUMBER', 'locking', 'Locked page numbers were not imported.');
    if (pa.bookmark) report.info('FADEIN_BOOKMARK', 'metadata', 'Bookmarks were not imported.');
    if (child(p, 'marks')) report.loss('FADEIN_MARKS', 'revisions', 'Deletion revision marks were not imported.');
    for (const c of p.children) {
      if (!['style', 'text', 'marks', 'fadein_data'].includes(c.name)) report.loss('FADEIN_PARA_CHILD', 'unknown_content', 'Unrecognised paragraph content (images, tags, alternates) was dropped.');
    }
  }

  // Dual dialogue: a flagged Character and its block are the left column; the next Character block is the right.
  const els = b.json.elements;
  const isRole = (i: number, roles: StyleRole[]) => els[i] !== undefined && roles.includes(b.roleOfStyle(els[i]!.style));
  const blockEnd = (from: number): number => {
    let j = from + 1;
    while (j < els.length && isRole(j, ['parenthetical', 'dialogue'])) j++;
    return j;
  };
  for (const start of dualStarts) {
    if (!isRole(start, ['character'])) { report.warn('FADEIN_DUAL_NOT_CHARACTER', 'dual_dialogue', 'A dual dialogue flag on a non-character paragraph was ignored.'); continue; }
    const leftEnd = blockEnd(start);
    if (!isRole(leftEnd, ['character'])) { report.warn('FADEIN_DUAL_NO_PARTNER', 'dual_dialogue', 'A dual dialogue block had no partner and was read as single dialogue.'); continue; }
    const rightEnd = blockEnd(leftEnd);
    const group = b.newDualGroup();
    for (let k = start; k < leftEnd; k++) els[k]!.dual = { group: group as never, side: 'left' };
    for (let k = leftEnd; k < rightEnd; k++) els[k]!.dual = { group: group as never, side: 'right' };
  }

  // <titlepage>
  const tp = child(root, 'titlepage');
  let titleParas = 0;
  for (const p of tp ? childrenNamed(tp, 'para') : []) {
    titleParas++;
    const pa = canon(p.attrs);
    const sn = child(p, 'style');
    const al = canon(sn?.attrs ?? {}).align;
    const align = al === 'center' || al === 'right' ? al : 'left';
    const field = pa.bookmark ? TITLE_BOOKMARKS[pa.bookmark.toLowerCase()] : undefined;
    b.addTitleElement(b.titleStyleFor(null, align), textFromRuns(readRuns(p)), field);
  }
  if (titleParas === 0 && info) {
    // v1.2 kept title fields on <info>.
    const legacy: [string, TitleField][] = [['title', 'title'], ['subtitle', 'subtitle'], ['writtenby', 'author'], ['copyright', 'copyright'], ['contact', 'contact'], ['drafts', 'draftDate']];
    for (const [k, field] of legacy) if (infoA[k]) b.addTitleElement(b.titleStyleFor(null, ['title', 'subtitle', 'author'].includes(k) || k === 'writtenby' ? 'center' : 'left'), textFromRuns([{ text: infoA[k]! }]), field);
  }

  // Everything else: say what was not carried.
  const apages = child(root, 'a_pages');
  if (apages && apages.children.length) report.loss('FADEIN_A_PAGES', 'locking', 'Locked A-page records were not imported.');
  const spelling = child(root, 'spelling');
  if (spelling) {
    const words = child(spelling, 'user_dictionary');
    b.json.spelling.words = childrenNamed(words ?? spelling, 'entry').map((e) => e.attrs.word ?? '').filter(Boolean);
    if (spelling.attrs.language) b.json.spelling.language = spelling.attrs.language.replace('_', '-');
  }
  const lists = child(root, 'lists');
  if (lists) {
    const hasLists = ['characters', 'locations', 'scene_intros', 'scene_times', 'extensions', 'transitions'].some((n) => (child(lists, n)?.children.length ?? 0) > 0);
    if (hasLists) report.info('FADEIN_LISTS', 'smarttype', 'SmartType lists (characters, locations, and so on) were not imported; they are rebuilt from the text.');
    const rules = child(lists, 'highlight_rules');
    if (rules && rules.children.length) report.loss('FADEIN_HIGHLIGHT_RULES', 'entities', 'Character highlight rules were not imported.');
    if (child(lists, 'revision_colors')?.children.length) report.info('FADEIN_REVISION_COLORS', 'revisions', 'Custom revision colours were not imported.');
  }
  if (child(root, 'fadein_settings')) report.info('FADEIN_SETTINGS', 'metadata', 'Fade In interface settings (navigator, index cards, cursor position) were not imported.');
  const tagged = (paraNode?.children ?? []).some((p) => p.children.some((c) => c.name === 'tag'));
  if (tagged) report.loss('FADEIN_TAGS', 'tags', 'Tags were not imported.');

  const document = b.finish({
    source: 'fadein', fileName: options.fileName, version: version || undefined,
    unknown: sourcePageCount !== undefined ? { sourcePageCount } : {},
  });
  return {
    document,
    report: report.build({ elements: document.elements.length, scenes: b.countScenes() }, { sourceVersion: String(version || '') || undefined }),
  };
}
