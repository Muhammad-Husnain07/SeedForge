import type { LogicalType } from '@seed-forge/core';

const DRIZZLE_TYPE_MAP: Record<string, LogicalType> = {
  PgUUID: 'uuid',
  PgText: 'string',
  PgVarchar: 'string',
  PgChar: 'string',
  PgNumeric: 'float',
  PgDecimal: 'float',
  PgReal: 'float',
  PgDoublePrecision: 'float',
  PgInteger: 'integer',
  PgBigInt: 'integer',
  PgSmallInt: 'integer',
  PgSerial: 'integer',
  PgBigSerial: 'integer',
  PgBoolean: 'boolean',
  PgTimestamp: 'timestamp',
  PgDate: 'date',
  PgJsonb: 'json',
  PgJson: 'json',
  PgEnumColumn: 'enum',
};

export function normalizeDrizzleType(
  columnType: string,
  isEnum: boolean,
): LogicalType {
  if (isEnum) return 'enum';
  return DRIZZLE_TYPE_MAP[columnType] ?? 'string';
}

export function nativeTypeFor(columnType: string, isEnum: boolean): string {
  if (isEnum) return 'enum';
  const name = DRIZZLE_TYPE_MAP[columnType];
  if (!name || name === 'enum') return columnType;
  return columnType;
}
