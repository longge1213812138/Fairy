/**
 * 阶段 3 任务 A：SQLite 存储层（单文件库 + 确定性幂等迁移）。
 *
 * 表结构严格按 docs/DEV_PLAN.md §7；迁移沿用蓝本 invariant：
 * - migrations 全部 IF NOT EXISTS 幂等执行；
 * - kv.schema_version 记录当前版本；
 * - db 版本 > 已知版本 → 抛错 fail-visible，绝不写覆盖用户数据；
 * - 迁移包在事务里执行；重复 open 同一文件不报错（幂等）。
 */

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Migration {
  version: number;
  up(db: Db): void;
}

/** 迁移必须按 version 升序、确定性、幂等（全部 IF NOT EXISTS） */
export const migrations: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions(
          id TEXT PRIMARY KEY,
          title TEXT,
          kind TEXT DEFAULT 'chat',
          created_at INT,
          updated_at INT
        );
        CREATE TABLE IF NOT EXISTS messages(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          role TEXT,
          content TEXT,
          meta TEXT,
          created_at INT
        );
        CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
      `);
    }
  }
];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version;

/**
 * 打开（必要时创建）fairy.db 并执行待应用迁移。
 * 目录不存在自动创建；迁移失败会关闭句柄后抛出。
 */
export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    runMigrations(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

function runMigrations(db: Db): void {
  // kv 是 schema_version 的载体，先于迁移幂等建出（§7 中 kv 本身也是 v1 表）
  db.exec('CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)');

  const row = db.prepare("SELECT v FROM kv WHERE k = 'schema_version'").get() as
    | { v: string | null }
    | undefined;
  const current = row?.v == null ? 0 : Number.parseInt(row.v, 10);
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(
      `fairy.db schema_version 非法（${String(row?.v)}），拒绝打开以免覆盖用户数据`
    );
  }
  if (current > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `fairy.db schema 版本 ${current} 高于程序已知版本 ${LATEST_SCHEMA_VERSION}，拒绝打开以免覆盖用户数据`
    );
  }

  const pending = migrations.filter((m) => m.version > current);
  if (pending.length === 0) return;

  db.transaction(() => {
    for (const step of pending) {
      step.up(db);
    }
    db.prepare(
      "INSERT INTO kv(k, v) VALUES('schema_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v"
    ).run(String(LATEST_SCHEMA_VERSION));
  })();
}
