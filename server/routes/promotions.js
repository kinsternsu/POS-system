import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const { active } = req.query;
    let query = 'SELECT * FROM promotions';
    const params = [];

    if (active === 'true') {
      query += ' WHERE is_active = 1';
    }

    query += ' ORDER BY created_at DESC';
    const promotions = db.prepare(query).all(...params);
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/active', authenticateToken, (req, res) => {
  try {
    const now = new Date().toISOString().split('T')[0];
    const promotions = db.prepare(`
      SELECT * FROM promotions
      WHERE is_active = 1
        AND (start_date IS NULL OR start_date <= ?)
        AND (end_date IS NULL OR end_date >= ?)
      ORDER BY created_at DESC
    `).all(now, now);
    res.json(promotions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, type, value, min_purchase, start_date, end_date } = req.body;

    if (!name || !type || value === undefined) {
      return res.status(400).json({ error: 'name, type, and value are required' });
    }

    if (!['percentage', 'fixed_amount'].includes(type)) {
      return res.status(400).json({ error: "type must be 'percentage' or 'fixed_amount'" });
    }

    if (type === 'percentage' && (value <= 0 || value > 100)) {
      return res.status(400).json({ error: 'Percentage value must be between 0 and 100' });
    }

    if (type === 'fixed_amount' && value <= 0) {
      return res.status(400).json({ error: 'Fixed amount must be greater than 0' });
    }

    const result = db.prepare(`
      INSERT INTO promotions (name, type, value, min_purchase, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, type, value, min_purchase || null, start_date || null, end_date || null);

    const promotion = db.prepare('SELECT * FROM promotions WHERE id = ?').get(result.lastInsertRowid);
    res.json(promotion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, type, value, min_purchase, start_date, end_date, is_active } = req.body;
    const { id } = req.params;

    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    db.prepare(`
      UPDATE promotions
      SET name = ?, type = ?, value = ?, min_purchase = ?, start_date = ?, end_date = ?, is_active = ?
      WHERE id = ?
    `).run(
      name ?? existing.name,
      type ?? existing.type,
      value ?? existing.value,
      min_purchase !== undefined ? min_purchase : existing.min_purchase,
      start_date !== undefined ? start_date : existing.start_date,
      end_date !== undefined ? end_date : existing.end_date,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      id
    );

    const promotion = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    res.json(promotion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Promotion not found' });
    }

    db.prepare('DELETE FROM promotions WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
