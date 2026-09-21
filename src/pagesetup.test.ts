import { describe, expect, it } from 'vitest';
import { exportFdx, exportFountain, importFdx, importFountain } from './index.js';
import { validate } from './test-support/helpers.js';

const FOUNTAIN = `Title: The Night Train
Author: Jane Writer
Draft date: 1/2/26
Contact: jane@example.com

INT. STATION - NIGHT #12A#

A train arrives.

INT. PLATFORM - NIGHT #13#

Rain.
`;

describe('Fountain title page and scene numbers', () => {
  it('imports the title block and typed scene numbers, and shows them (numbering switched on)', () => {
    const { document } = importFountain(FOUNTAIN);
    expect(document.titlePage.fields.title).toBeTruthy();
    expect(document.titlePage.elements.find((e) => e.id === document.titlePage.fields.author)?.text.plain).toBe('Jane Writer');
    const nums = document.elements.filter((e) => e.num).map((e) => e.num!.label.base + (e.num!.label.suffix.length ? 'A' : ''));
    expect(nums).toEqual(['12A', '13']);
    const heading = document.template.styles.find((s) => s.id === document.template.sceneNumbering.styleId)!;
    expect(heading.numbering?.enabled).toBe(true);
    expect(validate(document)).toEqual([]);
  });

  it('exports the title block and #N# numbers, auto numbers included', () => {
    const { document } = importFountain(FOUNTAIN);
    const out = exportFountain(document).text;
    expect(out).toContain('Title: The Night Train');
    expect(out).toContain('Contact: jane@example.com');
    expect(out).toContain('#12A#');
    // Auto-numbered document: numbers come from the layout numbering, not from stored labels.
    const plain = importFountain('INT. A - DAY\n\nx\n\nINT. B - DAY\n\ny\n').document;
    expect(exportFountain(plain).text).not.toContain('#1#');
    const style = plain.template.styles.find((s) => s.id === plain.template.sceneNumbering.styleId)!;
    style.numbering = { ...style.numbering!, enabled: true };
    const numbered = exportFountain(plain).text;
    expect(numbered).toContain('INT. A - DAY #1#');
    expect(numbered).toContain('INT. B - DAY #2#');
  });

  it('reports headers and footers as not representable', () => {
    const { document } = importFountain(FOUNTAIN);
    document.template.footer.enabled = true;
    document.template.footer.center = '{title}';
    const { report } = exportFountain(document);
    expect(report.diagnostics.some((d) => d.code === 'FOUNTAIN_HEADERS')).toBe(true);
  });
});

describe('locks on export', () => {
  it('writes locked A-numbers as fixed numbers and reports page locks as unsupported', () => {
    const { document } = importFountain(FOUNTAIN);
    const first = document.elements.find((e) => e.num)!;
    first.num = { label: first.num!.label, locked: true, manual: false };
    document.production.scenesLocked = true;
    document.production.pagesLocked = true;
    for (const fn of [exportFountain, exportFdx]) {
      const res = fn(document);
      const codes = res.report.diagnostics.map((d) => d.code);
      expect(codes.some((c) => c.endsWith('_PAGE_LOCKS'))).toBe(true);
      expect(codes.some((c) => c.endsWith('_SCENE_LOCKS'))).toBe(true);
    }
    const back = importFountain(exportFountain(document).text);
    expect(back.document.elements.filter((e) => e.num).map((e) => e.num!.label.base + (e.num!.label.suffix.length ? 'A' : ''))).toEqual(['12A', '13']);
  });
});

describe('FDX header/footer, title page and scene numbers', () => {
  it('round-trips header, footer, scene numbers and title page', () => {
    const { document } = importFountain(FOUNTAIN);
    document.template.header = { ...document.template.header, enabled: true, left: '', center: '', right: '{page}.', showOnFirstPage: false };
    document.template.footer = { ...document.template.footer, enabled: true, left: 'Draft {date}', center: '', right: '', showOnFirstPage: true };
    const { xml } = exportFdx(document);
    expect(xml).toContain('<HeaderAndFooter');
    expect(xml).toContain('<DynamicLabel Type="Page #"/>');
    expect(xml).toContain('Number="12A"');
    expect(xml).toContain('The Night Train');
    expect(xml).toContain('<TitlePage>');
    const back = importFdx(xml);
    const t = back.document.template;
    expect(t.header).toMatchObject({ enabled: true, right: '{page}.', showOnFirstPage: false });
    expect(t.footer).toMatchObject({ enabled: true, left: 'Draft {date}', showOnFirstPage: true });
    expect(back.document.elements.filter((e) => e.num).length).toBe(2);
    expect(back.document.titlePage.elements.some((e) => e.text.plain === 'The Night Train')).toBe(true);
    expect(back.report.diagnostics.some((d) => d.code === 'FDX_HEADERANDFOOTER')).toBe(false);
  });

  it('writes auto scene numbers and static title tokens', () => {
    const plain = importFountain('Title: T\n\nINT. A - DAY\n\nx\n').document;
    const style = plain.template.styles.find((s) => s.id === plain.template.sceneNumbering.styleId)!;
    style.numbering = { ...style.numbering!, enabled: true };
    plain.template.footer = { ...plain.template.footer, enabled: true, center: '{title}' };
    const { xml, report } = exportFdx(plain);
    expect(xml).toContain('Number="1"');
    expect(xml).toContain('<Text>T</Text>');
    expect(report.diagnostics.some((d) => d.code === 'FDX_HEADER_STATIC')).toBe(true);
  });
});
