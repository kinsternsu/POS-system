import express from 'express';
import db from '../database.js';
import { authenticateToken, requireAdmin } from '../auth.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    const formatted = {};
    settings.forEach(s => { formatted[s.key] = s.value; });
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const updates = req.body;
    
    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, String(value));
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;