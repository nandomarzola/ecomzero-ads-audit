const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const AppError = require('./lib/AppError');
const authRoutes = require('./routes/auth.routes');
const shopeeRoutes = require('./routes/shopee.routes');
const storeRoutes = require('./routes/store.routes');
const itemRoutes = require('./routes/item.routes');
const { notFound, errorHandler } = require('./middlewares/error');

const app = express();

if (env.isProduction) app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    return callback(new AppError('Origem não autorizada', {
      status: 403,
      code: 'cors_forbidden',
    }));
  },
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', env: env.nodeEnv }));

app.use('/api', authRoutes);
app.use('/api', shopeeRoutes);
app.use('/api', storeRoutes);
app.use('/api', itemRoutes);

// 404 e handler central — sempre por último
app.use(notFound);
app.use(errorHandler);

// Só sobe o servidor quando executado direto (permite importar o app em testes)
if (require.main === module) {
  const { startWorkers, closeWorkers } = require('./jobs');
  const { closeQueues } = require('./services/queueService');
  const workers = env.workersEnabled ? startWorkers() : [];
  const server = app.listen(env.port, () => {
    console.log(`ecomzero-ads-audit API em http://localhost:${env.port} (${env.nodeEnv})`);
  });
  const shutdown = async () => {
    server.close();
    await closeWorkers(workers);
    await closeQueues();
    await require('./lib/prisma').$disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

module.exports = app;
