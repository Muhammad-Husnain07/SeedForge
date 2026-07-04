import type { LogicalType } from '@seedforge/core';

const MYSQL_TYPE_MAP: Record<string, LogicalType> = {
  tinyint: 'integer',
  smallint: 'integer',
  mediumint: 'integer',
  int: 'integer',
  integer: 'integer',
  bigint: 'integer',
  decimal: 'float',
  dec: 'float',
  float: 'float',
  double: 'float',
  numeric: 'float',
  real: 'float',
  char: 'string',
  varchar: 'string',
  tinytext: 'string',
  text: 'string',
  mediumtext: 'string',
  longtext: 'string',
  date: 'date',
  datetime: 'timestamp',
  timestamp: 'timestamp',
  time: 'string',
  year: 'integer',
  json: 'json',
  binary: 'binary',
  varbinary: 'binary',
  tinyblob: 'binary',
  blob: 'binary',
  mediumblob: 'binary',
  longblob: 'binary',
};

export function isTinyInt1(dataType: string, columnType: string): boolean {
  return (
    dataType.toLowerCase() === 'tinyint' &&
    /^tinyint\(1\)$/i.test(columnType)
  );
}

export function parseMySqlEnumValues(columnType: string): string[] | null {
  const match = columnType.match(/^enum\((.+)\)$/i);
  if (!match) return null;

  const values: string[] = [];
  let current = '';
  let inQuote = false;

  for (const ch of match[1]) {
    if (ch === "'") {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) values.push(current);

  return values;
}

export function normalizeMySqlType(
  dataType: string,
  columnType: string,
  isEnum: boolean,
): LogicalType {
  if (isEnum) return 'enum';
  const key = dataType.toLowerCase();
  if (isTinyInt1(dataType, columnType)) return 'boolean';
  return MYSQL_TYPE_MAP[key] ?? 'string';
}
