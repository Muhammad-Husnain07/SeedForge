import type { LogicalType } from '@seed-forge/core';

const PRISMA_TYPE_MAP: Record<string, LogicalType> = {
  String: 'string',
  Int: 'integer',
  BigInt: 'integer',
  Float: 'float',
  Decimal: 'float',
  Boolean: 'boolean',
  DateTime: 'timestamp',
  Json: 'json',
  Bytes: 'binary',
};

export function normalizePrismaType(
  fieldType: string,
  isId: boolean,
  hasUuidDefault: boolean,
): LogicalType {
  if (isId && hasUuidDefault) return 'uuid';
  const mapped = PRISMA_TYPE_MAP[fieldType];
  return mapped ?? 'string';
}

export function nativeTypeFor(fieldType: string, hasUuidDefault: boolean): string {
  if (fieldType === 'String' && hasUuidDefault) return 'uuid';
  return fieldType;
}
