import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { logAudit } from './audit.js';

const router = express.Router();

router.get('/requests', authenticateToken, (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT ar.*, p.name as product_name, p.sku,
             r.name as requested_by_name, a.name as approved_by_name
      FROM adjustment_requests ar
      LEFT JOIN products p ON ar.product_id = p.id
      LEFT JOIN employees r ON ar.requested_by = r.id
      LEFT JOIN employees a ON ar.approved_by = a.id
    `;
    
    const params = [];
    if (status) { query += ' WHERE ar.status = ?'; params.push(status); }
    
    query += ' ORDER BY ar.created_at DESC';
    
    const requests = db.prepare(query).all(...params);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/requests', authenticateToken, (req, res) => {
  try {
    const { product_id, new_stock, reason } = req.body;
    const requested_by = req.user.id;
    
    if (!product_id || new_stock === undefined || !reason) {
      return res.status(400).json({ error: 'Product, new stock, and reason are required' });
    }
    
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    if (new_stock === product.stock) {
      return res.status(400).json({ error: 'New stock is same as current stock' });
    }
    
    const result = db.prepare(`
      INSERT INTO adjustment_requests (product_id, requested_by, current_stock, new_stock, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(product_id, requested_by, product.stock, new_stock, reason);
    
    res.json({ id: result.lastInsertRowid, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/requests/:id/approve', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const approved_by = req.user.id;
    
    const request = db.prepare('SELECT * FROM adjustment_requests WHERE id = ?').get(id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request already processed' });
    }
    
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(request.product_id);
    
    db.prepare(`
      UPDATE adjustment_requests 
      SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(approved_by, id);
    
    db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(request.new_stock, request.product_id);
    
    logAudit(
      'adjustment',
      request.product_id,
      request.new_stock - request.current_stock,
      request.current_stock.toString(),
      request.new_stock.toString(),
      approved_by,
      request.reason,
      'adjustment_request',
      id
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/requests/:id/reject', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const approved_by = req.user.id;
    
    db.prepare(`
      UPDATE adjustment_requests 
      SET status = 'rejected', approved_by = ?, approved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(approved_by, id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;