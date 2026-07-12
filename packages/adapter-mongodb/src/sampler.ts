import { MongoClient } from 'mongodb';
import type { MongoIntrospectConfig } from './introspect.js';

export async function sample(
  config: MongoIntrospectConfig,
  collectionName: string,
  maxRows?: number,
): Promise<Record<string, unknown>[]> {
  const client = new MongoClient(config.connectionString);
  try {
    await client.connect();
    const db = client.db(config.database);
    const coll = db.collection(collectionName);
    const count = await coll.estimatedDocumentCount();
    const size = maxRows !== undefined ? Math.min(maxRows, count) : count;
    if (size === 0) return [];
    const pipeline = size < count ? [{ $sample: { size } }] : [];
    return await coll.aggregate(pipeline).toArray();
  } finally {
    await client.close();
  }
}
