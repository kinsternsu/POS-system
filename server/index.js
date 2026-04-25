import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase } from './database.js';
import employeesRoutes from './routes/employees.js';
import productsRoutes from './routes/products.js';
import transactionsRoutes from './routes/transactions.js';
import returnsRoutes from './routes/returns.js';
import settingsRoutes from './routes/settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = 3000;
const JWT_SECRET = 'pos_system_secret_key_2024';

process.env.JWT_SECRET = JWT_SECRET;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

initializeDatabase();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'login.html'));
});

app.use('/api/employees', employeesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/returns', returnsRoutes);
app.use('/api/settings', settingsRoutes);

app.listen(PORT, () => {
  console.log(`POS Server running at http://localhost:${PORT}`);
});