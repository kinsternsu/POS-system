import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

function computeSalesVelocity() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split('T')[0];
  
  const velocities = db.prepare(`
    SELECT 
      JSON_EXTRACT(value, '$.product_id') as product_id,
      SUM(JSON_EXTRACT(value, '$.quantity')) as total_sold
    FROM transactions, json_each(transactions.items)
    WHERE DATE(transactions.created_at) >= ?
    GROUP BY JSON_EXTRACT(value, '$.product_id')
  `).all(startDate);
  
  for (const v of velocities) {
    if (!v.product_id) continue;
    const dailyRate = Math.round((v.total_sold / 30) * 10) / 10;
    db.prepare('UPDATE products SET sales_velocity = ? WHERE id = ?').run(dailyRate, v.product_id);
  }
}

function calculateSmartOrderQty(item) {
  const { stock, reorder_point, reorder_quantity, sales_velocity, min_stock, max_stock, lead_time } = item;
  
  const leadTimeDays = lead_time || 7;
  const velocity = sales_velocity || 0;
  
  const safetyStock = Math.ceil(velocity * leadTimeDays * 1.5);
  
  const effectiveMin = min_stock > 0 ? min_stock : (reorder_point || safetyStock);
  const effectiveMax = max_stock > 0 ? max_stock : (reorder_quantity || Math.ceil(velocity * 30));
  
  const suggestedQty = Math.max(0, effectiveMax - stock);
  
  return {
    suggested_qty: Math.max(suggestedQty, effectiveMin - stock),
    safety_stock: safetyStock,
    daily_velocity: velocity,
    days_until_stockout: velocity > 0 ? Math.floor(stock / velocity) : 999,
    effective_min: effectiveMin,
    effective_max: effectiveMax
  };
}

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
      p.min_stock,
      p.max_stock,
      p.sales_velocity,
      p.last_po_cost,
      p.avg_cost,
      s.name as supplier_name,
      s.email as supplier_email,
      s.lead_time as supplier_lead_time,
      s.discount_rate as supplier_discount
    FROM products p
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.is_active = 1 
      AND p.reorder_point > 0 
      AND p.stock <= p.reorder_point
    ORDER BY p.stock ASC
  `).all();

  return lowStockItems.map(item => {
    const smart = calculateSmartOrderQty(item);
    return { ...item, ...smart };
  });
}

function checkPendingPO(productId) {
  const pending = db.prepare(`
    SELECT poi.* 
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.purchase_order_id = po.id
    WHERE poi.product_id = ? 
      AND po.status IN ('draft', 'pending', 'ordered', 'authorized', 'sent', 'partial')
  `).all(productId);

  return pending.length > 0;
}

function autoCreateReorderPO() {
  computeSalesVelocity();
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
    
    const orderQty = item.suggested_qty > 0 ? item.suggested_qty : (item.reorder_quantity || 10);
    
    groupedBySupplier[item.supplier_id].items.push({
      product_id: item.id,
      product_name: item.name,
      quantity: Math.max(1, orderQty),
      unit_cost: item.last_po_cost || item.cost_price || 0,
      sales_velocity: item.daily_velocity || 0,
      days_until_stockout: item.days_until_stockout || 0,
      safety_stock: item.safety_stock || 0
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
        VALUES (?, ?, 'draft', ?, 'Auto-generated reorder based on sales velocity', 1)
      `);
      
      const result = insertPO.run(po_number, supplierId, total_amount);
      const po_id = result.lastInsertRowid;
      
      const insertItem = db.prepare(`
        INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity, unit_cost, line_total)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      for (const item of supplier.items) {
        const lineTotal = item.quantity * item.unit_cost;
        insertItem.run(po_id, item.product_id, item.quantity, item.unit_cost, lineTotal);
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
      p.sales_velocity,
      p.min_stock,
      p.max_stock,
      s.name as supplier_name,
      s.lead_time as supplier_lead_time,
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

  return alerts.map(item => {
    const smart = calculateSmartOrderQty(item);
    return { ...item, ...smart };
  });
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

router.post('/compute-velocity', authenticateToken, requireAdmin, (req, res) => {
  try {
    computeSalesVelocity();
    res.json({ success: true, message: 'Sales velocity computed for all products' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/smart-quantities', authenticateToken, (req, res) => {
  try {
    computeSalesVelocity();
    const items = db.prepare(`
      SELECT p.id, p.name, p.stock, p.reorder_point, p.reorder_quantity,
        p.min_stock, p.max_stock, p.sales_velocity, p.cost_price,
        p.supplier_id, s.name as supplier_name, s.lead_time as supplier_lead_time,
        p.last_po_cost
      FROM products p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.is_active = 1 AND p.supplier_id IS NOT NULL
      ORDER BY p.name
    `).all();

    const enriched = items.map(item => ({
      ...item,
      ...calculateSmartOrderQty(item)
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
