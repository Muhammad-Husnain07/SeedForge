import type { ColumnSchema, TableSchema, DatabaseSchema } from '../types/index.js';
import type { FieldSemanticMatch, GeneratorSpec } from './types.js';

export interface SemanticRule {
  name: string;
  priority: number;
  match: (
    col: ColumnSchema,
    table: TableSchema,
    schema: DatabaseSchema,
    allTables: TableSchema[],
  ) => {
    semanticType: string;
    confidence: number;
    generator: GeneratorSpec;
  } | null;
}

const FIELD_PATTERN = /^(.+)(Id|_id|Ref)$/;

function pluralize(name: string): string {
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
  if (name.endsWith('ses')) return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name + 's';
}

function singularize(name: string): string {
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
  if (name.endsWith('ses')) return name.slice(0, -2);
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
}

function matchesTargetTable(candidate: string, tables: TableSchema[]): string | null {
  const variants = [
    candidate,
    pluralize(candidate),
    singularize(candidate),
    candidate.toLowerCase(),
    pluralize(candidate.toLowerCase()),
    singularize(candidate.toLowerCase()),
  ];
  for (const t of tables) {
    if (variants.includes(t.name)) return t.name;
  }
  return null;
}

function tableByName(name: string, tables: TableSchema[]): TableSchema | undefined {
  return tables.find((t) => t.name === name);
}

const TIMESTAMP_TYPES = new Set(['timestamp', 'date']);

const rules: SemanticRule[] = [];

// --- Priority 100: Enum ---
rules.push({
  name: 'enum',
  priority: 100,
  match(col) {
    if (col.logicalType !== 'enum' || !col.enumValues || col.enumValues.length === 0) return null;
    return {
      semanticType: 'enum',
      confidence: 1,
      generator: { kind: 'weighted-categorical', params: { values: col.enumValues } },
    };
  },
});

// --- Priority 95: Check-constrained integer ---
rules.push({
  name: 'check-constrained',
  priority: 95,
  match(col, table) {
    if (col.logicalType !== 'integer') return null;
    if (!table.checkConstraints || table.checkConstraints.length === 0) return null;

    let min: number | null = null;
    let max: number | null = null;

    for (const cc of table.checkConstraints) {
      const expr = cc.expression;

      const gtMatch = expr.match(/\b(\w+)\s*>\s*(\d+)/);
      if (gtMatch && gtMatch[1]?.toLowerCase() === col.name.toLowerCase()) {
        const val = parseInt(gtMatch[2]!, 10);
        if (min === null || val > min) min = val;
      }

      const gteMatch = expr.match(/\b(\w+)\s*>=\s*(\d+)/);
      if (gteMatch && gteMatch[1]?.toLowerCase() === col.name.toLowerCase()) {
        const val = parseInt(gteMatch[2]!, 10);
        if (min === null || val > min) min = val;
      }

      const ltMatch = expr.match(/\b(\w+)\s*<\s*(\d+)/);
      if (ltMatch && ltMatch[1]?.toLowerCase() === col.name.toLowerCase()) {
        const val = parseInt(ltMatch[2]!, 10);
        if (max === null || val < max) max = val;
      }

      const lteMatch = expr.match(/\b(\w+)\s*<=\s*(\d+)/);
      if (lteMatch && lteMatch[1]?.toLowerCase() === col.name.toLowerCase()) {
        const val = parseInt(lteMatch[2]!, 10);
        if (max === null || val < max) max = val;
      }

      const betweenMatch = expr.match(/\b(\w+)\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/i);
      if (betweenMatch && betweenMatch[1]?.toLowerCase() === col.name.toLowerCase()) {
        const bMin = parseInt(betweenMatch[2]!, 10);
        const bMax = parseInt(betweenMatch[3]!, 10);
        if (min === null || bMin > min) min = bMin;
        if (max === null || bMax < max) max = bMax;
      }

      const rangeMatch = expr.match(/\b(\w+)\s+IN\s*\((.+)\)/i);
      if (rangeMatch && rangeMatch[1]?.toLowerCase() === col.name.toLowerCase()) {
        const values = rangeMatch[2]!.split(',').map((v) => parseInt(v.trim(), 10)).filter((v) => !isNaN(v));
        if (values.length > 0) {
          if (min === null || Math.min(...values) > min) min = Math.min(...values);
          if (max === null || Math.max(...values) < max) max = Math.max(...values);
        }
      }
    }

    if (min === null && max === null) return null;

    return {
      semanticType: 'bounded-integer',
      confidence: 0.95,
      generator: {
        kind: 'bounded-integer',
        params: {
          ...(min !== null ? { min } : {}),
          ...(max !== null ? { max } : {}),
        },
      },
    };
  },
});

