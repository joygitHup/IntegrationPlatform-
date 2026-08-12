import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb(): ReturnType<typeof drizzle> {
  if (dbInstance) return dbInstance;

  const dbDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = process.env.DATABASE_PATH || path.join(dbDir, 'app.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  dbInstance = drizzle(sqlite);
  return dbInstance;
}

// 单例导出，首次访问时初始化
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const instance = getDb();
    return (instance as any)[prop];
  },
});
