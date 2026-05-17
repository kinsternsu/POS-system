import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const suppliers = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM products WHERE supplier_id = s.id AND is_active = 1) as product_count
      FROM suppliers s
      WHERE s.is_active = 1
      ORDER BY s.name
    `).all();
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    
    const products = db.prepare(`
      SELECT sp.*, p.name as product_name, p.sku, p.stock, p.price, p.cost_price
      FROM supplier_products sp
      JOIN products p ON sp.product_id = p.id
      WHERE sp.supplier_id = ?
      ORDER BY p.name
    `).all(req.params.id);
    
    res.json({ ...supplier, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, contact_person, email, phone, address, payment_terms, tax_code, discount_rate, lead_time } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const stmt = db.prepare(`
      INSERT INTO suppliers (name, contact_person, email, phone, address, payment_terms, tax_code, discount_rate, lead_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(name, contact_person || null, email || null, phone || null, address || null, payment_terms || 30, tax_code || null, discount_rate || 0, lead_time || 7);
    res.json({ id: result.lastInsertRowid, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, contact_person, email, phone, address, is_active, payment_terms, tax_code, discount_rate, lead_time } = req.body;
    
    const updates = [];
    const params = [];
    
    if (name) { updates.push('name = ?'); params.push(name); }
    if (contact_person !== undefined) { updates.push('contact_person = ?'); params.push(contact_person); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (payment_terms !== undefined) { updates.push('payment_terms = ?'); params.push(payment_terms); }
    if (tax_code !== undefined) { updates.push('tax_code = ?'); params.push(tax_code); }
    if (discount_rate !== undefined) { updates.push('discount_rate = ?'); params.push(discount_rate); }
    if (lead_time !== undefined) { updates.push('lead_time = ?'); params.push(lead_time); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    db.prepare(`UPDATE suppliers SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE suppliers SET is_active = 0 WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/products', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, supplier_item_code, lead_time, is_preferred } = req.body;
    
    if (!product_id) {
      return res.status(400).json({ error: 'Product ID is required' });
    }
    
    const product = db.prepare('SELECT cost_price FROM products WHERE id = ? AND is_active = 1').get(product_id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    db.prepare(`
      INSERT INTO supplier_products (supplier_id, product_id, supplier_item_code, last_cost, average_cost, lead_time, is_preferred)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, product_id, supplier_item_code || null, product.cost_price, product.cost_price, lead_time || null, is_preferred ? 1 : 0);
    
    if (is_preferred) {
      db.prepare('UPDATE products SET supplier_id = ? WHERE id = ?').run(id, product_id);
    }
    
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Product already mapped to this supplier' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:supplierId/products/:productId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { supplierId, productId } = req.params;
    db.prepare('DELETE FROM supplier_products WHERE supplier_id = ? AND product_id = ?').run(supplierId, productId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/history', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    
    const pos = db.prepare(`
      SELECT po.id, po.po_number, po.status, po.total_amount, po.created_at
      FROM purchase_orders po
      WHERE po.supplier_id = ?
      ORDER BY po.created_at DESC
      LIMIT 20
    `).all(id);
    
    const payments = db.prepare(`
      SELECT ap.id, ap.amount, ap.paid_amount, ap.status, ap.due_date, ap.created_at
      FROM accounts_payable ap
      WHERE ap.supplier_id = ?
      ORDER BY ap.created_at DESC
      LIMIT 20
    `).all(id);
    
    res.json({ purchase_orders: pos, accounts_payable: payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