// --- Priority 90: UUID ---
rules.push({
  name: 'uuid',
  priority: 90,
  match(col) {
    if (col.logicalType === 'uuid') {
      return {
        semanticType: 'uuid',
        confidence: 1,
        generator: { kind: 'uuid', params: {} },
      };
    }
    if (col.logicalType === 'string' && /^uuid/i.test(col.nativeType)) {
      return {
        semanticType: 'uuid',
        confidence: 0.9,
        generator: { kind: 'uuid', params: {} },
      };
    }
    return null;
  },
});

// --- Priority 85: Email ---
rules.push({
  name: 'email',
  priority: 85,
  match(col) {
    if (/^email$/i.test(col.name)) {
      return {
        semanticType: 'email',
        confidence: 1,
        generator: { kind: 'faker', params: { method: 'internet.email' } },
      };
    }
    return null;
  },
});

// --- Priority 84: Phone ---
rules.push({
  name: 'phone',
  priority: 84,
  match(col) {
    if (/phone|telephone|mobile|cell|contact_no/i.test(col.name)) {
      return {
        semanticType: 'phone',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'phone.number' } },
      };
    }
    return null;
  },
});

// --- Priority 83: Name ---
rules.push({
  name: 'name',
  priority: 83,
  match(col) {
    const name = col.name.toLowerCase();
    if (name === 'first_name' || name === 'firstname' || name === 'fname') {
      return {
        semanticType: 'firstName',
        confidence: 1,
        generator: { kind: 'faker', params: { method: 'person.firstName' } },
      };
    }
    if (name === 'last_name' || name === 'lastname' || name === 'lname') {
      return {
        semanticType: 'lastName',
        confidence: 1,
        generator: { kind: 'faker', params: { method: 'person.lastName' } },
      };
    }
    if (name === 'full_name' || name === 'fullname') {
      return {
        semanticType: 'fullName',
        confidence: 1,
        generator: { kind: 'faker', params: { method: 'person.fullName' } },
      };
    }
    return null;
  },
});

// --- Priority 82: Boolean flag ---
rules.push({
  name: 'boolean-flag',
  priority: 82,
  match(col, _table, _schema, _allTables) {
    if (/^is_/i.test(col.name) && col.logicalType === 'boolean') {
      return {
        semanticType: 'boolean',
        confidence: 1,
        generator: { kind: 'boolean-skewed', params: { skew: 0.8 } },
      };
    }
    return null;
  },
});

// --- Priority 81: Timestamp ---
rules.push({
  name: 'timestamp',
  priority: 81,
  match(col, table) {
    if (!TIMESTAMP_TYPES.has(col.logicalType)) return null;

    const name = col.name.toLowerCase();

    if (name === 'created_at' || name === 'createdat') {
      return {
        semanticType: 'timestamp',
        confidence: 1,
        generator: { kind: 'recent-timestamp', params: { weighted: 'recent' } },
      };
    }

    if (name === 'updated_at' || name === 'updatedat') {
      const hasCreatedAt = table.columns.some(
        (c) => (c.name.toLowerCase() === 'created_at' || c.name.toLowerCase() === 'createdat') && TIMESTAMP_TYPES.has(c.logicalType),
      );
      if (hasCreatedAt) {
        return {
          semanticType: 'timestamp',
          confidence: 1,
          generator: { kind: 'dependent-timestamp', params: { dependsOn: 'created_at', min: 'created_at' } },
        };
      }
      return {
        semanticType: 'timestamp',
        confidence: 1,
        generator: { kind: 'recent-timestamp', params: { weighted: 'recent' } },
      };
    }

    if (name === 'deleted_at' || name === 'deletedat') {
      return {
        semanticType: 'timestamp',
        confidence: 1,
        generator: { kind: 'recent-timestamp', params: { weighted: 'recent', nullable: true } },
      };
    }

    if (name.endsWith('_at') || name.endsWith('_date') || name.endsWith('at') || name.endsWith('date')) {
      return {
        semanticType: 'timestamp',
        confidence: 0.9,
        generator: { kind: 'recent-timestamp', params: { weighted: 'recent' } },
      };
    }

    return null;
  },
});

