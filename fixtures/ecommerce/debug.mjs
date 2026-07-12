import { createJiti } from 'jiti';
import path from 'path';

const jiti = createJiti(process.cwd(), { interopDefault: true, moduleCache: false });
try {
  const mod = await jiti.import(path.resolve('fixtures/ecommerce/schema.drizzle.ts'));
  console.log('Module type:', typeof mod);
  console.log('Is array:', Array.isArray(mod));
  if (mod && typeof mod === 'object') {
    console.log('Keys:', Object.keys(mod));
    for (const [key, value] of Object.entries(mod)) {
      console.log(`Export: ${key} (${typeof value})`);
      if (value && typeof value === 'object') {
        console.log('  ownKeys:', Object.keys(value));
        console.log('  _ exists:', '_' in value);
        if (value._) {
          console.log('  _ ownKeys:', Object.keys(value._));
        }
        console.log('  enumValues:', value.enumValues);
      }
    }
  } else {
    const entries = mod && typeof mod === 'object' ? Object.entries(mod) : [];
    console.log('Entries:', entries.length);
  }
} catch (err) {
  console.error('Error:', err.message);
  console.error(err.stack);
}
