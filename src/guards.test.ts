import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFormat, importAny } from './index.js';
import { importFountain } from './index.js';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.includes('test-support') ? [p] : [];
  });
}

describe('platform-free', () => {
  it('non-test sources use no Node built-ins, DOM globals or import.meta', () => {
    for (const f of sources(new URL('.', import.meta.url).pathname)) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"]node:/);
      expect(src, f).not.toMatch(/\b(window|localStorage|Buffer|process|globalThis\.document)\.|\bdocument\.(getElement|createElement|body|querySelector|cookie)/);
      expect(src, f).not.toMatch(/import\.meta/);
    }
  });

  it('no control bytes in any source file', () => {
    for (const f of [...sources(new URL('.', import.meta.url).pathname)]) {
      // eslint-disable-next-line no-control-regex
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    }
  });
});

describe('detectFormat', () => {
  it('sniffs by content', () => {
    expect(detectFormat('<?xml version="1.0"?><FinalDraft DocumentType="Script"></FinalDraft>').format).toBe('fdx');
    expect(detectFormat('INT. HOUSE - DAY\n\nMAYA\nHello.\n\nCUT TO:\n').format).toBe('fountain');
    expect(detectFormat('just some prose about nothing in particular.\n\nAnother paragraph here.\n').format).toBe('txt');
    expect(detectFormat(new TextEncoder().encode('%PDF-1.7 ...')).format).toBe('pdf');
    expect(detectFormat('{\\rtf1\\ansi hi}').format).toBe('rtf');
    expect(detectFormat('<html><body></body></html>').format).toBe('html');
  });

  it('refuses what it cannot read with a typed error', () => {
    expect(() => importAny('%PDF-1.7 blah')).toThrowError(/Cannot import/);
    expect(importAny('INT. HOUSE - DAY\n\nMAYA\nHello.\n', 'a.fountain').document.elements).toHaveLength(3);
  });

  it('never throws on merely unsupported Fountain features', () => {
    const { report } = importFountain('Title: X\n\nINT. A - DAY\n\n/* open boneyard\n\nBeat {{tag}}\n');
    expect(report.summary.warn).toBeGreaterThan(0);
  });
});