// --- Priority 80: Currency ---
rules.push({
  name: 'currency',
  priority: 80,
  match(col) {
    if (col.logicalType !== 'float' && col.logicalType !== 'integer') return null;
    if (/price|amount|cost|total|balance|unit_price|subtotal|salary|revenue/i.test(col.name)) {
      return {
        semanticType: 'currency',
        confidence: 0.95,
        generator: { kind: 'log-normal-currency', params: { mean: 4, stdDev: 1.5 } },
      };
    }
    return null;
  },
});

// --- Priority 79: Address parts ---
rules.push({
  name: 'address',
  priority: 79,
  match(col) {
    const name = col.name.toLowerCase();
    if (/street|address|addr/i.test(name) && !/email/i.test(name)) {
      return {
        semanticType: 'street',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'location.streetAddress' } },
      };
    }
    if (/city|town/i.test(name)) {
      return {
        semanticType: 'city',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'location.city' } },
      };
    }
    if (/state|province|region/i.test(name)) {
      return {
        semanticType: 'state',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'location.state' } },
      };
    }
    if (/zip|postal|postcode/i.test(name)) {
      return {
        semanticType: 'zip',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'location.zipCode' } },
      };
    }
    if (/country/i.test(name)) {
      return {
        semanticType: 'country',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'location.country' } },
      };
    }
    return null;
  },
});

// --- Priority 78: URL ---
rules.push({
  name: 'url',
  priority: 78,
  match(col) {
    if (/url|website|domain|link|href/i.test(col.name)) {
      return {
        semanticType: 'url',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'internet.url' } },
      };
    }
    return null;
  },
});

// --- Priority 77: IP address ---
rules.push({
  name: 'ip',
  priority: 77,
  match(col) {
    if (/ip_address|ipv4|ipv6|^ip$/i.test(col.name)) {
      return {
        semanticType: 'ip',
        confidence: 0.95,
        generator: { kind: 'faker', params: { method: 'internet.ip' } },
      };
    }
    const native = col.nativeType.toLowerCase();
    if (native === 'inet' || native === 'cidr') {
      return {
        semanticType: 'ip',
        confidence: 0.9,
        generator: { kind: 'faker', params: { method: 'internet.ip' } },
      };
    }
    return null;
  },
});

// --- Priority 76: Latitude / Longitude ---
rules.push({
  name: 'lat-lng',
  priority: 76,
  match(col, table) {
    const name = col.name.toLowerCase();
    if (/^lat(itude)?$/i.test(name)) {
      const hasLng = table.columns.some((c) => /^lng|longitude|lon$/i.test(c.name));
      return {
        semanticType: 'latitude',
        confidence: 0.95,
        generator: {
          kind: 'lat-lng-pair',
          params: {
            pairType: 'latitude',
            ...(hasLng ? { pairedWith: table.columns.find((c) => /^lng|longitude|lon$/i.test(c.name))?.name ?? 'longitude' } : {}),
          },
        },
      };
    }
    if (/^lng|longitude|lon$/i.test(name)) {
      const hasLat = table.columns.some((c) => /^lat(itude)?$/i.test(c.name));
      if (hasLat) {
        return {
          semanticType: 'longitude',
          confidence: 0.95,
          generator: {
            kind: 'lat-lng-pair',
            params: {
              pairType: 'longitude',
              pairedWith: table.columns.find((c) => /^lat(itude)?$/i.test(c.name))?.name ?? 'latitude',
              dependsOn: table.columns.find((c) => /^lat(itude)?$/i.test(c.name))?.name ?? 'latitude',
            },
          },
        };
      }
      return {
        semanticType: 'longitude',
        confidence: 0.85,
        generator: { kind: 'lat-lng-pair', params: { pairType: 'longitude' } },
      };
    }
    return null;
  },
});

// --- Priority 75: Slug ---
rules.push({
  name: 'slug',
  priority: 75,
  match(col, table) {
    if (!/_slug$|^slug$/i.test(col.name)) return null;
    const siblingTitle = table.columns.find(
      (c) => /^name$|^title$/i.test(c.name),
    );
    return {
      semanticType: 'slug',
      confidence: siblingTitle ? 0.95 : 0.8,
      generator: {
        kind: 'derived-slug',
        params: siblingTitle
          ? { sourceColumn: siblingTitle.name, kebabCase: true }
          : { kebabCase: true },
      },
    };
  },
});

