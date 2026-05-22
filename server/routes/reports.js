import express from 'express';
import db from '../database.js';
import { authenticateToken } from '../auth.js';

const router = express.Router();

function dateWhere(params, prefix = '') {
  const { startDate, endDate } = params;
  const p = [];
  let clause = '';
  const col = prefix ? `${prefix}.created_at` : 'created_at';
  if (startDate && endDate) {
    clause = `WHERE DATE(${col}) BETWEEN ? AND ?`;
    p.push(startDate, endDate);
  } else if (startDate) {
    clause = `WHERE DATE(${col}) >= ?`;
    p.push(startDate);
  } else if (endDate) {
    clause = `WHERE DATE(${col}) <= ?`;
    p.push(endDate);
  }
  return { clause, params: p };
}

router.get('/products', authenticateToken, (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;
    const { clause, params } = dateWhere(req.query, 't');

    let having = '';
    const havingParams = [];
    if (category) {
      having = ' HAVING LOWER(category) = ?';
      havingParams.push(category.toLowerCase());
    }

    const rows = db.prepare(`
      SELECT
        json_extract(value, '$.product_id') as product_id,
        json_extract(value, '$.name') as product_name,
        COALESCE(SUM(json_extract(value, '$.quantity')), 0) as total_quantity_sold,
        COALESCE(SUM(json_extract(value, '$.total')), 0) as total_revenue,
        COUNT(DISTINCT t.id) as times_sold
      FROM transactions t, json_each(t.items)
      ${clause}
      GROUP BY json_extract(value, '$.product_id')
      ${having}
      ORDER BY total_revenue DESC
    `).all(...params, ...havingParams);

    const enriched = rows.map(r => {
      const p = db.prepare('SELECT category FROM products WHERE id = ?').get(r.product_id);
      return { ...r, category: p?.category || '' };
    });

    if (category) {
      res.json(enriched.filter(r => r.category.toLowerCase() === category.toLowerCase()));
    } else {
      res.json(enriched);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', authenticateToken, (req, res) => {
  try {
    const { clause, params } = dateWhere(req.query, 't');

    const rows = db.prepare(`
      SELECT
        COALESCE(p.category, 'Uncategorized') as category,
        COUNT(DISTINCT t.id) as transaction_count,
        COALESCE(SUM(json_extract(value, '$.quantity')), 0) as total_quantity_sold,
        COALESCE(SUM(json_extract(value, '$.total')), 0) as total_revenue
      FROM transactions t, json_each(t.items)
      LEFT JOIN products p ON json_extract(value, '$.product_id') = p.id
      ${clause}
      GROUP BY p.category
      ORDER BY total_revenue DESC
    `).all(...params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/employees', authenticateToken, (req, res) => {
  try {
    const { clause, params } = dateWhere(req.query, 't');

    const rows = db.prepare(`
      SELECT
        t.employee_id,
        e.name as employee_name,
        COUNT(*) as total_transactions,
        COALESCE(SUM(t.total), 0) as total_sales,
        COALESCE(SUM(t.discount_amount), 0) as total_discounts_given,
        COALESCE(AVG(t.total), 0) as avg_transaction_value
      FROM transactions t
      LEFT JOIN employees e ON t.employee_id = e.id
      ${clause}
      GROUP BY t.employee_id
      ORDER BY total_sales DESC
    `).all(...params);

    const withReturns = rows.map(r => {
      const ret = db.prepare(`
        SELECT COALESCE(COUNT(*), 0) as return_count, COALESCE(SUM(refund_amount), 0) as total_refunds
        FROM returns WHERE employee_id = ? AND DATE(created_at) BETWEEN ? AND ?
      `).get(r.employee_id, req.query.startDate || '2000-01-01', req.query.endDate || '2099-12-31');
      return { ...r, returns_processed: ret?.return_count || 0, total_refunds: ret?.total_refunds || 0 };
    });

    res.json(withReturns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/profit', authenticateToken, (req, res) => {
  try {
    const { clause, params } = dateWhere(req.query, 't');

    const rows = db.prepare(`
      SELECT
        json_extract(value, '$.product_id') as product_id,
        json_extract(value, '$.name') as product_name,
        COALESCE(SUM(json_extract(value, '$.quantity')), 0) as qty,
        COALESCE(SUM(json_extract(value, '$.total')), 0) as revenue
      FROM transactions t, json_each(t.items)
      ${clause}
      GROUP BY json_extract(value, '$.product_id')
    `).all(...params);

    let totalRevenue = 0;
    let totalCost = 0;
    const byProduct = [];
    const byCategory = {};

    for (const r of rows) {
      const product = db.prepare('SELECT cost_price, category FROM products WHERE id = ?').get(r.product_id);
      const cost = product?.cost_price || 0;
      const costTotal = cost * r.qty;
      const profit = r.revenue - costTotal;
      const margin = r.revenue > 0 ? (profit / r.revenue) * 100 : 0;
      const cat = product?.category || 'Uncategorized';

      totalRevenue += r.revenue;
      totalCost += costTotal;

      byProduct.push({
        product_id: r.product_id,
        product_name: r.product_name,
        quantity_sold: r.qty,
        revenue: r.revenue,
        cost: costTotal,
        profit,
        profit_margin_pct: Math.round(margin * 100) / 100
      });

      if (!byCategory[cat]) byCategory[cat] = { revenue: 0, cost: 0, profit: 0 };
      byCategory[cat].revenue += r.revenue;
      byCategory[cat].cost += costTotal;
      byCategory[cat].profit += profit;
    }

    const catArray = Object.entries(byCategory).map(([category, d]) => ({
      category,
      revenue: d.revenue,
      cost: d.cost,
      profit: d.profit,
      profit_margin_pct: d.revenue > 0 ? Math.round((d.profit / d.revenue) * 10000) / 100 : 0
    }));

    const returnsTotal = db.prepare(`
      SELECT COALESCE(SUM(refund_amount), 0) as total_refunds FROM returns ${clause}
    `).get(...params);

    const overallProfit = totalRevenue - totalCost - (returnsTotal?.total_refunds || 0);
    const overallMargin = totalRevenue > 0 ? (overallProfit / totalRevenue) * 100 : 0;

    res.json({
      total_revenue: totalRevenue,
      total_cost: totalCost,
      total_refunds: returnsTotal?.total_refunds || 0,
      total_profit: overallProfit,
      profit_margin_pct: Math.round(overallMargin * 100) / 100,
      by_product: byProduct.sort((a, b) => b.profit - a.profit),
      by_category: catArray.sort((a, b) => b.profit - a.profit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', authenticateToken, (req, res) => {
  try {
    const { clause: tClause, params: tParams } = dateWhere(req.query, 't');
    const { clause: rClause, params: rParams } = dateWhere(req.query, 'r');

    const sales = db.prepare(`
      SELECT
        COUNT(*) as total_transactions,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(discount_amount), 0) as total_discounts
      FROM transactions t ${tClause}
    `).get(...tParams);

    const returns = db.prepare(`
      SELECT
        COUNT(*) as total_returns,
        COALESCE(SUM(refund_amount), 0) as total_refunds
      FROM returns r ${rClause}
    `).get(...rParams);

    const topProducts = db.prepare(`
      SELECT
        json_extract(value, '$.product_id') as product_id,
        json_extract(value, '$.name') as product_name,
        COALESCE(SUM(json_extract(value, '$.quantity')), 0) as total_quantity,
        COALESCE(SUM(json_extract(value, '$.total')), 0) as total_revenue,
        COUNT(DISTINCT t.id) as times_sold
      FROM transactions t, json_each(t.items)
      ${tClause}
      GROUP BY json_extract(value, '$.product_id')
      ORDER BY total_revenue DESC
      LIMIT 10
    `).all(...tParams);

    const byPayment = db.prepare(`
      SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM transactions t ${tClause}
      GROUP BY payment_method
    `).all(...tParams);

    const byEmployee = db.prepare(`
      SELECT t.employee_id, e.name as employee_name, COUNT(*) as count, COALESCE(SUM(t.total), 0) as total
      FROM transactions t LEFT JOIN employees e ON t.employee_id = e.id
      ${tClause}
      GROUP BY t.employee_id
      ORDER BY total DESC
    `).all(...tParams);

    res.json({
      sales,
      returns,
      top_products: topProducts,
      by_payment_method: byPayment,
      by_employee: byEmployee
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/z-report', authenticateToken, (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const tClause = 'WHERE DATE(t.created_at) = ?';
    const params = [date];

    const sales = db.prepare(`
      SELECT
        COUNT(*) as transaction_count,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(subtotal), 0) as total_subtotal,
        COALESCE(SUM(tax), 0) as total_tax,
        COALESCE(SUM(discount_amount), 0) as total_discounts,
        COALESCE(AVG(total), 0) as avg_sale
      FROM transactions t ${tClause}
    `).get(...params);

    const byPayment = db.prepare(`
      SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM transactions t ${tClause}
      GROUP BY payment_method
    `).all(...params);

    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM transactions t ${tClause}
      GROUP BY CAST(strftime('%H', created_at) AS INTEGER)
      ORDER BY hour
    `).all(...params);

    const topProducts = db.prepare(`
      SELECT
        json_extract(value, '$.product_id') as product_id,
        json_extract(value, '$.name') as product_name,
        COALESCE(SUM(json_extract(value, '$.quantity')), 0) as qty,
        COALESCE(SUM(json_extract(value, '$.total')), 0) as revenue
      FROM transactions t, json_each(t.items)
      ${tClause}
      GROUP BY json_extract(value, '$.product_id')
      ORDER BY revenue DESC
      LIMIT 10
    `).all(...params);

    const returns = db.prepare(`
      SELECT
        COUNT(*) as return_count,
        COALESCE(SUM(refund_amount), 0) as total_refunds
      FROM returns r WHERE DATE(r.created_at) = ?
    `).get(date);

    const employees = db.prepare(`
      SELECT e.name as employee_name, COUNT(*) as tx_count, COALESCE(SUM(t.total), 0) as total
      FROM transactions t LEFT JOIN employees e ON t.employee_id = e.id
      ${tClause}
      GROUP BY t.employee_id
      ORDER BY total DESC
    `).all(...params);

    const profitData = db.prepare(`
      SELECT
        json_extract(value, '$.product_id') as pid,
        COALESCE(SUM(json_extract(value, '$.quantity')), 0) as qty,
        COALESCE(SUM(json_extract(value, '$.total')), 0) as revenue
      FROM transactions t, json_each(t.items)
      ${tClause}
      GROUP BY pid
    `).all(...params);

    let totalCost = 0;
    for (const r of profitData) {
      const p = db.prepare('SELECT cost_price FROM products WHERE id = ?').get(r.pid);
      totalCost += (p?.cost_price || 0) * r.qty;
    }

    res.json({
      date,
      generated_at: new Date().toISOString(),
      sales,
      by_payment_method: byPayment,
      by_hour: byHour,
      top_products: topProducts,
      returns,
      employees,
      total_refunds: returns?.total_refunds || 0,
      estimated_cost: totalCost,
      estimated_profit: sales.total_sales - totalCost - (returns?.total_refunds || 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
