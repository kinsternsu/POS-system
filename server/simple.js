import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'pos.db');
const db = new Database(dbPath);
const JWT_SECRET = 'pos_system_secret_key_2024';

function initDB() {
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
  `);
  
  const admin = db.prepare('SELECT id FROM employees WHERE username = ?').get('admin');
  if (!admin) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO employees (name, username, password_hash, pin, role) VALUES (?, ?, ?, ?, ?)').run('Administrator', 'admin', hash, '0000', 'admin');
    console.log('Admin user created');
  }
}

initDB();

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript', 
  '.css': 'text/css'
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  
  if (url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  
  if (url === '/api/employees/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        const emp = db.prepare('SELECT * FROM employees WHERE username = ? AND is_active = 1').get(username);
        if (!emp || !bcrypt.compareSync(password, emp.password_hash)) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Invalid credentials' }));
          return;
        }
        const token = jwt.sign({ id: emp.id, role: emp.role }, JWT_SECRET, { expiresIn: '24h' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token, user: { id: emp.id, name: emp.name, role: emp.role } }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  let filePath = url === '/' ? '/login.html' : url;
  const fullPath = path.join(__dirname, '..', filePath);
  const ext = path.extname(fullPath);
  
  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      res.end(content);
    }
  });
});

server.listen(3000, '127.0.0.1', () => {
  console.log('Server running at http://127.0.0.1:3000');
});