import { MongoClient } from 'mongodb';
import { inferFromDocuments } from './infer.js';
import type { DatabaseSchema } from '@seedforge/core';

export interface MongoIntrospectConfig {
  connectionString: string;
  database: string;
}

export async function introspect(
  config: MongoIntrospectConfig,
): Promise<Omit<DatabaseSchema, 'schemaHash'>> {
  const client = new MongoClient(config.connectionString);

  try {
    await client.connect();
    const db = client.db(config.database);
    const collections = await db.listCollections().toArray();
    const tables = [];

    for (const collInfo of collections) {
      const coll = db.collection(collInfo.name);
      const count = await coll.estimatedDocumentCount();
      const sampleSize = Math.min(count, 1000);

      let documents: Record<string, unknown>[];
      if (sampleSize === 0) {
        documents = [];
      } else {
        const pipeline =
          sampleSize < count
            ? [{ $sample: { size: sampleSize } }]
            : [];
        documents = await coll.aggregate(pipeline).toArray();
      }

      const table = inferFromDocuments(collInfo.name, documents);
      table.estimatedRowCount = count;
      tables.push(table);
    }

    return {
      dialect: 'mongodb',
      tables,
      introspectedAt: new Date().toISOString(),
    };
  } finally {
    await client.close();
  }
}
