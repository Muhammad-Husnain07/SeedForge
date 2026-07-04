import type { FieldSemanticMatch } from './types.js';

function pad(s: string, len: number): string {
  return s + ' '.repeat(Math.max(0, len - s.length));
}

export function printCoverageTable(matches: FieldSemanticMatch[]): void {
  const colWidths = {
    table: 16,
    column: 20,
    semanticType: 20,
    confidence: 12,
    source: 12,
  };

  const header =
    pad('Table', colWidths.table) +
    pad('Column', colWidths.column) +
    pad('Semantic Type', colWidths.semanticType) +
    pad('Confidence', colWidths.confidence) +
    pad('Source', colWidths.source);

  console.log(header);
  console.log('='.repeat(header.length));

  for (const m of matches) {
    console.log(
      pad(m.table, colWidths.table) +
      pad(m.column, colWidths.column) +
      pad(m.semanticType, colWidths.semanticType) +
      pad(m.source === 'rule' ? m.confidence.toFixed(2) : '-', colWidths.confidence) +
      pad(m.source, colWidths.source),
    );
  }

  const resolved = matches.filter((m) => m.source === 'rule');
  const pct = ((resolved.length / matches.length) * 100).toFixed(1);
  console.log(`\nResolved ${resolved.length}/${matches.length} columns (${pct}%) above threshold.`);
}
