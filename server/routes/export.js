import express from 'express';
import db from '../database.js';
import { authenticateToken } from '../auth.js';
import { generateCSV, generateXLSX } from '../export.js';

const router = express.Router();

const COLUMNS = {
  products: [
    { label: 'Name', value: r => r.name, key: 'name' },
    { label: 'SKU', value: r => r.sku || '', key: 'sku' },
    { label: 'Barcode', value: r => r.barcode || '', key: 'barcode' },
    { label: 'Price', value: r => r.price, key: 'price' },
    { label: 'Cost Price', value: r => r.cost_price || 0, key: 'cost_price' },
    { label: 'Stock', value: r => r.stock ?? '', key: 'stock' },
    { label: 'Category', value: r => r.category || '', key: 'category' },
    { label: 'Supplier', value: r => r.supplier_name || '', key: 'supplier' },
    { label: 'Type', value: r => r.pricing_type || 'fixed', key: 'pricing_type' },
    { label: 'Active', value: r => r.is_active ? 'Yes' : 'No', key: 'is_active' }
  ],
  employees: [
    { label: 'Name', value: r => r.name, key: 'name' },
    { label: 'Username', value: r => r.username, key: 'username' },
    { label: 'Role', value: r => r.role, key: 'role' },
    { label: 'Active', value: r => r.is_active ? 'Yes' : 'No', key: 'is_active' },
    { label: 'Created', value: r => r.created_at || '', key: 'created_at' }
  ],
  suppliers: [
    { label: 'Name', value: r => r.name, key: 'name' },
    { label: 'Contact', value: r => r.contact_person || '', key: 'contact_person' },
    { label: 'Email', value: r => r.email || '', key: 'email' },
    { label: 'Phone', value: r => r.phone || '', key: 'phone' },
    { label: 'Address', value: r => r.address || '', key: 'address' },
    { label: 'Products', value: r => r.product_count ?? '', key: 'product_count' },
    { label: 'Active', value: r => r.is_active ? 'Yes' : 'No', key: 'is_active' }
  ],
  transactions: [
    { label: 'ID', value: r => r.id, key: 'id' },
    { label: 'Employee', value: r => r.employee_name || '', key: 'employee' },
    { label: 'Items', value: r => (r.items || []).map(i => i.name + ' x' + (i.quantity || i.weight || 1)).join('; '), key: 'items' },
    { label: 'Subtotal', value: r => r.subtotal, key: 'subtotal' },
    { label: 'Discount', value: r => r.discount_amount || 0, key: 'discount_amount' },
    { label: 'Tax', value: r => r.tax, key: 'tax' },
    { label: 'Total', value: r => r.total, key: 'total' },
    { label: 'Payment', value: r => r.payment_method, key: 'payment_method' },
    { label: 'Date', value: r => r.created_at || '', key: 'created_at' }
  ],
  returns: [
    { label: 'ID', value: r => r.id, key: 'id' },
    { label: 'Employee', value: r => r.employee_name || '', key: 'employee' },
    { label: 'Items', value: r => (r.items || []).map(i => i.name + ' x' + i.quantity).join('; '), key: 'items' },
    { label: 'Refund', value: r => r.refund_amount, key: 'refund_amount' },
    { label: 'Discount', value: r => r.discount_amount || 0, key: 'discount_amount' },
    { label: 'Reason', value: r => r.reason || '', key: 'reason' },
    { label: 'Status', value: r => r.status, key: 'status' },
    { label: 'Payment', value: r => r.payment_method, key: 'payment_method' },
    { label: 'Date', value: r => r.created_at || '', key: 'created_at' }
  ],
  'purchase-orders': [
    { label: 'PO Number', value: r => r.po_number, key: 'po_number' },
    { label: 'Supplier', value: r => r.supplier_name || '', key: 'supplier' },
    { label: 'Total', value: r => r.total_amount || 0, key: 'total_amount' },
    { label: 'Status', value: r => r.status, key: 'status' },
    { label: 'Items', value: r => r.item_count || '', key: 'item_count' },
    { label: 'Expected', value: r => r.expected_date || '', key: 'expected_date' },
    { label: 'Created By', value: r => r.created_by_name || '', key: 'created_by' },
    { label: 'Date', value: r => r.created_at || '', key: 'created_at' }
  ],
  grv: [
    { label: 'GRV Number', value: r => r.grv_number, key: 'grv_number' },
    { label: 'PO Number', value: r => r.po_number || '', key: 'po_number' },
    { label: 'Supplier', value: r => r.supplier_name || '', key: 'supplier' },
    { label: 'Received By', value: r => r.received_by_name || '', key: 'received_by' },
    { label: 'Status', value: r => r.status, key: 'status' },
    { label: 'Date', value: r => r.created_at || '', key: 'created_at' }
  ],
  'stock/requests': [
    { label: 'Product', value: r => r.product_name, key: 'product' },
    { label: 'Current Stock', value: r => r.current_stock, key: 'current_stock' },
    { label: 'Requested', value: r => r.new_stock, key: 'new_stock' },
    { label: 'Change', value: r => r.new_stock - r.current_stock, key: 'change' },
    { label: 'Reason', value: r => r.reason, key: 'reason' },
    { label: 'Requested By', value: r => r.requested_by_name || '', key: 'requested_by' },
    { label: 'Status', value: r => r.status, key: 'status' },
    { label: 'Date', value: r => r.created_at || '', key: 'created_at' }
  ],
  'blind-counts': [
    { label: 'Date', value: r => r.count_date, key: 'count_date' },
    { label: 'Counted By', value: r => r.counted_by_name || '', key: 'counted_by' },
    { label: 'Items', value: r => r.item_count || '', key: 'item_count' },
    { label: 'Variance', value: r => r.total_variance ?? 0, key: 'variance' },
    { label: 'Status', value: r => r.status, key: 'status' },
    { label: 'Completed', value: r => r.completed_at || '', key: 'completed_at' }
  ],
  'cash-up/history': [
    { label: 'Date', value: r => (r.start_time || r.created_at || ''), key: 'date' },
    { label: 'Employee', value: r => r.employee_name || '', key: 'employee' },
    { label: 'Expected Cash', value: r => r.expected_cash || 0, key: 'expected_cash' },
    { label: 'Actual Cash', value: r => r.actual_cash || 0, key: 'actual_cash' },
    { label: 'Card', value: r => r.card_amount || 0, key: 'card_amount' },
    { label: 'Cheque', value: r => r.cheque_amount || 0, key: 'cheque_amount' },
    { label: 'Payouts', value: r => r.payouts || 0, key: 'payouts' },
    { label: 'Variance', value: r => r.variance || 0, key: 'variance' }
  ],
  promotions: [
    { label: 'Name', value: r => r.name, key: 'name' },
    { label: 'Type', value: r => r.type === 'percentage' ? 'Percentage' : 'Fixed Amount', key: 'type' },
    { label: 'Value', value: r => r.type === 'percentage' ? r.value + '%' : r.value, key: 'value' },
    { label: 'Min Purchase', value: r => r.min_purchase || '', key: 'min_purchase' },
    { label: 'Start Date', value: r => r.start_date || '', key: 'start_date' },
    { label: 'End Date', value: r => r.end_date || '', key: 'end_date' },
    { label: 'Active', value: r => r.is_active ? 'Yes' : 'No', key: 'is_active' }
  ],
  'reorder/alerts': [
    { label: 'Product', value: r => r.name, key: 'name' },
    { label: 'Stock', value: r => r.stock, key: 'stock' },
    { label: 'Reorder Point', value: r => r.reorder_point, key: 'reorder_point' },
    { label: 'Reorder Qty', value: r => r.reorder_quantity || '', key: 'reorder_quantity' },
    { label: 'Supplier', value: r => r.supplier_name || '', key: 'supplier' },
    { label: 'Alert Level', value: r => r.alert_level, key: 'alert_level' },
    { label: 'Sales Velocity', value: r => r.sales_velocity || 0, key: 'sales_velocity' }
  ],
  audit: [
    { label: 'Date', value: r => r.created_at || '', key: 'created_at' },
    { label: 'Action', value: r => r.action_type, key: 'action_type' },
    { label: 'Product', value: r => r.product_name || '-', key: 'product' },
    { label: 'Change', value: r => (r.quantity_change > 0 ? '+' : '') + r.quantity_change, key: 'quantity_change' },
    { label: 'User', value: r => r.user_name || '-', key: 'user' },
    { label: 'Reason', value: r => r.reason || '-', key: 'reason' }
  ]
};

