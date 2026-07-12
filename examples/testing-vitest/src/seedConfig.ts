import type { SeedForgeConfig } from '@seed-forge/core';

export const seedConfig: SeedForgeConfig = {
  connection: {
    dialect: 'postgres',
    connectionString: '',  // filled at runtime via DATABASE_URL env var
  },
  tables: {
    users: {
      count: 10,
      fields: {
        id: { kind: 'uuid', params: {} },
        email: { kind: 'email', params: {} },
        referred_by: { kind: 'uuid', params: {} },
        role: {
          kind: 'weighted-categorical',
          params: { enumValues: ['customer', 'admin'] },
        },
      },
    },
    products: {
      count: 5,
      fields: {
        id: { kind: 'uuid', params: {} },
        name: { kind: 'fullName', params: {} },
      },
    },
    tags: {
      count: 3,
      fields: {
        id: { kind: 'uuid', params: {} },
        name: { kind: 'slug', params: {} },
      },
    },
    product_tags: {
      count: 8,
      fields: {
        product_id: { kind: 'uuid', params: {} },
        tag_id: { kind: 'uuid', params: {} },
      },
    },
    orders: {
      countPerParent: {
        users: { kind: 'uniformInt', params: { min: 1, max: 3 } },
      },
      fields: {
        id: { kind: 'uuid', params: {} },
        user_id: { kind: 'uuid', params: {} },
        total: { fn: () => 100 },
        status: {
          kind: 'weighted-categorical',
          params: {
            enumValues: ['pending', 'shipped', 'delivered', 'cancelled'],
          },
        },
      },
    },
    order_items: {
      countPerParent: {
        orders: { kind: 'uniformInt', params: { min: 1, max: 3 } },
      },
      fields: {
        id: { kind: 'uuid', params: {} },
        order_id: { kind: 'uuid', params: {} },
        product_id: { kind: 'uuid', params: {} },
        quantity: { kind: 'bounded-integer', params: { min: 1, max: 100 } },
        unit_price: {
          kind: 'log-normal-currency',
          params: { mean: 3, stdDev: 0.8 },
        },
      },
    },
    reviews: {
      countPerParent: {
        products: { kind: 'uniformInt', params: { min: 0, max: 3 } },
      },
      fields: {
        id: { kind: 'uuid', params: {} },
        product_id: { kind: 'uuid', params: {} },
        user_id: { kind: 'uuid', params: {} },
      },
    },
  },
};
