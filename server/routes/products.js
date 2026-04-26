import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const products = db.prepare(`
      SELECT p.*, s.name as supplier_name 
      FROM products p 
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.is_active = 1 
      ORDER BY p.name
    `).all();
    console.log('GET /products - found:', products.length);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', authenticateToken, (req, res) => {
  try {
    const { q } = req.query;
    const query = `%${q}%`;
    const products = db.prepare(`
      SELECT * FROM products 
      WHERE is_active = 1 AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)
    `).all(query, query, query);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { name, sku, barcode, price, cost_price, stock, category, image_url, reorder_point, reorder_quantity, supplier_id, pricing_type, price_per_unit, unit_measure } = req.body;
    console.log('POST /products - adding:', name, price);
    
    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const stmt = db.prepare(`
      INSERT INTO products (name, sku, barcode, price, cost_price, stock, category, image_url, reorder_point, reorder_quantity, supplier_id, pricing_type, price_per_unit, unit_measure)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(name, sku || null, barcode || null, price, cost_price || 0, stock || 0, category || null, image_url || null, reorder_point || 0, reorder_quantity || 0, supplier_id || null, pricing_type || 'fixed', price_per_unit || 0, unit_measure || 'each');
    console.log('Product added with ID:', result.lastInsertRowid);
    
    res.json({ id: result.lastInsertRowid, name, price });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'SKU or barcode already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, sku, barcode, price, cost_price, stock, category, image_url, is_active, reorder_point, reorder_quantity, supplier_id, pricing_type, price_per_unit, unit_measure } = req.body;
    
    const updates = [];
    const params = [];
    
    if (name) { updates.push('name = ?'); params.push(name); }
    if (sku !== undefined) { updates.push('sku = ?'); params.push(sku); }
    if (barcode !== undefined) { updates.push('barcode = ?'); params.push(barcode); }
    if (price !== undefined) { updates.push('price = ?'); params.push(price); }
    if (cost_price !== undefined) { updates.push('cost_price = ?'); params.push(cost_price); }
    if (stock !== undefined) { updates.push('stock = ?'); params.push(stock); }
    if (category !== undefined) { updates.push('category = ?'); params.push(category); }
    if (image_url !== undefined) { updates.push('image_url = ?'); params.push(image_url); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (reorder_point !== undefined) { updates.push('reorder_point = ?'); params.push(reorder_point); }
    if (reorder_quantity !== undefined) { updates.push('reorder_quantity = ?'); params.push(reorder_quantity); }
    if (supplier_id !== undefined) { updates.push('supplier_id = ?'); params.push(supplier_id); }
    if (pricing_type !== undefined) { updates.push('pricing_type = ?'); params.push(pricing_type); }
    if (price_per_unit !== undefined) { updates.push('price_per_unit = ?'); params.push(price_per_unit); }
    if (unit_measure !== undefined) { updates.push('unit_measure = ?'); params.push(unit_measure); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    
    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;