import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import identifyRoutes from './routes/identify.routes';
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(cors());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.send('BiteSpeed server is running');
});

app.use('/api', identifyRoutes);

app.all('/{*any}', (req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found',
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
  });
});

export default app;
