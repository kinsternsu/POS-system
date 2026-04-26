import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

function generatePONumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `PO-${year}${month}-${random}`;
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT po.*, s.name as supplier_name, s.email as supplier_email, e.name as created_by_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN employees e ON po.created_by = e.id
    `;
    
    const params = [];
    if (status) {
      query += ' WHERE po.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY po.created_at DESC';
    
    const orders = db.prepare(query).all(...params);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const order = db.prepare(`
      SELECT po.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      WHERE po.id = ?
    `).get(req.params.id);
    
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const items = db.prepare(`
      SELECT poi.*, p.name as product_name, p.sku, p.barcode
      FROM purchase_order_items poi
      LEFT JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = ?
    `).all(req.params.id);
    
    res.json({ ...order, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { supplier_id, expected_date, notes, items } = req.body;
    
    if (!supplier_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Supplier and items are required' });
    }
    
    const po_number = generatePONumber();
    let total_amount = 0;
    
    for (const item of items) {
      total_amount += item.quantity * item.unit_cost;
    }
    
    const insertPO = db.prepare(`
      INSERT INTO purchase_orders (po_number, supplier_id, status, total_amount, notes, expected_date, created_by)
      VALUES (?, ?, 'pending', ?, ?, ?, ?)
    `);
    
    const result = insertPO.run(po_number, supplier_id, total_amount, notes || null, expected_date || null, req.user.id);
    const po_id = result.lastInsertRowid;
    
    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
      VALUES (?, ?, ?, ?)
    `);
    
    for (const item of items) {
      insertItem.run(po_id, item.product_id, item.quantity, item.unit_cost);
    }
    
    res.json({ id: po_id, po_number, total_amount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status, expected_date, notes } = req.body;
    
    const updates = [];
    const params = [];
    
    if (status) { 
      updates.push('status = ?'); 
      params.push(status);
    }
    if (expected_date !== undefined) { 
      updates.push('expected_date = ?'); 
      params.push(expected_date); 
    }
    if (notes !== undefined) { 
      updates.push('notes = ?'); 
      params.push(notes); 
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    db.prepare(`UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/items', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, quantity, unit_cost } = req.body;
    
    if (!product_id || !quantity || !unit_cost) {
      return res.status(400).json({ error: 'Product, quantity and unit cost are required' });
    }
    
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
      VALUES (?, ?, ?, ?)
    `);
    
    insertItem.run(id, product_id, quantity, unit_cost);
    
    const total = db.prepare(`
      SELECT SUM(quantity * unit_cost) as total 
      FROM purchase_order_items 
      WHERE purchase_order_id = ?
    `).get(id);
    
    db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(total.total, id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/items/:itemId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id, itemId } = req.params;
    
    db.prepare('DELETE FROM purchase_order_items WHERE id = ? AND purchase_order_id = ?').run(itemId, id);
    
    const total = db.prepare(`
      SELECT SUM(quantity * unit_cost) as total 
      FROM purchase_order_items 
      WHERE purchase_order_id = ?
    `).get(id);
    
    db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(total.total || 0, id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const order = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
    
    if (order && order.status === 'received') {
      return res.status(400).json({ error: 'Cannot delete a received purchase order' });
    }
    
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;