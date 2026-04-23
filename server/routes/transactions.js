import express from 'express';
import db from '../database.js';
import { authenticateToken } from '../auth.js';

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
    const { items, payment_method = 'cash' } = req.body;
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
      
      const qty = item.quantity || 1;
      const itemTotal = product.price * qty;
      subtotal += itemTotal;
      
      processedItems.push({
        product_id: product.id,
        name: product.name,
        price: product.price,
        quantity: qty,
        total: itemTotal
      });
      
      if (product.stock !== null) {
        db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(qty, product.id);
      }
    }
    
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    
    const stmt = db.prepare(`
      INSERT INTO transactions (employee_id, items, subtotal, tax, total, payment_method)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      employee_id,
      JSON.stringify(processedItems),
      subtotal,
      tax,
      total,
      payment_method
    );
    
    res.json({ 
      id: result.lastInsertRowid,
      items: processedItems,
      subtotal,
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
        COALESCE(SUM(tax), 0) as total_tax
      FROM transactions ${whereClause}
    `).get(...params);
    
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;