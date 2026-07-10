export type LogicalType =
  | 'string'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'enum'
  | 'binary'
  | 'array';

export interface ColumnSchema {
  name: string;
  logicalType: LogicalType;
  nativeType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  defaultValue?: unknown;
  enumValues?: string[];
  maxLength?: number;
  precision?: number;
  scale?: number;
  comment?: string;
}

export interface ForeignKey {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: string;
  onUpdate?: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
  uniqueConstraints: string[][];
  checkConstraints?: { name: string; expression: string }[];
  estimatedRowCount?: number;
  comment?: string;
}

export interface DatabaseSchema {
  dialect: 'postgres' | 'mysql' | 'mongodb' | 'prisma' | 'drizzle';
  tables: TableSchema[];
  introspectedAt: string;
  schemaHash: string;
}
