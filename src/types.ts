import type { DocumentJSON } from '@sudobility/writing_core';

/** Spec 04 §2.3. Only the formats this slice implements plus the ones sniffing can recognise and refuse. */
export const FORMAT_IDS = ['fountain', 'fdx', 'fadein', 'pdf', 'rtf', 'docx', 'html', 'txt'] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

/** Spec 04 §3.1. */
export const DIAGNOSTIC_SEVERITIES = ['info', 'warn', 'loss', 'error'] as const;
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export const LOSS_FEATURES = [
  'formatting', 'styles', 'page_layout', 'title_page', 'revisions', 'track_changes', 'locking', 'scene_numbers',
  'notes', 'tags', 'entities', 'alternates', 'scene_versions', 'structure', 'beat_board', 'synopses',
  'dual_dialogue', 'columns', 'images', 'table_read', 'macros', 'smarttype', 'dictionaries', 'watermark',
  'headers_footers', 'fonts', 'unknown_content', 'pagination', 'metadata',
] as const;
export type LossFeature = (typeof LOSS_FEATURES)[number];

export interface DiagnosticLocation {
  elementIndex?: number;
  sourceLine?: number;
  sourcePath?: string;
}

export interface Diagnostic {
  /** Stable code, e.g. `FDX_REVISION_MARKS`. */
  code: string;
  severity: DiagnosticSeverity;
  /** Human-readable English message (no i18n layer in this slice). */
  message: string;
  feature: LossFeature;
  /** Occurrences folded into this diagnostic. */
  count: number;
  /** Up to 50 samples. */
  locations?: DiagnosticLocation[];
}

export interface ConversionReport {
  direction: 'import' | 'export';
  format: FormatId;
  /** Source format version when known (`'50'` for OSF v50, `'1.1'` for Fountain, FDX `Version`). */
  sourceVersion?: string;
  diagnostics: Diagnostic[];
  stats: { elements: number; scenes: number; pages?: number; durationMs: number };
  confidence?: number;
  summary: { info: number; warn: number; loss: number; error: number };
}

export interface ImportOptions {
  /** Built-in template key. Default `screenplay-standard`. */
  templateKey?: string;
  /** Owner recorded on created elements. Default `import`. */
  uid?: string;
  fileName?: string;
  /** Injected for deterministic tests. */
  now?: () => number;
}

export interface ImportResult {
  document: DocumentJSON;
  report: ConversionReport;
}

export interface FountainExportResult { text: string; report: ConversionReport }
export interface FdxExportResult { xml: string; report: ConversionReport }

export const FORMAT_ERROR_CODES = ['FORMAT_UNRECOGNIZED', 'FORMAT_UNSUPPORTED', 'FORMAT_CORRUPT'] as const;
export type FormatErrorCode = (typeof FORMAT_ERROR_CODES)[number];

/** Thrown only for fatal problems (the input is not the format at all); everything recoverable goes in the report. */
export class FormatError extends Error {
  constructor(readonly code: FormatErrorCode, message: string) {
    super(message);
    this.name = 'FormatError';
  }
}
