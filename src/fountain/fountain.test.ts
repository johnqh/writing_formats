import { describe, expect, it } from 'vitest';
import { exportFountain, importFountain } from '../index.js';
import { elementSequence, validate } from '../test-support/helpers.js';

const SAMPLE = `Title: THE LONG WAY HOME
Credit: Written by
Author: Rosa Alvarez
Source: Based on the story by A. Writer
Draft date: 3/14/2026
Contact:
    Rosa Alvarez
    rosa@example.com
Copyright: (c) 2026 Rosa Alvarez

# ACT ONE

= Maya returns to the town she left.

.OPENING TITLES

INT. FARMHOUSE KITCHEN - DAY #1#

= Maya finds the letter.

MAYA (30s), sun-browned and tired, pushes through the screen door. She drops a *duffel bag* on the **table** and reads _the note_ twice. [[Check the timeline here.]]

> THE END OF SUMMER <

MAYA
(quietly)
Nobody is home.

  
TOM (O.S.)
Somebody is. *Turn around.*

MAYA
I'm here.

BRIAN ^
Me too.

===

EXT. BACK PORCH - CONTINUOUS

!INT. IS ONLY WHAT THE SIGN SAYS.

@ミサキ
You heard me.

~Sing me home tonight
~Sing me home

/* cut for time:
MAYA cries. */

Tom lights a **_cigarette_**. It reads 2 * 3 = 6.

CUT TO:

> FADE OUT.

SMASH CUT TO:

INT. TRAIN - NIGHT

MAYA
A moment.
`;

describe('fountain import', () => {
  const { document, report } = importFountain(SAMPLE);
  const seq = elementSequence(document);

  it('maps every element type', () => {
    const styles = new Set<string>(seq.map((s) => s.style));
    for (const id of ['st_scene_heading', 'st_action', 'st_character', 'st_parenthetical', 'st_dialogue', 'st_transition', 'st_lyrics', 'st_outline_1']) {
      expect(styles.has(id), id).toBe(true);
    }
  });

  it('reads title page fields', () => {
    expect(document.titlePage.fields.title).toBeTruthy();
    const contact = document.titlePage.elements.find((e) => e.field === 'contact');
    expect(contact?.text.plain).toBe('Rosa Alvarez\nrosa@example.com');
  });

  it('reads scene numbers, synopses, notes, centred text, page breaks, dual dialogue, boneyard', () => {
    const heading = document.elements.find((e) => e.text.plain.startsWith('INT. FARMHOUSE'))!;
    expect(heading.text.plain).toBe('INT. FARMHOUSE KITCHEN - DAY');
    expect(heading.num?.label.base).toBe(1);
    expect(heading.scene?.synopsis.plain).toBe('Maya finds the letter.');
    expect(document.notes).toHaveLength(1);
    expect(seq.some((s) => s.align === 'center' && s.text === 'THE END OF SUMMER')).toBe(true);
    expect(seq.some((s) => s.pageBreak)).toBe(true);
    expect(seq.filter((s) => s.dual === 'left').length).toBeGreaterThan(0);
    expect(seq.filter((s) => s.dual === 'right').length).toBeGreaterThan(0);
    expect(document.bin).toHaveLength(1);
    expect(seq.find((s) => s.text === 'INT. IS ONLY WHAT THE SIGN SAYS.')?.style).toBe('st_action');
    expect(seq.find((s) => s.text === 'ミサキ')?.style).toBe('st_character');
  });

  it('reads emphasis and leaves non-emphasis asterisks alone', () => {
    const action = document.elements.find((e) => e.text.plain.startsWith('MAYA (30s)'))!;
    expect(action.text.runs.some((r) => r.text === 'duffel bag' && r.attrs.i)).toBe(true);
    expect(action.text.runs.some((r) => r.text === 'table' && r.attrs.b)).toBe(true);
    expect(action.text.runs.some((r) => r.text === 'the note' && r.attrs.u)).toBe(true);
    expect(document.elements.find((e) => e.text.plain.includes('2 * 3'))).toBeTruthy();
  });

  it('is a valid document', () => {
    expect(validate(document)).toEqual([]);
    expect(report.stats.scenes).toBe(4);
  });

  it('round-trips import -> export -> import to an equal element sequence', () => {
    const out = exportFountain(document);
    const again = importFountain(out.text);
    expect(elementSequence(again.document)).toEqual(seq);
    expect(again.document.titlePage.elements.map((e) => e.text.plain)).toEqual(document.titlePage.elements.map((e) => e.text.plain));
    expect(again.document.notes.map((n) => n.body.plain)).toEqual(document.notes.map((n) => n.body.plain));
    expect(out.report.direction).toBe('export');
  });
});

describe('fountain export reports loss', () => {
  it('reports the Bin as not written', () => {
    const { document } = importFountain(SAMPLE);
    const out = exportFountain(document);
    expect(out.report.diagnostics.some((d) => d.code === 'FOUNTAIN_BIN' && d.severity === 'loss')).toBe(true);
  });
});
