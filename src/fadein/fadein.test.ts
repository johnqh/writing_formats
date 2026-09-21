import { existsSync, readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectFormat, importAny, importFadeIn } from '../index.js';
import { elementSequence, layoutPages, validate } from '../test-support/helpers.js';

const OSF = `<?xml version="1.0" encoding="UTF-8"?>
<document type="Open Screenplay Format document" version="50">
  <info uuid="X" pagecount="2"/>
  <settings page_width="2159" page_height="2794" margin_top="254" margin_bottom="254" margin_left="381" margin_right="254" normal_linesperinch="6.0" page_header="#." header_alignment="3"/>
  <fadein_settings saved_with="5.0.7"/>
  <styles>
    <style name="Normal Text" builtin="1" builtin_index="0" font="Courier New" size="12"/>
    <style name="Scene Heading" builtin="1" builtin_index="1" basestyle="Normal Text" spacebefore="2.0" keepwithnext="1" allcaps="1"/>
    <style name="Action" builtin="1" builtin_index="2" basestyle="Normal Text" spacebefore="1.0"/>
    <style name="Character" builtin="1" builtin_index="3" basestyle="Normal Text" spacebefore="1.0" leftindent="635" allcaps="1"/>
    <style name="Parenthetical" builtin="1" builtin_index="4" basestyle="Normal Text" leftindent="508" rightindent="508"/>
    <style name="Dialogue" builtin="1" builtin_index="5" basestyle="Normal Text" leftindent="330" rightindent="254"/>
    <style name="Transition" builtin="1" builtin_index="6" basestyle="Normal Text" spacebefore="1.0" align="right" allcaps="1"/>
    <style name="Beat" basestyle="Action" italic="1"/>
  </styles>
  <paragraphs>
    <para number="1"><style basestyle="Scene Heading"/><text>INT. BOAT - DAY</text></para>
    <para><style basestyle="Action"/><text>Waves. </text><text bold="1" italic="1">Loud</text><text color="#FF0000"> waves.</text></para>
    <para><style basestyle="Character" dualdialogue="1"/><text>ANA</text></para>
    <para><style basestyle="Dialogue"/><text>Left.</text></para>
    <para><style basestyle="Character"/><text>BO</text></para>
    <para><style basestyle="Dialogue"/><text>Right.</text></para>
    <para><style basestyle="Beat"/><text underline="1">A beat.</text></para>
    <para note="Trim this"><style basestyle="Transition"/><text>CUT TO:</text></para>
    <para><style basestyle="Nonexistent"/><text>Odd.</text></para>
  </paragraphs>
  <titlepage>
    <para><style basestyle="Normal Text"/><text></text></para>
    <para bookmark="Title"><style basestyle="Normal Text" align="center"/><text underline="1">A BOAT STORY</text></para>
    <para bookmark="Author"><style basestyle="Normal Text" align="center"/><text>Ana Ortiz</text></para>
  </titlepage>
  <a_pages><a_page/></a_pages>
  <spelling language="en_US"><user_dictionary><entry word="Ortiz"/></user_dictionary></spelling>
  <lists><characters><character name="ANA"/></characters></lists>
</document>`;

describe('fadein import (synthetic)', () => {
  const zip = zipSync({ 'document.xml': strToU8(OSF), 'image1.png': new Uint8Array([1, 2, 3]) });
  const { document, report } = importFadeIn(zip);

  it('reads the zip, maps styles and runs, and records what it cannot map', () => {
    expect(report.sourceVersion).toBe('50');
    const seq = elementSequence(document);
    expect(seq.map((s) => s.style).slice(0, 8)).toEqual([
      'st_scene_heading', 'st_action', 'st_character', 'st_dialogue', 'st_character', 'st_dialogue', expect.any(String), 'st_transition',
    ]);
    expect(seq.map((s) => s.dual).slice(2, 6)).toEqual(['left', 'left', 'right', 'right']);
    expect(document.elements[1]!.text.runs.find((r) => r.text === 'Loud')?.attrs).toEqual({ b: true, i: true });
    expect(document.elements[0]!.num?.label.base).toBe(1);
    expect(document.notes.map((n) => n.body.plain)).toEqual(['Trim this']);
    expect(document.titlePage.fields.title).toBeTruthy();
    expect(document.template.page.margins.left).toBe(381 * 3600);
    expect(document.spelling.words).toEqual(['Ortiz']);
    const codes = report.diagnostics.map((d) => d.code);
    for (const c of ['FADEIN_EXTRA_ENTRIES', 'FADEIN_RUN_ATTRS', 'FADEIN_UNDEFINED_STYLE', 'FADEIN_A_PAGES', 'FADEIN_CUSTOM_STYLES']) expect(codes, c).toContain(c);
    expect(validate(document)).toEqual([]);
  });

  it('is found by sniffing and importAny', () => {
    expect(detectFormat(zip, 'x.bin').format).toBe('fadein');
    expect(importAny(zip, 'x.fadein').document.elements.length).toBe(document.elements.length);
  });
});

const REAL = ['/Users/johnhuang/projects/writing/Act 2.fadein', '/Users/johnhuang/projects/writing/Ending-updated.fadein'];

// The two files are the user's private writing: counts only, nothing about their text is printed or asserted.
describe.each(REAL)('fadein import (real file: %s)', (path) => {
  const present = existsSync(path);
  it.skipIf(!present)('imports to a valid document and lays out', () => {
    const bytes = new Uint8Array(readFileSync(path));
    expect(detectFormat(bytes, path).format).toBe('fadein');
    const { document, report } = importFadeIn(bytes, { fileName: 'private.fadein' });
    const hist: Record<string, number> = {};
    for (const e of document.elements) hist[e.style] = (hist[e.style] ?? 0) + 1;
    const issues = validate(document);
    const layout = layoutPages(document);
    const sourcePages = (document.importMeta?.unknown as { sourcePageCount?: number } | undefined)?.sourcePageCount;
    const warns = report.diagnostics.map((d) => `${d.severity}:${d.code}x${d.count}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ version: report.sourceVersion, elements: document.elements.length, scenes: report.stats.scenes, titleParagraphs: document.titlePage.elements.length, styleHistogram: hist, warnings: warns, validationIssues: issues.length, ourPages: layout.pages, layoutDiagnostics: layout.diagnostics, fadeInPageCount: sourcePages }));
    expect(report.sourceVersion).toBe('50');
    expect(issues).toEqual([]);
    expect(document.elements.length).toBeGreaterThan(20);
    expect(report.stats.scenes).toBeGreaterThan(0);
    expect(layout.pages).toBeGreaterThan(0);
  });
});