// --- Priority 74: Image ---
rules.push({
  name: 'image',
  priority: 74,
  match(col) {
    if (/avatar|photo|image|picture|profile_pic|profilepic/i.test(col.name)) {
      return {
        semanticType: 'imageUrl',
        confidence: 0.9,
        generator: { kind: 'faker', params: { method: 'image.url' } },
      };
    }
    return null;
  },
});

// --- Priority 73: Long text ---
rules.push({
  name: 'long-text',
  priority: 73,
  match(col) {
    if (!/description|bio|notes|comment|body|content|summary|details|about|overview|message|review/i.test(col.name)) return null;
    if (col.logicalType !== 'string') return null;
    if (col.nativeType === 'text' || col.nativeType === 'longtext' || col.nativeType === 'mediumtext') {
      return {
        semanticType: 'longText',
        confidence: 0.9,
        generator: { kind: 'faker', params: { method: 'lorem.paragraphs', count: 3 } },
      };
    }
    if (col.maxLength && col.maxLength >= 100) {
      return {
        semanticType: 'longText',
        confidence: 0.85,
        generator: { kind: 'faker', params: { method: 'lorem.paragraphs', count: 3 } },
      };
    }
    if (col.maxLength && col.maxLength >= 50) {
      return {
        semanticType: 'longText',
        confidence: 0.7,
        generator: { kind: 'faker', params: { method: 'lorem.sentence', count: 2 } },
      };
    }
    return null;
  },
});

// --- Priority 72: FK reference by naming convention ---
rules.push({
  name: 'fk-reference',
  priority: 96,
  match(col, _table, _schema, allTables) {
    const match = col.name.match(FIELD_PATTERN);
    if (!match) return null;

    const candidateName = match[1]!;
    const targetTable = matchesTargetTable(candidateName, allTables);
    if (!targetTable) return null;

    return {
      semanticType: 'foreignKey',
      confidence: 0.8,
      generator: {
        kind: 'fk-reference',
        params: { referencedTable: targetTable, referencedColumn: '_id' },
      },
    };
  },
});

// --- Priority 71: Quantity ---
rules.push({
  name: 'quantity',
  priority: 71,
  match(col) {
    if (col.logicalType !== 'integer') return null;
    if (/quantity|count|qty|num_|number_of|stock/i.test(col.name)) {
      return {
        semanticType: 'quantity',
        confidence: 0.85,
        generator: { kind: 'faker', params: { method: 'number.int', min: 1, max: 100 } },
      };
    }
    return null;
  },
});

// --- Priority 70: SKU ---
rules.push({
  name: 'sku',
  priority: 70,
  match(col) {
    if (/^sku$/i.test(col.name)) {
      return {
        semanticType: 'sku',
        confidence: 0.9,
        generator: { kind: 'faker', params: { method: 'string.alphanumeric', length: 8, casing: 'upper' } },
      };
    }
    return null;
  },
});

// --- Priority 69: Rating ---
rules.push({
  name: 'rating',
  priority: 69,
  match(col, table) {
    if (!/rating|score|stars/i.test(col.name)) return null;
    if (col.logicalType !== 'integer') return null;

    let min = 1;
    let max = 5;

    if (table.checkConstraints) {
      for (const cc of table.checkConstraints) {
        const expr = cc.expression;
        const rangeMatch = expr.match(/\b\w+\s+BETWEEN\s+(\d+)\s+AND\s+(\d+)/i);
        if (rangeMatch) {
          min = parseInt(rangeMatch[1]!, 10);
          max = parseInt(rangeMatch[2]!, 10);
        }
        const inMatch = expr.match(/\b\w+\s+IN\s*\((.+)\)/i);
        if (inMatch) {
          const vals = inMatch[1]!.split(',').map((v) => parseInt(v.trim(), 10)).filter((v) => !isNaN(v));
          if (vals.length > 0) {
            min = Math.min(...vals);
            max = Math.max(...vals);
          }
        }
      }
    }

    return {
      semanticType: 'rating',
      confidence: 0.85,
      generator: { kind: 'bounded-integer', params: { min, max } },
    };
  },
});

// Sort by priority descending
export const PRIORITIZED_RULES = rules.sort((a, b) => b.priority - a.priority);
