import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { groupRoutes } from './routes/groups.js';
import { planRoutes } from './routes/plans.js';
import { friendRoutes } from './routes/friends.js';

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
app.use('/api/friends', friendRoutes);

// Only start the server if this file is run directly (not imported for testing)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Planazo API running on http://localhost:${PORT}`);
  });
}

// Export for testing
export { app };
