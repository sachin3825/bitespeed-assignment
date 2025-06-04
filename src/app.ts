import express from 'express';
import testRoutes from './controllers/idtentify.controller';
const app = express();

app.use(express.json());

app.get('/', (_req, res) => {
  res.send('BiteSpeed server is running');
});
app.use('/api', testRoutes);

app.all('/{*any}', (req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found',
  });
});

export default app;
