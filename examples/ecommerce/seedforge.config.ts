import { defineConfig } from '@seed-forge/core';

export default defineConfig({
  connection: {
    dialect: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'ecommerce',
    user: 'seedforge',
  },
  plugins: ['@seed-forge/plugin-geo'],
  tables: {
    users: {
      count: 250,
      fields: {
        city: { kind: 'geo.city', params: { country: 'United States' } },
      },
      personas: [
        {
          name: 'power_user',
          selectionWeight: 0.15,
          overrides: [
            { field: 'first_name' },
            { field: 'last_name' },
          ],
          cascades: { orders: 8 },
        },
        {
          name: 'inactive',
          selectionWeight: 0.1,
          overrides: [
            { field: 'is_active', generator: { kind: 'boolean', params: { probability: 0 } } },
          ],
        },
      ],
    },
    products: {
      count: { kind: 'uniformInt', params: { min: 40, max: 60 } },
    },
    categories: {
      count: 15,
    },
    product_categories: {
      count: { kind: 'paretoInt', params: { min: 1, max: 5, alpha: 1.5 } },
    },
    orders: {
      countPerParent: {
        users: { kind: 'paretoInt', params: { min: 0, max: 30, alpha: 1.16 } },
      },
    },
    order_items: {
      countPerParent: {
        orders: { kind: 'uniformInt', params: { min: 1, max: 8 } },
      },
    },
    reviews: {
      countPerParent: {
        products: { kind: 'uniformInt', params: { min: 0, max: 15 } },
      },
    },
  },
});
