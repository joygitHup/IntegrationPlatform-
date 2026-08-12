import { defineConfig } from 'drizzle-kit';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'app.db');

export default defineConfig({
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
  verbose: true,
  strict: true,
});
