import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

function logAudit(actionType, productId, quantityChange, oldValue, newValue, userId, reason = null, referenceType = null, referenceId = null) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (action_type, product_id, quantity_change, old_value, new_value, user_id, reason, reference_type, reference_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(actionType, productId, quantityChange, oldValue, newValue, userId, reason, referenceType, referenceId);
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const { product_id, user_id, action_type, start_date, end_date, limit = 100 } = req.query;
    
    let query = `
      SELECT al.*, p.name as product_name, p.sku, e.name as user_name
      FROM audit_logs al
      LEFT JOIN products p ON al.product_id = p.id
      LEFT JOIN employees e ON al.user_id = e.id
      WHERE 1=1
    `;
    const params = [];
    
    if (product_id) { query += ' AND al.product_id = ?'; params.push(product_id); }
    if (user_id) { query += ' AND al.user_id = ?'; params.push(user_id); }
    if (action_type) { query += ' AND al.action_type = ?'; params.push(action_type); }
    if (start_date) { query += ' AND DATE(al.created_at) >= ?'; params.push(start_date); }
    if (end_date) { query += ' AND DATE(al.created_at) <= ?'; params.push(end_date); }
    
    query += ' ORDER BY al.created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const logs = db.prepare(query).all(...params);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', authenticateToken, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    const movements = db.prepare(`
      SELECT action_type, SUM(quantity_change) as total_change, COUNT(*) as count
      FROM audit_logs
      WHERE DATE(created_at) = ?
      GROUP BY action_type
    `).all(today);
    
    const topProducts = db.prepare(`
      SELECT p.name, p.id, SUM(ABS(quantity_change)) as movement
      FROM audit_logs al
      JOIN products p ON al.product_id = p.id
      WHERE DATE(al.created_at) = ? AND quantity_change < 0
      GROUP BY p.id
      ORDER BY movement DESC
      LIMIT 5
    `).all(today);
    
    res.json({ movements, topProducts, date: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { logAudit };
export default router;