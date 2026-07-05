import { useState, useEffect } from 'react';

interface ColumnSchema {
  name: string;
  logicalType: string;
  nativeType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isUnique: boolean;
  enumValues?: string[];
  maxLength?: number;
  comment?: string;
}

interface ForeignKeyInfo {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
}

interface SchemaData {
  schemaHash: string;
  dialect: string;
  tables: TableSchema[];
}

export function useSchema() {
  const [schema, setSchema] = useState<SchemaData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/schema')
      .then((r) => r.json() as Promise<SchemaData>)
      .then(setSchema)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return { schema, loading };
}
