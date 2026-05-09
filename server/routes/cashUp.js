import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

const DENOMINATIONS = [
  { value: 0.05, label: '5t', type: 'coin' },
  { value: 0.10, label: '10t', type: 'coin' },
  { value: 0.25, label: '25t', type: 'coin' },
  { value: 0.50, label: '50t', type: 'coin' },
  { value: 1, label: 'P1', type: 'coin' },
  { value: 2, label: 'P2', type: 'coin' },
  { value: 5, label: 'P5', type: 'coin' },
  { value: 10, label: 'P10', type: 'note' },
  { value: 20, label: 'P20', type: 'note' },
  { value: 50, label: 'P50', type: 'note' },
  { value: 100, label: 'P100', type: 'note' },
  { value: 200, label: 'P200', type: 'note' },
  { value: 500, label: 'P500', type: 'note' }
];

router.get('/denominations', authenticateToken, (req, res) => {
  res.json(DENOMINATIONS);
});

router.get('/active-shift', authenticateToken, (req, res) => {
  try {
    const shift = db.prepare(`
      SELECT s.*, e.name as employee_name
      FROM shifts s
      LEFT JOIN employees e ON s.employee_id = e.id
      WHERE s.employee_id = ? AND s.status = 'open'
      ORDER BY s.start_time DESC
      LIMIT 1
    `).get(req.user.id);
    
    if (!shift) {
      return res.json({ has_shift: false });
    }
    
    const payouts = db.prepare(`
      SELECT SUM(amount) as total FROM payouts WHERE shift_id = ?
    `).get(shift.id);
    
    const cashSales = db.prepare(`
      SELECT SUM(total) as total FROM transactions 
      WHERE employee_id = ? AND DATE(created_at) = DATE(?) AND payment_method = 'cash'
    `).get(req.user.id, shift.start_time);
    
    const cardSales = db.prepare(`
      SELECT SUM(total) as total FROM transactions 
      WHERE employee_id = ? AND DATE(created_at) = DATE(?) AND payment_method = 'card'
    `).get(req.user.id, shift.start_time);
    
    const expectedCash = (cashSales?.total || 0) - (payouts?.total || 0);
    
    res.json({
      has_shift: true,
      shift,
      payouts_total: payouts?.total || 0,
      expected_cash: expectedCash,
      card_total: cardSales?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/shifts/start', authenticateToken, (req, res) => {
  try {
    const { starting_float } = req.body;
    
    const existing = db.prepare(`
      SELECT * FROM shifts WHERE employee_id = ? AND status = 'open'
    `).get(req.user.id);
    
    if (existing) {
      return res.status(400).json({ error: 'You already have an open shift' });
    }
    
    const result = db.prepare(`
      INSERT INTO shifts (employee_id, starting_float, status)
      VALUES (?, ?, 'open')
    `).run(req.user.id, starting_float || 0);
    
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/shifts/:id/end', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;
    
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    
    if (shift.status !== 'open') {
      return res.status(400).json({ error: 'Shift already closed' });
    }
    
    db.prepare(`
      UPDATE shifts SET status = 'closed', end_time = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payouts', authenticateToken, (req, res) => {
  try {
    const { shift_id } = req.query;
    const payouts = db.prepare(`
      SELECT p.*, e.name as created_by_name
      FROM payouts p
      LEFT JOIN employees e ON p.created_by = e.id
      WHERE p.shift_id = ?
      ORDER BY p.created_at DESC
    `).all(shift_id);
    
    res.json(payouts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payouts', authenticateToken, (req, res) => {
  try {
    const { shift_id, amount, reason } = req.body;
    
    if (!shift_id || !amount) {
      return res.status(400).json({ error: 'Shift ID and amount required' });
    }
    
    const result = db.prepare(`
      INSERT INTO payouts (shift_id, amount, reason, created_by)
      VALUES (?, ?, ?, ?)
    `).run(shift_id, amount, reason || '', req.user.id);
    
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { shift_id, denominations, payouts: payoutList, card_amount, cheque_amount, notes } = req.body;
    
    const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shift_id);
    if (!shift) {
      return res.status(404).json({ error: 'Shift not found' });
    }
    
    const cashSales = db.prepare(`
      SELECT SUM(total) as total FROM transactions 
      WHERE employee_id = ? AND DATE(created_at) = DATE(?)
    `).get(req.user.id, shift.start_time);
    
    const shiftPayouts = db.prepare(`
      SELECT SUM(amount) as total FROM payouts WHERE shift_id = ?
    `).get(shift_id);
    
    const totalPayouts = (payoutList || []).reduce((sum, p) => sum + p.amount, 0) + (shiftPayouts?.total || 0);
    const expectedCash = (cashSales?.total || 0) + shift.starting_float - totalPayouts;
    
    let actualCash = 0;
    if (denominations) {
      for (const d of denominations) {
        actualCash += d.denomination * d.quantity;
      }
    }
    
    const variance = actualCash - expectedCash;
    
    const result = db.prepare(`
      INSERT INTO cash_ups (shift_id, employee_id, expected_cash, actual_cash, card_amount, cheque_amount, payouts, variance, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(shift_id, req.user.id, expectedCash, actualCash, card_amount || 0, cheque_amount || 0, totalPayouts, variance, notes || '');
    
    const cash_up_id = result.lastInsertRowid;
    
    if (denominations) {
      const insertDenom = db.prepare(`
        INSERT INTO cash_up_denominations (cash_up_id, denomination, quantity, total)
        VALUES (?, ?, ?, ?)
      `);
      for (const d of denominations) {
        if (d.quantity > 0) {
          insertDenom.run(cash_up_id, d.denomination, d.quantity, d.denomination * d.quantity);
        }
      }
    }
    
    if (payoutList) {
      const insertPayout = db.prepare(`
        INSERT INTO cash_up_payouts (cash_up_id, reason, amount)
        VALUES (?, ?, ?)
      `);
      for (const p of payoutList) {
        insertPayout.run(cash_up_id, p.reason || '', p.amount);
      }
    }
    
    db.prepare(`UPDATE shifts SET status = 'closed', end_time = CURRENT_TIMESTAMP WHERE id = ?`).run(shift_id);
    
    res.json({ 
      id: cash_up_id, 
      expected_cash: expectedCash, 
      actual_cash: actualCash, 
      variance,
      status: variance === 0 ? 'balanced' : variance > 0 ? 'over' : 'short'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/history', authenticateToken, (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const cashUps = db.prepare(`
      SELECT cu.*, s.start_time, e.name as employee_name
      FROM cash_ups cu
      LEFT JOIN shifts s ON cu.shift_id = s.id
      LEFT JOIN employees e ON cu.employee_id = e.id
      ORDER BY cu.created_at DESC
      LIMIT ?
    `).all(parseInt(limit));
    
    res.json(cashUps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const cashUp = db.prepare(`
      SELECT cu.*, s.start_time, e.name as employee_name
      FROM cash_ups cu
      LEFT JOIN shifts s ON cu.shift_id = s.id
      LEFT JOIN employees e ON cu.employee_id = e.id
      WHERE cu.id = ?
    `).get(req.params.id);
    
    if (!cashUp) {
      return res.status(404).json({ error: 'Cash-up not found' });
    }
    
    const denominations = db.prepare(`
      SELECT * FROM cash_up_denominations WHERE cash_up_id = ? ORDER BY denomination DESC
    `).all(req.params.id);
    
    const payoutRecords = db.prepare(`
      SELECT * FROM cash_up_payouts WHERE cash_up_id = ?
    `).all(req.params.id);
    
    res.json({ ...cashUp, denominations, payout_records: payoutRecords });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;