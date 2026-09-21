import { describe, expect, it } from 'vitest';
import { exportFdx, exportFountain, importFdx, importFountain } from '../index.js';
import { elementSequence, validate } from '../test-support/helpers.js';

const FDX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading" Number="1">
      <SceneProperties Length="1" Page="1" Title="The Arrival"/>
      <Text>INT. LIGHTHOUSE - NIGHT</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <ScriptNote ID="1" Author="Ed" Color="#FFFF00000000" DateTime="20260101T120000" Name="Check" Type="Note">
        <Paragraph Type="Action"><Text>Confirm the tide table.</Text></Paragraph>
      </ScriptNote>
      <Text Font="Courier Final Draft" Size="12" Style="">The lamp turns. </Text>
      <Text Font="Courier Final Draft" Size="12" Style="Bold+Italic">Something</Text>
      <Text Font="Courier Final Draft" Size="12" Style=""> waits below &amp; listens.</Text>
    </Paragraph>
    <Paragraph Type="Character"><Text>NORA</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(whispering)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Did you hear that?</Text></Paragraph>
    <Paragraph>
      <DualDialogue>
        <Paragraph Type="Character"><Text>NORA</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text>Left side.</Text></Paragraph>
        <Paragraph Type="Character"><Text>OWEN</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text Style="Underline">Right side.</Text></Paragraph>
      </DualDialogue>
    </Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph Type="Scene Heading" Number="2A"><Text>EXT. CLIFF - DAWN</Text></Paragraph>
    <Paragraph Type="Action" Alignment="Center" StartsNewPage="Yes"><Text>THE END</Text></Paragraph>
    <Paragraph Type="Mystery Element"><Text Style="AllCaps" RevisionID="2">Odd one.</Text></Paragraph>
  </Content>
  <ElementSettings Type="Action"><FontSpec Font="Courier Final Draft" Size="12"/></ElementSettings>
  <TitlePage>
    <Content>
      <Paragraph Alignment="Center"><Text></Text></Paragraph>
      <Paragraph Alignment="Center"><Text Style="Underline">THE LIGHTHOUSE KEEPER</Text></Paragraph>
      <Paragraph Alignment="Center"><Text>Written by</Text></Paragraph>
      <Paragraph Alignment="Center"><Text>Nora Voss</Text></Paragraph>
      <Paragraph Alignment="Left"><Text>nora@example.com</Text></Paragraph>
    </Content>
  </TitlePage>
  <Revisions ActiveSet="1"><Revision ID="1" Name="Blue" Color="#0000FF"/></Revisions>
  <LockedPages><LockedPage LevelIndex="0" LockLevel="1" PageNumber="3" Position="12"/></LockedPages>
  <HeaderAndFooter HeaderVisible="Yes"/>
</FinalDraft>`;

describe('fdx import', () => {
  const { document, report } = importFdx(FDX);
  const seq = elementSequence(document);

  it('maps paragraph types, runs, numbers, dual dialogue and notes', () => {
    expect(seq.map((s) => s.style)).toEqual([
      'st_scene_heading', 'st_action', 'st_character', 'st_parenthetical', 'st_dialogue',
      'st_character', 'st_dialogue', 'st_character', 'st_dialogue', 'st_transition', 'st_scene_heading', 'st_action', 'st_action',
    ]);
    const action = document.elements[1]!;
    expect(action.text.plain).toBe('The lamp turns. Something waits below & listens.');
    expect(action.text.runs.find((r) => r.text === 'Something')?.attrs).toEqual({ b: true, i: true });
    expect(document.elements[0]!.scene?.title).toBe('The Arrival');
    expect(seq[10]!.num).not.toBeNull();
    expect(seq.map((s) => s.dual)).toEqual([null, null, null, null, null, 'left', 'left', 'right', 'right', null, null, null, null]);
    expect(document.notes.map((n) => n.body.plain)).toEqual(['Confirm the tide table.']);
    expect(seq[11]).toMatchObject({ align: 'center', pageBreak: true });
  });

  it('keeps the title page and guesses fields with a warning', () => {
    expect(document.titlePage.elements).toHaveLength(5);
    expect(document.titlePage.elements.find((e) => e.field === 'title')?.text.plain).toBe('THE LIGHTHOUSE KEEPER');
    expect(document.titlePage.elements.find((e) => e.field === 'author')?.text.plain).toBe('Nora Voss');
    expect(report.diagnostics.some((d) => d.code === 'FDX_TITLE_FIELDS_GUESSED' && d.severity === 'warn')).toBe(true);
  });

  it('warns rather than silently dropping unsupported features', () => {
    const codes = report.diagnostics.map((d) => d.code);
    for (const c of ['FDX_REVISION_SETS', 'FDX_LOCKED_PAGES', 'FDX_REVISION_MARKS', 'FDX_RUN_STYLE', 'FDX_UNKNOWN_TYPE', 'FDX_ELEMENT_SETTINGS']) {
      expect(codes, c).toContain(c);
    }
    expect(report.summary.loss).toBeGreaterThan(0);
  });

  it('is a valid document', () => {
    expect(validate(document)).toEqual([]);
  });

  it('round-trips import -> export -> import to an equal element sequence', () => {
    const out = exportFdx(document);
    expect(out.xml).toContain('<DualDialogue>');
    const again = importFdx(out.xml);
    expect(elementSequence(again.document)).toEqual(seq);
    expect(again.document.notes.map((n) => n.body.plain)).toEqual(['Confirm the tide table.']);
    expect(again.document.titlePage.elements.map((e) => e.text.plain)).toEqual(document.titlePage.elements.map((e) => e.text.plain));
  });

  it('rejects non-FDX input with a typed error', () => {
    expect(() => importFdx('<html/>')).toThrowError(/FinalDraft/);
  });
});

describe('fountain -> fdx -> fountain', () => {
  it('preserves the element sequence', () => {
    const source = `Title: TWO SCENES
Author: A. Writer

INT. KITCHEN - DAY #1#

Maya *pours* coffee. She waits.

MAYA
(softly)
Are you there?

CUT TO:

EXT. YARD - NIGHT

TOM
Here.
`;
    const a = importFountain(source).document;
    const fdx = exportFdx(a);
    const b = importFdx(fdx.xml).document;
    const c = importFountain(exportFountain(b).text).document;
    // Scene-number lock state and title styles differ by design; compare the shared shape.
    const strip = (d: typeof a) => elementSequence(d).map(({ style, text, marks, dual }) => ({ style, text, marks, dual }));
    expect(strip(c)).toEqual(strip(a));
    expect(elementSequence(b).map((s) => s.style)).toEqual(elementSequence(a).map((s) => s.style));
  });
});
