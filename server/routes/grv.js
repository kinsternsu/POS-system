import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

function generateGRVNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `GRV-${year}${month}-${random}`;
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT grv.*, po.po_number, e.name as received_by_name
      FROM goods_received_vouchers grv
      LEFT JOIN purchase_orders po ON grv.purchase_order_id = po.id
      LEFT JOIN employees e ON grv.received_by = e.id
    `;
    
    const params = [];
    if (status) {
      query += ' WHERE grv.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY grv.created_at DESC';
    
    const grvs = db.prepare(query).all(...params);
    res.json(grvs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const grv = db.prepare(`
      SELECT grv.*, po.po_number, po.supplier_id, s.name as supplier_name, e.name as received_by_name
      FROM goods_received_vouchers grv
      LEFT JOIN purchase_orders po ON grv.purchase_order_id = po.id
      LEFT JOIN suppliers s ON po.supplier_id = s.id
      LEFT JOIN employees e ON grv.received_by = e.id
      WHERE grv.id = ?
    `).get(req.params.id);
    
    if (!grv) {
      return res.status(404).json({ error: 'GRV not found' });
    }
    
    const items = db.prepare(`
      SELECT gri.*, p.name as product_name, p.sku, p.barcode
      FROM grv_items gri
      LEFT JOIN products p ON gri.product_id = p.id
      WHERE gri.grv_id = ?
    `).all(req.params.id);
    
    res.json({ ...grv, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { purchase_order_id, notes, items } = req.body;
    
    if (!purchase_order_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Purchase order and items are required' });
    }
    
    const order = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(purchase_order_id);
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    
    if (order.status === 'received') {
      return res.status(400).json({ error: 'Purchase order already fully received' });
    }
    
    const grv_number = generateGRVNumber();
    
    const insertGRV = db.prepare(`
      INSERT INTO goods_received_vouchers (grv_number, purchase_order_id, received_by, notes)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = insertGRV.run(grv_number, purchase_order_id, req.user.id, notes || null);
    const grv_id = result.lastInsertRowid;
    
    const insertItem = db.prepare(`
      INSERT INTO grv_items (grv_id, product_id, quantity, condition, notes)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    for (const item of items) {
      insertItem.run(grv_id, item.product_id, item.quantity, item.condition || 'good', item.notes || null);
      
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
      
      const poi = db.prepare(`
        SELECT * FROM purchase_order_items 
        WHERE purchase_order_id = ? AND product_id = ?
      `).get(purchase_order_id, item.product_id);
      
      if (poi) {
        db.prepare(`
          UPDATE purchase_order_items 
          SET received_quantity = received_quantity + ? 
          WHERE id = ?
        `).run(item.quantity, poi.id);
      }
    }
    
    const allReceived = db.prepare(`
      SELECT 
        SUM(quantity) as total_ordered,
        SUM(received_quantity) as total_received
      FROM purchase_order_items
      WHERE purchase_order_id = ?
    `).get(purchase_order_id);
    
    if (allReceived.total_ordered === allReceived.total_received) {
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('received', purchase_order_id);
      db.prepare('UPDATE goods_received_vouchers SET status = ? WHERE id = ?').run('completed', grv_id);
    } else if (allReceived.total_received > 0) {
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('partial', purchase_order_id);
    }
    
    res.json({ id: grv_id, grv_number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    
    const grv = db.prepare('SELECT * FROM goods_received_vouchers WHERE id = ?').get(id);
    if (!grv) {
      return res.status(404).json({ error: 'GRV not found' });
    }
    
    if (grv.status === 'completed') {
      return res.status(400).json({ error: 'Cannot delete a completed GRV' });
    }
    
    const items = db.prepare('SELECT * FROM grv_items WHERE grv_id = ?').all(id);
    
    for (const item of items) {
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(item.quantity, item.product_id);
      
      const poi = db.prepare(`
        SELECT * FROM purchase_order_items 
        WHERE purchase_order_id = ? AND product_id = ?
      `).get(grv.purchase_order_id, item.product_id);
      
      if (poi) {
        db.prepare(`
          UPDATE purchase_order_items 
          SET received_quantity = received_quantity - ? 
          WHERE id = ?
        `).run(item.quantity, poi.id);
      }
    }
    
    const orderStatus = db.prepare(`
      SELECT 
        SUM(quantity) as total_ordered,
        SUM(received_quantity) as total_received
      FROM purchase_order_items
      WHERE purchase_order_id = ?
    `).get(grv.purchase_order_id);
    
    if (orderStatus.total_received === 0) {
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('pending', grv.purchase_order_id);
    } else if (orderStatus.total_ordered === orderStatus.total_received) {
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('received', grv.purchase_order_id);
    } else {
      db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('partial', grv.purchase_order_id);
    }
    
    db.prepare('DELETE FROM grv_items WHERE grv_id = ?').run(id);
    db.prepare('DELETE FROM goods_received_vouchers WHERE id = ?').run(id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;