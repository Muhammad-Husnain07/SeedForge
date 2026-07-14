import type { LogicalType } from '@seed-forge/core';

const SQLITE_TYPE_MAP: Record<string, LogicalType> = {
  int: 'integer',
  integer: 'integer',
  tinyint: 'integer',
  smallint: 'integer',
  mediumint: 'integer',
  bigint: 'integer',
  'unsigned bigint': 'integer',
  int2: 'integer',
  int8: 'integer',
  real: 'float',
  double: 'float',
  'double precision': 'float',
  float: 'float',
  numeric: 'float',
  decimal: 'float',
  boolean: 'boolean',
  text: 'string',
  clob: 'string',
  varchar: 'string',
  'character varying': 'string',
  char: 'string',
  nchar: 'string',
  'native character': 'string',
  blob: 'binary',
  date: 'date',
  datetime: 'timestamp',
  timestamp: 'timestamp',
  json: 'json',
  uuid: 'uuid',
};

const SQLITE_AFFINITY_PRIORITY: Record<string, string[]> = {
  integer: [
    'INT', 'INTEGER', 'TINYINT', 'SMALLINT', 'MEDIUMINT',
    'BIGINT', 'UNSIGNED BIG INT', 'INT2', 'INT8',
  ],
  text: [
    'TEXT', 'CLOB', 'VARCHAR', 'CHARACTER VARYING',
    'CHAR', 'NCHAR', 'NATIVE CHARACTER',
  ],
  blob: ['BLOB'],
  real: ['REAL', 'DOUBLE', 'DOUBLE PRECISION', 'FLOAT'],
  numeric: ['NUMERIC', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME'],
};

export function normalizeSqliteType(declaredType: string): LogicalType {
  if (!declaredType || declaredType.trim() === '') {
    return 'string';
  }

  const upper = declaredType.trim().toUpperCase();
  const simplified = upper
    .replace(/\(\d+\)/g, '')
    .replace(/\(\d+,\s*\d+\)/g, '')
    .trim();

  if (upper.includes('TIMESTAMP') || simplified === 'TIMESTAMP') {
    return 'timestamp';
  }

  const direct = SQLITE_TYPE_MAP[simplified.toLowerCase()];
  if (direct) return direct;

  for (const [affinity, keywords] of Object.entries(SQLITE_AFFINITY_PRIORITY)) {
    for (const kw of keywords) {
      if (simplified === kw) {
        const mapped = SQLITE_TYPE_MAP[affinity.toLowerCase()];
        if (mapped) return mapped;
      }
    }
  }

  if (/json/i.test(upper)) return 'json';
  if (/uuid/i.test(upper)) return 'uuid';

  const firstWord = upper.split(/\s+/)[0];
  if (firstWord) {
    const mapped = SQLITE_TYPE_MAP[firstWord.toLowerCase()];
    if (mapped) return mapped;
  }

  return 'string';
}
