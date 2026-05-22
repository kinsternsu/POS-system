import express from 'express';
import db from '../database.js';
import { authenticateToken } from '../auth.js';
import { logAudit } from './audit.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const { limit = 50, offset = 0, date } = req.query;
    
    let query = `
      SELECT t.*, e.name as employee_name 
      FROM transactions t
      LEFT JOIN employees e ON t.employee_id = e.id
    `;
    const params = [];
    
    if (date) {
      query += ' WHERE DATE(t.created_at) = ?';
      params.push(date);
    }
    
    query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const transactions = db.prepare(query).all(...params);
    
    const parsed = transactions.map(t => ({
      ...t,
      items: JSON.parse(t.items)
    }));
    
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { items, payment_method = 'cash', discount_type, discount_value, promotion_id } = req.body;
    const employee_id = req.user.id;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const taxRate = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'").get()?.value || '0');
    
    let subtotal = 0;
    const processedItems = [];
    
    for (const item of items) {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.product_id);
      
      if (!product) {
        return res.status(400).json({ error: `Product ${item.product_id} not found` });
      }
      
      let itemTotal, qty, weight, unit_measure, unit_price;
      
      if (item.weight && product.pricing_type === 'variable') {
        weight = item.weight;
        unit_measure = item.unit_measure || product.unit_measure || 'each';
        unit_price = item.unit_price || product.price_per_unit || product.price;
        itemTotal = weight * unit_price;
        qty = 1;
      } else {
        qty = item.quantity || 1;
        itemTotal = item.price;
        weight = null;
        unit_measure = null;
        unit_price = null;
      }
      
      processedItems.push({
        product_id: product.id,
        name: product.name,
        price: unit_price || product.price,
        quantity: qty,
        weight: weight,
        unit_measure: unit_measure,
        total: itemTotal
      });
      
      if (product.stock !== null && (product.pricing_type !== 'variable' || weight)) {
        const stockDecrease = product.pricing_type === 'variable' && weight ? weight : qty;
        if (product.pricing_type === 'variable' && weight) {
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(weight, product.id);
        } else {
          db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, product.id);
        }
        logAudit('sale', product.id, -stockDecrease, (product.stock).toString(), (product.stock - stockDecrease).toString(), employee_id, 'Sale transaction', 'transaction', null);
      }
    }
    
    subtotal = processedItems.reduce((sum, item) => sum + item.total, 0);

    let discountAmount = 0;
    let resolvedDiscountType = discount_type || null;
    let resolvedDiscountValue = discount_value || null;
    let resolvedPromotionId = promotion_id || null;

    if (promotion_id) {
      const promotion = db.prepare(`
        SELECT * FROM promotions WHERE id = ? AND is_active = 1
          AND (start_date IS NULL OR start_date <= DATE('now'))
          AND (end_date IS NULL OR end_date >= DATE('now'))
      `).get(promotion_id);

      if (!promotion) {
        return res.status(400).json({ error: 'Promotion not found or not active' });
      }

      if (promotion.min_purchase && subtotal < promotion.min_purchase) {
        return res.status(400).json({ error: `Minimum purchase of $${promotion.min_purchase} required for this promotion` });
      }

      resolvedDiscountType = promotion.type;
      resolvedDiscountValue = promotion.value;

      if (resolvedDiscountType === 'percentage') {
        discountAmount = subtotal * (resolvedDiscountValue / 100);
      } else {
        discountAmount = Math.min(resolvedDiscountValue, subtotal);
      }
    } else if (discount_type && discount_value) {
      if (discount_type === 'percentage') {
        if (discount_value <= 0 || discount_value > 100) {
          return res.status(400).json({ error: 'Percentage must be between 0 and 100' });
        }
        discountAmount = subtotal * (discount_value / 100);
      } else if (discount_type === 'fixed_amount') {
        if (discount_value <= 0) {
          return res.status(400).json({ error: 'Fixed amount must be greater than 0' });
        }
        discountAmount = Math.min(discount_value, subtotal);
      } else {
        return res.status(400).json({ error: "discount_type must be 'percentage' or 'fixed_amount'" });
      }
    }
    
    const taxableAmount = subtotal - discountAmount;
    const tax = taxableAmount * (taxRate / 100);
    const total = taxableAmount + tax;
    
    const stmt = db.prepare(`
      INSERT INTO transactions (employee_id, items, subtotal, tax, total, payment_method, discount_type, discount_value, discount_amount, promotion_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      employee_id,
      JSON.stringify(processedItems),
      subtotal,
      tax,
      total,
      payment_method,
      resolvedDiscountType,
      resolvedDiscountValue,
      discountAmount,
      resolvedPromotionId
    );
    
    res.json({ 
      id: result.lastInsertRowid,
      items: processedItems,
      subtotal,
      discount_type: resolvedDiscountType,
      discount_value: resolvedDiscountValue,
      discount_amount: discountAmount,
      promotion_id: resolvedPromotionId,
      tax,
      total,
      payment_method,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', authenticateToken, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let whereClause = '';
    const params = [];
    
    if (startDate && endDate) {
      whereClause = 'WHERE DATE(created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      whereClause = 'WHERE DATE(created_at) >= ?';
      params.push(startDate);
    } else if (endDate) {
      whereClause = 'WHERE DATE(created_at) <= ?';
      params.push(endDate);
    }
    
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(subtotal), 0) as total_subtotal,
        COALESCE(SUM(tax), 0) as total_tax,
        COALESCE(SUM(discount_amount), 0) as total_discounts
      FROM transactions ${whereClause}
    `).get(...params);
    
    const byPayment = db.prepare(`
      SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM transactions ${whereClause}
      GROUP BY payment_method
    `).all(...params);
    
    res.json({ ...stats, by_payment_method: byPayment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/detailed', authenticateToken, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let whereClause = '';
    const params = [];
    
    if (startDate && endDate) {
      whereClause = 'WHERE DATE(created_at) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      whereClause = 'WHERE DATE(created_at) >= ?';
      params.push(startDate);
    } else if (endDate) {
      whereClause = 'WHERE DATE(created_at) <= ?';
      params.push(endDate);
    }
    
    const totals = db.prepare(`
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(total), 0) as total_sales,
        COALESCE(SUM(subtotal), 0) as total_subtotal,
        COALESCE(SUM(tax), 0) as total_tax,
        COALESCE(SUM(discount_amount), 0) as total_discounts,
        COALESCE(AVG(total), 0) as avg_transaction_value,
        COALESCE(MAX(total), 0) as max_transaction_value
      FROM transactions ${whereClause}
    `).get(...params);
    
    const byPayment = db.prepare(`
      SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM transactions ${whereClause}
      GROUP BY payment_method
    `).all(...params);
    
    const byHour = db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM transactions ${whereClause}
      GROUP BY CAST(strftime('%H', created_at) AS INTEGER)
      ORDER BY hour
    `).all(...params);
    
    const byDate = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count, COALESCE(SUM(total), 0) as total
      FROM transactions ${whereClause ? whereClause.replace('WHERE ', 'WHERE ') : ''}
      ${whereClause ? '' : ''}
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all(...params.length ? [...params] : []);
    
    const withDiscount = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(discount_amount), 0) as total_discounts
      FROM transactions ${whereClause}${whereClause ? ' AND ' : ' WHERE '}discount_amount > 0
    `).get(...params);
    
    const avgDiscount = db.prepare(`
      SELECT COALESCE(AVG(discount_amount), 0) as avg_discount
      FROM transactions ${whereClause}${whereClause ? ' AND ' : ' WHERE '}discount_amount > 0
    `).get(...params);
    
    res.json({
      ...totals,
      by_payment_method: byPayment,
      by_hour: byHour,
      by_date: byDate,
      transactions_with_discount: withDiscount?.count || 0,
      avg_discount_on_discounted: avgDiscount?.avg_discount || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;