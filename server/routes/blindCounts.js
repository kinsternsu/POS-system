import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { logAudit } from './audit.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT bc.*, e.name as counted_by_name,
             (SELECT COUNT(*) FROM blind_count_items WHERE blind_count_id = bc.id) as item_count,
             (SELECT SUM(variance) FROM blind_count_items WHERE blind_count_id = bc.id) as total_variance
      FROM blind_counts bc
      LEFT JOIN employees e ON bc.counted_by = e.id
    `;
    
    const params = [];
    if (status) { query += ' WHERE bc.status = ?'; params.push(status); }
    
    query += ' ORDER BY bc.created_at DESC';
    
    const counts = db.prepare(query).all(...params);
    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const count = db.prepare(`
      SELECT bc.*, e.name as counted_by_name
      FROM blind_counts bc
      LEFT JOIN employees e ON bc.counted_by = e.id
      WHERE bc.id = ?
    `).get(req.params.id);
    
    if (!count) {
      return res.status(404).json({ error: 'Blind count not found' });
    }
    
    const items = db.prepare(`
      SELECT bci.*, p.name as product_name, p.sku, p.stock as system_count
      FROM blind_count_items bci
      JOIN products p ON bci.product_id = p.id
      WHERE bci.blind_count_id = ?
    `).all(req.params.id);
    
    res.json({ ...count, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { notes } = req.body;
    const counted_by = req.user.id;
    const count_date = new Date().toISOString().split('T')[0];
    
    const result = db.prepare(`
      INSERT INTO blind_counts (count_date, counted_by, notes)
      VALUES (?, ?, ?)
    `).run(count_date, counted_by, notes || null);
    
    const count_id = result.lastInsertRowid;
    
    const products = db.prepare('SELECT id, stock FROM products WHERE is_active = 1').all();
    
    const insertItem = db.prepare(`
      INSERT INTO blind_count_items (blind_count_id, product_id, system_count)
      VALUES (?, ?, ?)
    `);
    
    for (const p of products) {
      insertItem.run(count_id, p.id, p.stock);
    }
    
    res.json({ id: count_id, item_count: products.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;
    
    const count = db.prepare('SELECT * FROM blind_counts WHERE id = ?').get(id);
    if (!count) {
      return res.status(404).json({ error: 'Blind count not found' });
    }
    
    if (count.status === 'completed') {
      return res.status(400).json({ error: 'Count already completed' });
    }
    
    let totalVariance = 0;
    
    for (const item of items) {
      const variance = (item.physical_count || 0) - (item.system_count || 0);
      totalVariance += variance;
      
      db.prepare(`
        UPDATE blind_count_items 
        SET physical_count = ?, variance = ?
        WHERE id = ?
      `).run(item.physical_count, variance, item.id);
    }
    
    db.prepare(`
      UPDATE blind_counts 
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(id);
    
    logAudit(
      'blind_count',
      null,
      totalVariance,
      null,
      null,
      req.user.id,
      `Blind count completed. Total variance: ${totalVariance}`,
      'blind_count',
      id
    );
    
    res.json({ success: true, total_variance: totalVariance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/adjust', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { blind_count_id, adjust_all } = req.body;
    const user_id = req.user.id;
    
    const count = db.prepare(`
      SELECT bc.*, bci.product_id, bci.physical_count, bci.system_count
      FROM blind_counts bc
      JOIN blind_count_items bci ON bc.id = bci.blind_count_id
      WHERE bc.id = ? AND bci.variance != 0
    `).all(blind_count_id);
    
    if (!count.length) {
      return res.status(400).json({ error: 'No variances to adjust' });
    }
    
    const countInfo = count[0];
    
    for (const item of count) {
      if (item.variance !== 0) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        
        db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(item.physical_count, item.product_id);
        
        logAudit(
          'blind_count_adjustment',
          item.product_id,
          item.variance,
          item.system_count.toString(),
          item.physical_count.toString(),
          user_id,
          'Blind count adjustment',
          'blind_count',
          blind_count_id
        );
      }
    }
    
    res.json({ success: true, adjusted_count: count.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;