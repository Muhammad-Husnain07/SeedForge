import type { FastifyInstance } from 'fastify';
import { getContext } from '../context.js';

export function schemaRoutes(server: FastifyInstance): void {
  server.get('/schema', () => {
    const ctx = getContext();
    const { schemaHash, dialect, tables } = ctx.schema;
    return {
      schemaHash,
      dialect,
      tables: tables.map((t) => ({
        name: t.name,
        columns: t.columns.map((c) => ({
          name: c.name,
          logicalType: c.logicalType,
          nativeType: c.nativeType,
          nullable: c.nullable,
          isPrimaryKey: c.isPrimaryKey,
          isUnique: c.isUnique,
          enumValues: c.enumValues,
          maxLength: c.maxLength,
          comment: c.comment,
        })),
        primaryKey: t.primaryKey,
        foreignKeys: t.foreignKeys.map((fk) => ({
          columns: fk.columns,
          referencedTable: fk.referencedTable,
          referencedColumns: fk.referencedColumns,
        })),
      })),
    };
  });
}
