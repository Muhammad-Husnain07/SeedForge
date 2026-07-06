# SeedForge E-Commerce Example

This directory contains a ready-to-run SeedForge configuration for an e-commerce database.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Node.js](https://nodejs.org/) >= 18.17

## Quick Start

```bash
# 1. Start the database
docker compose -f ../../fixtures/ecommerce/docker-compose.yml up -d

# 2. Seed the database
npx seedforge seed -c seedforge.config.ts
```

## What it does

The config connects to a Postgres database with 7 tables (users, products, categories, product_categories, orders, order_items, reviews) and generates realistic relational data:

- **250 users** with power-user and inactive personas
- **40–60 products** across 15 categories
- **Pareto-distributed orders** — 20% of users generate ~80% of orders
- **1–8 order items per order**
- **0–15 reviews per product**
- **Consistent geo.city data** via the `@seedforge/plugin-geo` plugin

## Configuration

See [seedforge.config.ts](./seedforge.config.ts) for the full config. For documentation on all options, refer to the [Config DSL Reference](../../docs/config-dsl.md).
