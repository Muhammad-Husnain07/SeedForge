import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';

const workerScript = resolve('packages/core/dist/generate/worker.js');
console.log('START', workerScript);

const parentPKs = { users: ['a','b','c','d','e','f','g','h','i','j'] };

const w = new Worker(workerScript, {
  workerData: {
    tableName: 'orders',
    tableSchema: {
      name: 'orders',
      columns: [
        { name: 'id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: true, isUnique: true },
        { name: 'user_id', logicalType: 'uuid', nativeType: 'uuid', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'status', logicalType: 'enum', nativeType: 'order_status', nullable: false, isPrimaryKey: false, isUnique: false, enumValues: ['pending','shipped','delivered','cancelled'] },
        { name: 'total', logicalType: 'float', nativeType: 'numeric', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'created_at', logicalType: 'timestamp', nativeType: 'timestamptz', nullable: false, isPrimaryKey: false, isUnique: false },
        { name: 'updated_at', logicalType: 'timestamp', nativeType: 'timestamptz', nullable: true, isPrimaryKey: false, isUnique: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [{ columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'], onDelete: 'CASCADE' }],
      uniqueConstraints: [],
    },
    tablePlan: {
      count: 1,
      fields: [
        { column: 'id', generator: { kind: 'uuid', params: {} } },
        { column: 'user_id', generator: { kind: 'uuid', params: {} } },
        { column: 'status', generator: { kind: 'enum', params: { values: ['pending','shipped','delivered','cancelled'] } } },
        { column: 'total', generator: { kind: 'float', params: { min: 1, max: 10000, decimals: 2 } } },
        { column: 'created_at', generator: { kind: 'datetime', params: {} } },
        { column: 'updated_at', generator: { kind: 'datetime', params: {} } },
      ],
      countPerParent: { users: { kind: 'uniformInt', params: { min: 1, max: 3 } } },
      personas: [],
      overrides: [],
    },
    seed: 42,
    parentPKs,
    batchSize: 1000,
  },
  eval: false,
});

w.on('message', m => {
  if (m.type === 'error') {
    console.error('ERR_MSG:', m.message);
    if (m.stack) console.error('STACK:', m.stack.substring(0,300));
  } else console.log('MSG:', m.type, m.table, m.rows?.length, m.pks?.length);
});
w.on('error', e => console.error('EVENT_ERR:', e?.message));
w.on('exit', c => console.log('EXIT:', c));

setTimeout(() => { console.log('DONE'); process.exit(0); }, 8000);
