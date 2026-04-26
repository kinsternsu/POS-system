import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

function checkLowStock() {
  const lowStockItems = db.prepare(`
    SELECT 
      p.id,
      p.name,
      p.stock,
      p.reorder_point,
      p.reorder_quantity,
      p.supplier_id,
      p.cost_price,
      s.name as supplier_name,
      s.email as supplier_email
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.is_active = 1 
      AND p.reorder_point > 0 
      AND p.stock <= p.reorder_point
    ORDER BY p.stock ASC
  `).all();

  return lowStockItems;
}

function checkPendingPO(productId) {
  const pending = db.prepare(`
    SELECT poi.* 
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.purchase_order_id = po.id
    WHERE poi.product_id = ? 
      AND po.status IN ('pending', 'ordered', 'partial')
  `).all(productId);

  return pending.length > 0;
}

function autoCreateReorderPO() {
  const lowStockItems = checkLowStock();
  const results = [];

  const groupedBySupplier = {};
  
  for (const item of lowStockItems) {
    if (!item.supplier_id) continue;
    if (checkPendingPO(item.id)) continue;
    
    if (!groupedBySupplier[item.supplier_id]) {
      groupedBySupplier[item.supplier_id] = {
        supplier_id: item.supplier_id,
        supplier_name: item.supplier_name,
        supplier_email: item.supplier_email,
        items: []
      };
    }
    
    groupedBySupplier[item.supplier_id].items.push({
      product_id: item.id,
      product_name: item.name,
      quantity: item.reorder_quantity || 10,
      unit_cost: item.cost_price || 0
    });
  }

  for (const supplierId in groupedBySupplier) {
    const supplier = groupedBySupplier[supplierId];
    
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    const po_number = `PO-${year}${month}-${random}`;
    
    let total_amount = 0;
    for (const item of supplier.items) {
      total_amount += item.quantity * item.unit_cost;
    }
    
    try {
      const insertPO = db.prepare(`
        INSERT INTO purchase_orders (po_number, supplier_id, status, total_amount, notes, created_by)
        VALUES (?, ?, 'pending', ?, 'Auto-generated reorder', 1)
      `);
      
      const result = insertPO.run(po_number, supplierId, total_amount);
      const po_id = result.lastInsertRowid;
      
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost)
        VALUES (?, ?, ?, ?)
      `);
      
      for (const item of supplier.items) {
        insertItem.run(po_id, item.product_id, item.quantity, item.unit_cost);
      }
      
      results.push({
        po_id,
        po_number,
        supplier: supplier.supplier_name,
        items: supplier.items.length,
        total: total_amount
      });
      
      console.log(`Auto-created PO ${po_number} for ${supplier.supplier_name} with ${supplier.items.length} items`);
    } catch (err) {
      console.error('Error creating auto-reorder PO:', err.message);
    }
  }

  return results;
}

function getReorderAlerts() {
  const alerts = db.prepare(`
    SELECT 
      p.id,
      p.name,
      p.stock,
      p.reorder_point,
      p.reorder_quantity,
      p.supplier_id,
      s.name as supplier_name,
      CASE 
        WHEN p.stock = 0 THEN 'critical'
        WHEN p.stock <= p.reorder_point / 2 THEN 'low'
        ELSE 'warning'
      END as alert_level
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.is_active = 1 
      AND p.reorder_point > 0 
      AND p.stock <= p.reorder_point
    ORDER BY 
      CASE 
        WHEN p.stock = 0 THEN 0
        WHEN p.stock <= p.reorder_point / 2 THEN 1
        ELSE 2
      END,
      p.stock ASC
  `).all();

  return alerts;
}

router.get('/alerts', authenticateToken, (req, res) => {
  try {
    const alerts = getReorderAlerts();
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/low-stock', authenticateToken, (req, res) => {
  try {
    const items = checkLowStock();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/auto-reorder', authenticateToken, requireAdmin, (req, res) => {
  try {
    const results = autoCreateReorderPO();
    res.json({ success: true, created: results.length, orders: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;