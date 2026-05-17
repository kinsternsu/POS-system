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

const VALID_STATUSES = ['draft', 'pending', 'authorized', 'sent', 'ordered', 'partial', 'received'];
const STATUS_FLOW = {
  draft: ['pending', 'authorized'],
  pending: ['authorized'],
  authorized: ['sent'],
  sent: ['ordered'],
  ordered: ['partial', 'received'],
  partial: ['received'],
  received: []
};

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = STATUS_FLOW[from] || [];
  return allowed.includes(to);
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT po.*, s.name as supplier_name, s.email as supplier_email,
        e.name as created_by_name, a.name as approved_by_name,
        (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN employees e ON po.created_by = e.id
      LEFT JOIN employees a ON po.approved_by = a.id
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
      SELECT po.*, s.name as supplier_name, s.email as supplier_email,
        s.phone as supplier_phone, s.payment_terms, s.discount_rate, s.tax_code,
        e.name as created_by_name, a.name as approved_by_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN employees e ON po.created_by = e.id
      LEFT JOIN employees a ON po.approved_by = a.id
      WHERE po.id = ?
    `).get(req.params.id);
    
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    const items = db.prepare(`
      SELECT poi.*, p.name as product_name, p.sku, p.barcode, p.stock as current_stock,
        p.sales_velocity, p.avg_cost
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
    const { supplier_id, expected_date, notes, items, tax_amount, discount_amount, shipping_cost } = req.body;
    
    if (!supplier_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Supplier and items are required' });
    }
    
    const po_number = generatePONumber();
    let total_amount = 0;
    
    for (const item of items) {
      const qty = item.quantity || 0;
      const cost = item.unit_cost || 0;
      const discPct = item.discount_percent || 0;
      const lineDisc = qty * cost * (discPct / 100);
      const lineTotal = (qty * cost) - lineDisc + ((qty * cost - lineDisc) * (item.tax_percent || 0) / 100);
      total_amount += lineTotal;
    }
    
    const subTotal = items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unit_cost || 0), 0);
    const headerDisc = discount_amount || 0;
    const headerTax = tax_amount || 0;
    const shipping = shipping_cost || 0;
    const grandTotal = subTotal - headerDisc + headerTax + shipping;
    
    const insertPO = db.prepare(`
      INSERT INTO purchase_orders (po_number, supplier_id, status, total_amount,
        tax_amount, discount_amount, shipping_cost, notes, expected_date, created_by)
      VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = insertPO.run(po_number, supplier_id, grandTotal, headerTax, headerDisc, shipping, notes || null, expected_date || null, req.user.id);
    const po_id = result.lastInsertRowid;
    
    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost,
        discount_percent, tax_percent, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const item of items) {
      const qty = item.quantity || 0;
      const cost = item.unit_cost || 0;
      const discPct = item.discount_percent || 0;
      const taxPct = item.tax_percent || 0;
      const lineSub = qty * cost;
      const lineDisc = lineSub * (discPct / 100);
      const lineTax = (lineSub - lineDisc) * (taxPct / 100);
      const lineTotal = lineSub - lineDisc + lineTax;
      
      insertItem.run(po_id, item.product_id, qty, cost, discPct, taxPct, lineTotal);
    }
    
    res.json({ id: po_id, po_number, total_amount: grandTotal, status: 'draft' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status, expected_date, notes, tax_amount, discount_amount, shipping_cost, items } = req.body;
    
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    if (!po) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    if (po.status === 'received') {
      return res.status(400).json({ error: 'Cannot modify a received purchase order' });
    }
    
    if (status && !canTransition(po.status, status)) {
      return res.status(400).json({
        error: `Cannot transition from '${po.status}' to '${status}'. Allowed: ${(STATUS_FLOW[po.status] || []).join(', ') || 'none'}`
      });
    }
    
    const dbTrans = db.transaction(() => {
      const updates = [];
      const params = [];
      
      if (status) {
        updates.push('status = ?');
        params.push(status);
        if (status === 'authorized') {
          updates.push('approved_by = ?');
          updates.push('approved_at = ?');
          params.push(req.user.id);
          params.push(new Date().toISOString());
        }
        if (status === 'sent') {
          updates.push('sent_at = ?');
          params.push(new Date().toISOString());
        }
      }
      if (expected_date !== undefined) { updates.push('expected_date = ?'); params.push(expected_date); }
      if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
      if (tax_amount !== undefined) { updates.push('tax_amount = ?'); params.push(tax_amount); }
      if (discount_amount !== undefined) { updates.push('discount_amount = ?'); params.push(discount_amount); }
      if (shipping_cost !== undefined) { updates.push('shipping_cost = ?'); params.push(shipping_cost); }
      
      if (items) {
        db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(id);
        
        const insertItem = db.prepare(`
          INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost,
            discount_percent, tax_percent, line_total)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        let total = 0;
        for (const item of items) {
          const qty = item.quantity || 0;
          const cost = item.unit_cost || 0;
          const discPct = item.discount_percent || 0;
          const taxPct = item.tax_percent || 0;
          const lineSub = qty * cost;
          const lineDisc = lineSub * (discPct / 100);
          const lineTax = (lineSub - lineDisc) * (taxPct / 100);
          const lineTotal = lineSub - lineDisc + lineTax;
          total += lineTotal;
          insertItem.run(id, item.product_id, qty, cost, discPct, taxPct, lineTotal);
        }
        
        const disc = discount_amount !== undefined ? discount_amount : (po.discount_amount || 0);
        const tax = tax_amount !== undefined ? tax_amount : (po.tax_amount || 0);
        const ship = shipping_cost !== undefined ? shipping_cost : (po.shipping_cost || 0);
        const grandTotal = total - disc + tax + ship;
        updates.push('total_amount = ?');
        params.push(grandTotal);
      }
      
      if (updates.length > 0) {
        params.push(id);
        db.prepare(`UPDATE purchase_orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
    });
    
    dbTrans();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/items', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { product_id, quantity, unit_cost, discount_percent, tax_percent } = req.body;
    
    if (!product_id || !quantity || !unit_cost) {
      return res.status(400).json({ error: 'Product, quantity and unit cost are required' });
    }
    
    const order = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    if (order.status === 'received') {
      return res.status(400).json({ error: 'Cannot modify a received purchase order' });
    }
    
    const qty = quantity || 0;
    const cost = unit_cost || 0;
    const discPct = discount_percent || 0;
    const taxPct = tax_percent || 0;
    const lineSub = qty * cost;
    const lineDisc = lineSub * (discPct / 100);
    const lineTax = (lineSub - lineDisc) * (taxPct / 100);
    const lineTotal = lineSub - lineDisc + lineTax;
    
    const insertItem = db.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost,
        discount_percent, tax_percent, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    insertItem.run(id, product_id, qty, cost, discPct, taxPct, lineTotal);
    
    const total = db.prepare(`
      SELECT SUM(line_total) as total
      FROM purchase_order_items
      WHERE purchase_order_id = ?
    `).get(id);
    
    db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(total.total || 0, id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/items/:itemId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { quantity, unit_cost, discount_percent, tax_percent } = req.body;
    
    const order = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
    if (!order || order.status === 'received') {
      return res.status(400).json({ error: 'Cannot modify item in received order' });
    }
    
    const updates = [];
    const params = [];
    
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (unit_cost !== undefined) { updates.push('unit_cost = ?'); params.push(unit_cost); }
    if (discount_percent !== undefined) { updates.push('discount_percent = ?'); params.push(discount_percent); }
    if (tax_percent !== undefined) { updates.push('tax_percent = ?'); params.push(tax_percent); }
    
    const existing = db.prepare('SELECT * FROM purchase_order_items WHERE id = ?').get(itemId);
    if (existing) {
      const q = quantity !== undefined ? quantity : existing.quantity;
      const c = unit_cost !== undefined ? unit_cost : existing.unit_cost;
      const d = discount_percent !== undefined ? discount_percent : existing.discount_percent;
      const t = tax_percent !== undefined ? tax_percent : existing.tax_percent;
      const lineSub = q * c;
      const lineDisc = lineSub * (d / 100);
      const lineTax = (lineSub - lineDisc) * (t / 100);
      const lineTotal = lineSub - lineDisc + lineTax;
      updates.push('line_total = ?');
      params.push(lineTotal);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(itemId);
    db.prepare(`UPDATE purchase_order_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    const total = db.prepare(`
      SELECT SUM(line_total) as total
      FROM purchase_order_items
      WHERE purchase_order_id = ?
    `).get(id);
    
    db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(total.total || 0, id);
    
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
      SELECT SUM(line_total) as total
      FROM purchase_order_items
      WHERE purchase_order_id = ?
    `).get(id);
    
    db.prepare('UPDATE purchase_orders SET total_amount = ? WHERE id = ?').run(total.total || 0, id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/submit', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status !== 'draft') return res.status(400).json({ error: 'Only draft orders can be submitted' });
    
    db.prepare('UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?')
      .run('pending', req.user.id, new Date().toISOString(), id);
    
    res.json({ success: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (po.status !== 'pending') return res.status(400).json({ error: 'Only pending orders can be approved' });
    
    db.prepare('UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?')
      .run('authorized', req.user.id, new Date().toISOString(), id);
    
    res.json({ success: true, status: 'authorized' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/mark-sent', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id);
    
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });
    if (!['pending', 'authorized'].includes(po.status)) {
      return res.status(400).json({ error: 'Order must be pending or authorized to mark as sent' });
    }
    
    db.prepare('UPDATE purchase_orders SET status = ?, sent_at = ? WHERE id = ?')
      .run('sent', new Date().toISOString(), id);
    
    res.json({ success: true, status: 'sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const order = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(id);
    
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (['received', 'ordered', 'sent'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot delete a purchase order with status '${order.status}'` });
    }
    
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
