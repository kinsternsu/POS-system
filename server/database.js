import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'pos.db');

const db = new Database(dbPath);

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      pin TEXT,
      role TEXT DEFAULT 'cashier',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      barcode TEXT,
      price REAL NOT NULL,
      cost_price REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      category TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      items TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL DEFAULT 0,
      total REAL NOT NULL,
      payment_method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'completed',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_transaction_id INTEGER,
      employee_id INTEGER NOT NULL,
      items TEXT NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'circulated',
      refund_amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'cash',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (original_transaction_id) REFERENCES transactions(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('store_name', 'My POS Store');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '0');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('currency', 'USD');
  `);

  const adminExists = db.prepare('SELECT id FROM employees WHERE username = ?').get('admin');
  if (!adminExists) {
    const password_hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO employees (name, username, password_hash, pin, role) VALUES (?, ?, ?, ?, ?)').run('Administrator', 'admin', password_hash, '0000', 'admin');
    console.log('Default admin user created: admin / admin123 / PIN: 0000');
  }

  console.log('Database initialized successfully');
}

export default db;