import { XMLParser } from 'fast-xml-parser';

/** A DOM-free element node: attributes, child elements in document order, and the concatenated direct text. */
export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Direct text content, whitespace preserved. */
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  processEntities: true,
  allowBooleanAttributes: true,
});

type Raw = Record<string, unknown>;

function convert(raw: Raw): XNode | null {
  const key = Object.keys(raw).find((k) => k !== ':@');
  if (key === undefined || key === '#text' || key.startsWith('?') || key.startsWith('!')) return null;
  const attrs: Record<string, string> = {};
  const rawAttrs = raw[':@'] as Record<string, unknown> | undefined;
  if (rawAttrs) for (const [k, v] of Object.entries(rawAttrs)) attrs[k] = String(v);
  const children: XNode[] = [];
  let text = '';
  for (const c of (raw[key] as Raw[]) ?? []) {
    if ('#text' in c) text += String(c['#text']);
    else {
      const n = convert(c);
      if (n) children.push(n);
    }
  }
  return { name: key, attrs, children, text };
}

/** Parses XML into an `XNode` tree. DOCTYPE declarations are stripped first (no entity expansion, XXE-safe). */
export function parseXml(xml: string): XNode {
  const cleaned = xml.replace(/^﻿/, '').replace(/<!DOCTYPE[^\[>]*(\[[\s\S]*?\])?\s*>/i, '');
  const raw = parser.parse(cleaned) as Raw[];
  for (const r of raw) {
    const n = convert(r);
    if (n) return n;
  }
  throw new Error('XML has no root element');
}

export function child(node: XNode, name: string): XNode | undefined {
  return node.children.find((c) => c.name === name);
}

export function childrenNamed(node: XNode, name: string): XNode[] {
  return node.children.filter((c) => c.name === name);
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}

/** Removes characters XML 1.0 cannot carry (control bytes other than tab, LF, CR). */
export function stripXmlIllegal(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || c === 13 || (c >= 0x20 && c !== 0xfffe && c !== 0xffff)) out += ch;
  }
  return out;
}
