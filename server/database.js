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

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
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
      reorder_point INTEGER DEFAULT 0,
      reorder_quantity INTEGER DEFAULT 0,
      supplier_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number TEXT UNIQUE NOT NULL,
      supplier_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      total_amount REAL DEFAULT 0,
      notes TEXT,
      expected_date DATE,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (created_by) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      received_quantity INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS goods_received_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grv_number TEXT UNIQUE NOT NULL,
      purchase_order_id INTEGER NOT NULL,
      received_by INTEGER,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id),
      FOREIGN KEY (received_by) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS grv_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grv_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      condition TEXT DEFAULT 'good',
      notes TEXT,
      FOREIGN KEY (grv_id) REFERENCES goods_received_vouchers(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
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

  try { db.exec(`ALTER TABLE products ADD COLUMN reorder_point INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE products ADD COLUMN reorder_quantity INTEGER`); } catch(e) {}
  try { db.exec(`ALTER TABLE products ADD COLUMN supplier_id INTEGER`); } catch(e) {}

  const adminExists = db.prepare('SELECT id FROM employees WHERE username = ?').get('admin');
  if (!adminExists) {
    const password_hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO employees (name, username, password_hash, pin, role) VALUES (?, ?, ?, ?, ?)').run('Administrator', 'admin', password_hash, '0000', 'admin');
    console.log('Default admin user created: admin / admin123 / PIN: 0000');
  }

  console.log('Database initialized successfully');
}

export default db;