import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { logAudit } from './audit.js';

const router = express.Router();

function generateGRVNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `GRV-${year}${month}-${random}`;
}

function recalcAVC(productId) {
  const product = db.prepare('SELECT stock, avg_cost, cost_price FROM products WHERE id = ?').get(productId);
  if (!product || product.stock <= 0) return;
  const avg = product.avg_cost || product.cost_price || 0;
  db.prepare('UPDATE products SET cost_price = ? WHERE id = ?').run(avg, productId);
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT grv.*, po.po_number, po.total_amount as po_total,
        s.name as supplier_name, e.name as received_by_name
      FROM goods_received_vouchers grv
      LEFT JOIN purchase_orders po ON grv.purchase_order_id = po.id
      LEFT JOIN suppliers s ON po.supplier_id = s.id
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
      SELECT grv.*, po.po_number, po.supplier_id, po.discount_amount, po.tax_amount, po.shipping_cost,
        s.name as supplier_name, s.payment_terms, e.name as received_by_name
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
      SELECT gri.*, p.name as product_name, p.sku, p.barcode, p.stock as current_stock
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
    
    if (!['sent', 'ordered', 'partial'].includes(order.status)) {
      return res.status(400).json({
        error: `Purchase order must be 'sent' or 'ordered' to receive goods. Current status: '${order.status}'`
      });
    }
    
    const poItems = db.prepare(`
      SELECT poi.*, p.name as product_name
      FROM purchase_order_items poi
      JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = ?
    `).all(purchase_order_id);
    
    const poItemsMap = {};
    for (const pi of poItems) {
      poItemsMap[pi.product_id] = pi;
    }
    
    const grv_number = generateGRVNumber();
    let apTotal = 0;
    
    const discrepancies = [];
    const dbTrans = db.transaction(() => {
      const insertGRV = db.prepare(`
        INSERT INTO goods_received_vouchers (grv_number, purchase_order_id, received_by, notes)
        VALUES (?, ?, ?, ?)
      `);
      
      const result = insertGRV.run(grv_number, purchase_order_id, req.user.id, notes || null);
      const grv_id = result.lastInsertRowid;
      
      const insertItem = db.prepare(`
        INSERT INTO grv_items (grv_id, product_id, quantity, condition, notes,
          received_cost, quantity_ordered, unit_cost_ordered)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const item of items) {
        const poi = poItemsMap[item.product_id];
        const qtyOrdered = poi ? poi.quantity : 0;
        const unitCostOrdered = poi ? poi.unit_cost : 0;
        const receivedCost = item.received_cost || unitCostOrdered;
        
        insertItem.run(grv_id, item.product_id, item.quantity,
          item.condition || 'good', item.notes || null,
          receivedCost, qtyOrdered, unitCostOrdered);
        
        if (item.quantity !== qtyOrdered) {
          discrepancies.push({
            product_id: item.product_id,
            product_name: poi ? poi.product_name : 'Unknown',
            field: 'quantity',
            expected: qtyOrdered,
            received: item.quantity
          });
        }
        
        if (receivedCost !== unitCostOrdered) {
          discrepancies.push({
            product_id: item.product_id,
            product_name: poi ? poi.product_name : 'Unknown',
            field: 'cost',
            expected: unitCostOrdered,
            received: receivedCost
          });
        }
        
        const productBefore = db.prepare('SELECT stock, avg_cost, cost_price FROM products WHERE id = ?').get(item.product_id);
        const oldStock = productBefore ? productBefore.stock : 0;
        const oldAvgCost = productBefore ? (productBefore.avg_cost || productBefore.cost_price || 0) : 0;
        
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.quantity, item.product_id);
        
        const newTotalStock = oldStock + item.quantity;
        const newAvgCost = newTotalStock > 0
          ? ((oldAvgCost * oldStock) + (receivedCost * item.quantity)) / newTotalStock
          : receivedCost;
        
        db.prepare('UPDATE products SET avg_cost = ? WHERE id = ?').run(Math.round(newAvgCost * 4) / 4, item.product_id);
        db.prepare('UPDATE products SET last_po_cost = ? WHERE id = ?').run(receivedCost, item.product_id);
        
        recalcAVC(item.product_id);
        
        const productAfter = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
        const newStock = productAfter ? productAfter.stock : 0;
        
        logAudit('grv', item.product_id, item.quantity, oldStock.toString(), newStock.toString(),
          req.user.id, `GRV receipt${receivedCost !== unitCostOrdered ? ' (cost changed from ' + unitCostOrdered + ' to ' + receivedCost + ')' : ''}`,
          'grv', grv_id);
        
        if (poi) {
          db.prepare(`
            UPDATE purchase_order_items
            SET received_quantity = received_quantity + ?
            WHERE id = ?
          `).run(item.quantity, poi.id);
        }
        
        apTotal += receivedCost * item.quantity;
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
      
      const supplier = db.prepare('SELECT payment_terms FROM suppliers WHERE id = ?').get(order.supplier_id);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + (supplier ? supplier.payment_terms : 30));
      
      db.prepare(`
        INSERT INTO accounts_payable (supplier_id, grv_id, po_id, amount, paid_amount, status, due_date, reference, created_by)
        VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?)
      `).run(order.supplier_id, grv_id, purchase_order_id, apTotal, dueDate.toISOString().split('T')[0], grv_number, req.user.id);
    });
    
    dbTrans();
    
    res.json({
      id: (() => {
        const g = db.prepare('SELECT id FROM goods_received_vouchers WHERE grv_number = ?').get(grv_number);
        return g ? g.id : null;
      })(),
      grv_number,
      discrepancies: discrepancies.length > 0 ? discrepancies : undefined
    });
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
      return res.status(400).json({ error: 'Cannot delete a completed GRV. Create a credit note instead.' });
    }
    
    const items = db.prepare('SELECT * FROM grv_items WHERE grv_id = ?').all(id);
    
    const dbTrans = db.transaction(() => {
      for (const item of items) {
        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(item.quantity, item.product_id);
        
        const product = db.prepare('SELECT stock, avg_cost FROM products WHERE id = ?').get(item.product_id);
        if (product && product.stock > 0) {
          recalcAVC(item.product_id);
        }
        
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
        db.prepare("UPDATE purchase_orders SET status = 'sent' WHERE id = ?").run(grv.purchase_order_id);
      } else if (orderStatus.total_ordered === orderStatus.total_received) {
        db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('received', grv.purchase_order_id);
      } else {
        db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run('partial', grv.purchase_order_id);
      }
      
      db.prepare('DELETE FROM accounts_payable WHERE grv_id = ?').run(id);
      db.prepare('DELETE FROM grv_items WHERE grv_id = ?').run(id);
      db.prepare('DELETE FROM goods_received_vouchers WHERE id = ?').run(id);
    });
    
    dbTrans();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/discrepancies', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    
    const grv = db.prepare('SELECT * FROM goods_received_vouchers WHERE id = ?').get(id);
    if (!grv) return res.status(404).json({ error: 'GRV not found' });
    
    const items = db.prepare(`
      SELECT gri.*, p.name as product_name, p.sku
      FROM grv_items gri
      JOIN products p ON gri.product_id = p.id
      WHERE gri.grv_id = ?
    `).all(id);
    
    const discrepancies = items
      .filter(item => item.quantity !== item.quantity_ordered || item.received_cost !== item.unit_cost_ordered)
      .map(item => ({
        product_id: item.product_id,
        product_name: item.product_name,
        sku: item.sku,
        qty_ordered: item.quantity_ordered,
        qty_received: item.quantity,
        qty_variance: item.quantity - item.quantity_ordered,
        cost_ordered: item.unit_cost_ordered,
        cost_received: item.received_cost,
        cost_variance: (item.received_cost || 0) - (item.unit_cost_ordered || 0)
      }));
    
    res.json(discrepancies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
