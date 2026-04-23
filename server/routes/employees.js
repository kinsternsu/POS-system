import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

router.post('/register', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, username, password, pin, role } = req.body;
    
    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Name, username and password are required' });
    }

    const password_hash = bcrypt.hashSync(password, 10);
    
    const stmt = db.prepare(`
      INSERT INTO employees (name, username, password_hash, pin, role)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(name, username, password_hash, pin || null, role || 'cashier');
    
    res.json({ id: result.lastInsertRowid, name, username, role: role || 'cashier' });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const employee = db.prepare('SELECT * FROM employees WHERE username = ? AND is_active = 1').get(username);
    
    if (!employee || !bcrypt.compareSync(password, employee.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: employee.id, username: employee.username, role: employee.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: employee.id, name: employee.name, username: employee.username, role: employee.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    const employees = db.prepare('SELECT id, name, username, role, is_active, created_at FROM employees').all();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, role, is_active, pin } = req.body;
    
    const updates = [];
    const params = [];
    
    if (name) { updates.push('name = ?'); params.push(name); }
    if (role) { updates.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (pin) { updates.push('pin = ?'); params.push(pin); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    
    db.prepare(`UPDATE employees SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE employees SET is_active = 0 WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pin-login', (req, res) => {
  try {
    const { pin } = req.body;
    
    if (!pin) {
      return res.status(400).json({ error: 'PIN required' });
    }

    const employee = db.prepare('SELECT * FROM employees WHERE pin = ? AND is_active = 1').get(pin);
    
    if (!employee) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    const token = jwt.sign(
      { id: employee.id, username: employee.username, role: employee.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: employee.id, name: employee.name, username: employee.username, role: employee.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;