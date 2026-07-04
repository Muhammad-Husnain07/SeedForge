import { faker } from '@faker-js/faker';
import type { PRNG } from '../distributions/prng.js';
import { uniformInt, uniformReal } from '../distributions/uniform.js';
import { weightedCategorical } from '../distributions/weighted.js';
import { normal } from '../distributions/normal.js';
import { recencyWeighted } from '../distributions/recency.js';
import type { GeneratorSpec } from '../semantic/types.js';
import type { GenerationPlan, SeedContext } from '../config/types.js';
import type { TableSchema } from '../types/index.js';

function uuidV4(prng: PRNG): string {
  const hex = [
    prng.nextInt().toString(16).padStart(8, '0'),
    prng.nextInt().toString(16).padStart(8, '0'),
    prng.nextInt().toString(16).padStart(8, '0'),
    prng.nextInt().toString(16).padStart(8, '0'),
  ].join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${['8', '9', 'a', 'b'][prng.nextInt() & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function resolveDeep(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, part: string) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, obj);
}

function fakerMethod(method: string, prng: PRNG, params: Record<string, unknown>): unknown {
  faker.seed(prng.nextInt());
  const fn = resolveDeep(faker as unknown as Record<string, unknown>, method);
  if (typeof fn === 'function') {
    const args = (params.args as unknown[]) ?? [];
    return fn(...args);
  }
  return `[unresolved-faker:${method}]`;
}

function slugify(val: unknown): string {
  if (val == null) return '';
  return String(val)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateFieldValue(
  generator: GeneratorSpec,
  row: Record<string, unknown>,
  prng: PRNG,
  pkCache: Map<string, unknown[]>,
  tableSchema: TableSchema,
  _tablePlan: GenerationPlan['tables'][string],
  ctx: { table: string; rowIndex: number },
): unknown {
  const { kind, params } = generator;

  switch (kind) {
    case 'uuid': {
      return uuidV4(prng);
    }

    case 'faker': {
      const method = params.method as string;
      return fakerMethod(method, prng, params);
    }

    case 'weighted-categorical': {
      const values = params.values as Record<string, number>;
      if (!values) {
        if (params.enumValues) {
          const ev = params.enumValues as string[];
          const weights: Record<string, number> = {};
          for (const v of ev) weights[v] = 1;
          return weightedCategorical(prng, weights);
        }
        throw new Error('weighted-categorical requires values or enumValues');
      }
      return weightedCategorical(prng, values);
    }

    case 'bounded-integer': {
      const min = (params.min as number) ?? 0;
      const max = (params.max as number) ?? 100;
      return uniformInt(prng, min, max);
    }

    case 'boolean-skewed':
    case 'boolean': {
      const prob = (params.probability as number) ?? 0.5;
      return prng.next() < prob;
    }

    case 'recent-timestamp': {
      const withinDays = (params.withinDays as number) ?? 365;
      const skew = (params.weighted as 'recent' | 'uniform' | 'old') ?? 'recent';
      return recencyWeighted(prng, withinDays, skew);
    }

    case 'dependent-timestamp': {
      const dependsOn = params.dependsOn as string;
      const baseVal = dependsOn ? row[dependsOn] : undefined;
      const base = baseVal instanceof Date ? baseVal.getTime() : Date.now() - 86400000 * 30;
      const maxOffset = (params.maxOffsetMs as number) ?? 86400000 * 7;
      return new Date(base + uniformReal(prng, 0, maxOffset));
    }

    case 'log-normal-currency': {
      const mean = (params.mean as number) ?? 4;
      const stdDev = (params.stdDev as number) ?? 1.5;
      return Math.round(Math.exp(normal(prng, mean, stdDev)) * 100) / 100;
    }

    case 'lat-lng-pair': {
      const pairType = params.pairType as string;
      if (pairType === 'latitude' || pairType === 'lat') {
        return uniformReal(prng, -90, 90);
      }
      return uniformReal(prng, -180, 180);
    }

    case 'derived-slug': {
      const sourceCol = params.sourceColumn as string;
      const val = sourceCol ? row[sourceCol] : undefined;
      return slugify(val);
    }

    case 'fk-reference': {
      const refTable = params.referencedTable as string;
      const cache = pkCache.get(refTable);
      if (!cache || cache.length === 0) {
        return null;
      }
      const idx = uniformInt(prng, 0, cache.length - 1);
      return cache[idx];
    }

    case 'paretoInt':
    case 'pareto': {
      const pMin = (params.min as number) ?? 1;
      const pMax = (params.max as number) ?? 100;
      const pAlpha = (params.alpha as number) ?? 1.16;
      const u = prng.next();
      const factor = 1 - u * (1 - (pMin / pMax) ** pAlpha);
      if (factor <= 0) return pMin;
      const raw = pMin * factor ** (-1 / pAlpha);
      return Math.min(pMax, Math.max(pMin, Math.round(raw)));
    }

    case 'uniformInt': {
      const uMin = (params.min as number) ?? 0;
      const uMax = (params.max as number) ?? 100;
      return uniformInt(prng, uMin, uMax);
    }

    case 'uniformReal': {
      const rMin = (params.min as number) ?? 0;
      const rMax = (params.max as number) ?? 1;
      return uniformReal(prng, rMin, rMax);
    }

    case 'derived': {
      const fn = params.fn as (row: Record<string, unknown>, ctx: SeedContext) => unknown;
      if (typeof fn === 'function') {
        const seedCtx: SeedContext = {
          rootSeed: 0,
          table: ctx.table,
          column: '',
          rowIndex: ctx.rowIndex,
        };
        return fn(row, seedCtx);
      }
      throw new Error('derived field missing fn function');
    }

    case 'fullName':
    case 'firstName':
    case 'lastName':
    case 'email':
    case 'phone':
    case 'street':
    case 'city':
    case 'state':
    case 'zip':
    case 'country':
    case 'url':
    case 'ip':
    case 'imageUrl':
    case 'longText':
    case 'sku':
    case 'slug':
    case 'quantity': {
      const fakerMap: Record<string, string> = {
        fullName: 'person.fullName',
        firstName: 'person.firstName',
        lastName: 'person.lastName',
        email: 'internet.email',
        phone: 'phone.number',
        street: 'location.streetAddress',
        city: 'location.city',
        state: 'location.state',
        zip: 'location.zipCode',
        country: 'location.country',
        url: 'internet.url',
        ip: 'internet.ip',
        imageUrl: 'image.url',
        longText: 'lorem.paragraphs',
        sku: 'string.alphanumeric',
        slug: 'lorem.slug',
        quantity: 'number.int',
      };
      const method = fakerMap[kind] || kind;
      return fakerMethod(method, prng, { ...params, kind });
    }

    default: {
      if ((kind as string).startsWith('faker.')) {
        return fakerMethod(kind, prng, params);
      }
      throw new Error(`unknown generator kind: '${kind}' for column`);
    }
  }
}
