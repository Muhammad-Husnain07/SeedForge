import type { LogicalType } from '@seed-forge/core';

const PG_TYPE_MAP: Record<string, LogicalType> = {
  integer: 'integer',
  int: 'integer',
  int4: 'integer',
  bigint: 'integer',
  int8: 'integer',
  smallint: 'integer',
  int2: 'integer',
  oid: 'integer',
  serial: 'integer',
  bigserial: 'integer',
  smallserial: 'integer',
  numeric: 'float',
  decimal: 'float',
  real: 'float',
  float4: 'float',
  'double precision': 'float',
  float8: 'float',
  money: 'float',
  boolean: 'boolean',
  bool: 'boolean',
  'character varying': 'string',
  varchar: 'string',
  character: 'string',
  char: 'string',
  text: 'string',
  'text[]': 'array',
  date: 'date',
  timestamp: 'timestamp',
  'timestamp without time zone': 'timestamp',
  timestamptz: 'timestamp',
  'timestamp with time zone': 'timestamp',
  json: 'json',
  jsonb: 'json',
  uuid: 'uuid',
  bytea: 'binary',
};

export function normalizePgType(
  dataType: string,
  udtName: string,
  enumTypeNames: Set<string>,
): LogicalType {
  if (dataType === 'USER-DEFINED' && enumTypeNames.has(udtName)) {
    return 'enum';
  }
  if (dataType === 'ARRAY') {
    return 'array';
  }
  const key = dataType.toLowerCase();
  return PG_TYPE_MAP[key] ?? 'string';
}
