import express from 'express';
import db from '../database.js';
import { authenticateToken } from '../auth.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const { limit = 50, offset = 0, date, status } = req.query;
    
    let query = `
      SELECT r.*, e.name as employee_name, t.id as original_tx_id
      FROM returns r
      LEFT JOIN employees e ON r.employee_id = e.id
      LEFT JOIN transactions t ON r.original_transaction_id = t.id
    `;
    const params = [];
    const conditions = [];
    
    if (date) {
      conditions.push('DATE(r.created_at) = ?');
      params.push(date);
    }
    
    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const returns = db.prepare(query).all(...params);
    
    const parsed = returns.map(r => ({
      ...r,
      items: JSON.parse(r.items)
    }));
    
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { original_transaction_id, items, reason, status = 'circulated', payment_method = 'cash' } = req.body;
    const employee_id = req.user.id;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    
    if (!reason) {
      return res.status(400).json({ error: 'Return reason is required' });
    }
    
    let refund_amount = 0;
    const processedItems = [];
    
    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.product_id);
      
      if (!product) {
        return res.status(400).json({ error: `Product ${item.product_id} not found` });
      }
      
      const qty = item.quantity || 1;
      const itemTotal = product.price * qty;
      refund_amount += itemTotal;
      
      processedItems.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        quantity: qty,
        total: itemTotal
      });
      
      if (product.stock !== null) {
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, product.id);
      }
    }
    
    const stmt = db.prepare(`
      INSERT INTO returns (original_transaction_id, employee_id, items, reason, status, refund_amount, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      original_transaction_id || null,
      employee_id,
      JSON.stringify(processedItems),
      reason,
      status,
      refund_amount,
      payment_method
    );
    
    res.json({ 
      id: result.lastInsertRowid,
      items: processedItems,
      refund_amount,
      reason,
      status,
      payment_method,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', authenticateToken, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let whereClause = '';
    const params = [];
    
    if (startDate && endDate) {
      whereClause = 'WHERE DATE(created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      whereClause = 'WHERE DATE(created_at) >= ?';
      params.push(startDate);
    } else if (endDate) {
      whereClause = 'WHERE DATE(created_at) <= ?';
      params.push(endDate);
    }
    
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_returns,
        COALESCE(SUM(refund_amount), 0) as total_refunds,
        SUM(CASE WHEN status = 'circulated' THEN 1 ELSE 0 END) as circulated_count,
        SUM(CASE WHEN status = 'damaged' THEN 1 ELSE 0 END) as damaged_count
      FROM returns ${whereClause}
    `).get(...params);
    
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;