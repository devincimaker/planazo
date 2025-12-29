import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { groupRoutes } from './routes/groups.js';
import { planRoutes } from './routes/plans.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Planazo API!' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/groups', groupRoutes);
app.use('/api/plans', planRoutes);

app.listen(PORT, () => {
  console.log(`Planazo API running on http://localhost:${PORT}`);
});
