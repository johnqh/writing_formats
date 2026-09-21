import type {
  ConversionReport, Diagnostic, DiagnosticLocation, DiagnosticSeverity, FormatId, LossFeature,
} from './types.js';

const MAX_LOCATIONS = 50;

/** Collects diagnostics, folding repeats of the same code+severity into one with a count. */
export class ReportBuilder {
  private readonly byKey = new Map<string, Diagnostic>();
  private readonly started = Date.now(); // platform-free-ok: duration stat only

  constructor(private readonly direction: 'import' | 'export', private readonly format: FormatId) {}

  add(severity: DiagnosticSeverity, code: string, feature: LossFeature, message: string, location?: DiagnosticLocation): void {
    const key = `${severity}|${code}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.count++;
      if (location && (existing.locations?.length ?? 0) < MAX_LOCATIONS) (existing.locations ??= []).push(location);
      return;
    }
    this.byKey.set(key, { code, severity, message, feature, count: 1, ...(location ? { locations: [location] } : {}) });
  }

  info(code: string, feature: LossFeature, message: string, location?: DiagnosticLocation): void { this.add('info', code, feature, message, location); }
  warn(code: string, feature: LossFeature, message: string, location?: DiagnosticLocation): void { this.add('warn', code, feature, message, location); }
  loss(code: string, feature: LossFeature, message: string, location?: DiagnosticLocation): void { this.add('loss', code, feature, message, location); }
  error(code: string, feature: LossFeature, message: string, location?: DiagnosticLocation): void { this.add('error', code, feature, message, location); }

  build(stats: { elements: number; scenes: number; pages?: number }, extra: { sourceVersion?: string; confidence?: number } = {}): ConversionReport {
    const diagnostics = [...this.byKey.values()];
    const summary = { info: 0, warn: 0, loss: 0, error: 0 };
    for (const d of diagnostics) summary[d.severity] += d.count;
    return {
      direction: this.direction,
      format: this.format,
      ...(extra.sourceVersion !== undefined ? { sourceVersion: extra.sourceVersion } : {}),
      diagnostics,
      stats: { ...stats, durationMs: Date.now() - this.started }, // platform-free-ok: duration stat only
      ...(extra.confidence !== undefined ? { confidence: extra.confidence } : {}),
      summary,
    };
  }
}
