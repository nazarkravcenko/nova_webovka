import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export class StoreDatabase {
  constructor(dbPath, dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
        stock INTEGER NOT NULL CHECK(stock >= 0),
        category TEXT NOT NULL,
        accent TEXT NOT NULL,
        image_path TEXT NOT NULL DEFAULT '',
        featured INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        email TEXT NOT NULL,
        total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
        status TEXT NOT NULL DEFAULT 'new',
        variable_symbol TEXT NOT NULL DEFAULT '',
        bank_account TEXT NOT NULL DEFAULT '4875022083 / 0800',
        ready_at TEXT,
        shipped_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        price_cents INTEGER NOT NULL CHECK(price_cents >= 0)
      );
    `);
    this.addColumn('products', 'image_path', "TEXT NOT NULL DEFAULT ''");
    this.addColumn('orders', 'variable_symbol', "TEXT NOT NULL DEFAULT ''");
    this.addColumn('orders', 'bank_account', "TEXT NOT NULL DEFAULT '4875022083 / 0800'");
    this.addColumn('orders', 'ready_at', 'TEXT');
    this.addColumn('orders', 'shipped_at', 'TEXT');
  }

  addColumn(table, column, definition) {
    const columns = this.all(`PRAGMA table_info(${table})`).map((item) => item.name);
    if (!columns.includes(column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  run(sql, params = {}) {
    return this.db.prepare(sql).run(params);
  }

  get(sql, params = {}) {
    return this.db.prepare(sql).get(params);
  }

  all(sql, params = {}) {
    return this.db.prepare(sql).all(params);
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