function fetchData(entity, query = {}) {
  switch (entity) {
    case 'products': {
      const products = db.prepare(`
        SELECT p.*, s.name as supplier_name
        FROM products p LEFT JOIN suppliers s ON p.supplier_id = s.id
        ORDER BY p.name
      `).all();
      return { data: products, columns: COLUMNS.products };
    }
    case 'employees': {
      const employees = db.prepare('SELECT id, name, username, role, is_active, created_at FROM employees ORDER BY name').all();
      return { data: employees, columns: COLUMNS.employees };
    }
    case 'suppliers': {
      const suppliers = db.prepare(`
        SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) as product_count
        FROM suppliers s ORDER BY s.name
      `).all();
      return { data: suppliers, columns: COLUMNS.suppliers };
    }
    case 'transactions': {
      let sql = `
        SELECT t.*, e.name as employee_name
        FROM transactions t LEFT JOIN employees e ON t.employee_id = e.id
      `;
      const params = [];
      if (query.date) {
        sql += ' WHERE DATE(t.created_at) = ?';
        params.push(query.date);
      }
      sql += ' ORDER BY t.created_at DESC LIMIT 10000';
      const transactions = db.prepare(sql).all(...params);
      const parsed = transactions.map(t => ({ ...t, items: JSON.parse(t.items) }));
      return { data: parsed, columns: COLUMNS.transactions };
    }
    case 'returns': {
      let sql = `
        SELECT r.*, e.name as employee_name, t.id as original_tx_id
        FROM returns r LEFT JOIN employees e ON r.employee_id = e.id
        LEFT JOIN transactions t ON r.original_transaction_id = t.id
      `;
      const conditions = [];
      const params = [];
      if (query.date) { conditions.push('DATE(r.created_at) = ?'); params.push(query.date); }
      if (query.status) { conditions.push('r.status = ?'); params.push(query.status); }
      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY r.created_at DESC LIMIT 10000';
      const returns = db.prepare(sql).all(...params);
      const parsed = returns.map(r => ({ ...r, items: JSON.parse(r.items) }));
      return { data: parsed, columns: COLUMNS.returns };
    }
    case 'purchase-orders': {
      const pos = db.prepare(`
        SELECT po.*, s.name as supplier_name, e.name as created_by_name,
          (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as item_count
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN employees e ON po.created_by = e.id
        ORDER BY po.created_at DESC
      `).all();
      return { data: pos, columns: COLUMNS['purchase-orders'] };
    }
    case 'grv': {
      const grvs = db.prepare(`
        SELECT grv.*, po.po_number, s.name as supplier_name, e.name as received_by_name
        FROM goods_received_vouchers grv
        LEFT JOIN purchase_orders po ON grv.purchase_order_id = po.id
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN employees e ON grv.received_by = e.id
        ORDER BY grv.created_at DESC
      `).all();
      return { data: grvs, columns: COLUMNS.grv };
    }
    case 'stock/requests': {
      let sql = `
        SELECT ar.*, p.name as product_name, p.sku,
          req.name as requested_by_name, app.name as approved_by_name
        FROM adjustment_requests ar
        LEFT JOIN products p ON ar.product_id = p.id
        LEFT JOIN employees req ON ar.requested_by = req.id
        LEFT JOIN employees app ON ar.approved_by = app.id
      `;
      const params = [];
      if (query.status) { sql += ' WHERE ar.status = ?'; params.push(query.status); }
      sql += ' ORDER BY ar.created_at DESC';
      const requests = db.prepare(sql).all(...params);
      return { data: requests, columns: COLUMNS['stock/requests'] };
    }
    case 'blind-counts': {
      const counts = db.prepare(`
        SELECT bc.*, e.name as counted_by_name,
          (SELECT COUNT(*) FROM blind_count_items WHERE blind_count_id = bc.id) as item_count,
          (SELECT COALESCE(SUM(variance), 0) FROM blind_count_items WHERE blind_count_id = bc.id) as total_variance
        FROM blind_counts bc
        LEFT JOIN employees e ON bc.counted_by = e.id
        ORDER BY bc.created_at DESC
      `).all();
      return { data: counts, columns: COLUMNS['blind-counts'] };
    }
    case 'cash-up/history': {
      const cashUps = db.prepare(`
        SELECT cu.*, s.start_time, e.name as employee_name
        FROM cash_ups cu
        LEFT JOIN shifts s ON cu.shift_id = s.id
        LEFT JOIN employees e ON cu.employee_id = e.id
        ORDER BY cu.created_at DESC LIMIT 10000
      `).all();
      return { data: cashUps, columns: COLUMNS['cash-up/history'] };
    }
    case 'promotions': {
      let sql = 'SELECT * FROM promotions';
      const params = [];
      if (query.active === 'true') { sql += ' WHERE is_active = 1'; }
      sql += ' ORDER BY created_at DESC';
      const promotions = db.prepare(sql).all(...params);
      return { data: promotions, columns: COLUMNS.promotions };
    }
    case 'reorder/alerts': {
      const alerts = db.prepare(`
        SELECT p.id, p.name, p.stock, p.reorder_point, p.reorder_quantity,
          p.supplier_id, s.name as supplier_name,
          CASE WHEN p.stock <= 0 THEN 'critical' WHEN p.stock <= p.reorder_point THEN 'low' ELSE 'ok' END as alert_level
        FROM products p
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.is_active = 1 AND p.stock IS NOT NULL AND (p.reorder_point IS NOT NULL AND p.stock <= p.reorder_point)
        ORDER BY p.stock ASC
      `).all();
      return { data: alerts, columns: COLUMNS['reorder/alerts'] };
    }
    case 'audit': {
      let sql = `
        SELECT a.*, p.name as product_name, p.sku, e.name as user_name
        FROM audit_logs a
        LEFT JOIN products p ON a.product_id = p.id
        LEFT JOIN employees e ON a.user_id = e.id
      `;
      const conditions = [];
      const params = [];
      if (query.start_date) { conditions.push('DATE(a.created_at) >= ?'); params.push(query.start_date); }
      if (query.end_date) { conditions.push('DATE(a.created_at) <= ?'); params.push(query.end_date); }
      if (query.action_type) { conditions.push('a.action_type = ?'); params.push(query.action_type); }
      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY a.created_at DESC LIMIT 10000';
      const logs = db.prepare(sql).all(...params);
      return { data: logs, columns: COLUMNS.audit };
    }
    default:
      return null;
  }
}

router.post('/', authenticateToken, (req, res) => {
  try {
    const { entity, format = 'csv', ...query } = req.body;

    if (!entity) {
      return res.status(400).json({ error: 'entity is required' });
    }

    const result = fetchData(entity, query);
    if (!result) {
      return res.status(400).json({ error: 'Unknown entity: ' + entity });
    }

    const { data, columns } = result;
    const filename = entity.replace(/\//g, '_') + '_' + new Date().toISOString().split('T')[0];

    if (format === 'xlsx') {
      generateXLSX(data, columns, entity).then(buffer => {
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        res.send(Buffer.from(buffer));
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    } else {
      const csv = generateCSV(data, columns);
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send('\uFEFF' + csv);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
