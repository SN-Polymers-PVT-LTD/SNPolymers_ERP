const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
require('dotenv').config();

// Production environment sanity checks
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'fallback_development_jwt_secret_key_minimum_256_bit') {
    throw new Error('FATAL SECURITY ERROR: JWT_SECRET must be set and cannot be the default development secret in production.');
  }
  if (!process.env.FRONTEND_URL || process.env.FRONTEND_URL.includes('localhost') || process.env.FRONTEND_URL.includes('127.0.0.1')) {
    throw new Error('FATAL SECURITY ERROR: FRONTEND_URL must be configured to a valid public origin in production.');
  }
}

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const projectRoutes = require('./routes/projects.routes');
const reportRoutes = require('./routes/reports.routes');
const materialsRoutes = require('./routes/materials.routes');
const estimatesRoutes = require('./routes/estimates.routes');
const purchaseDataRoutes = require('./routes/purchaseData.routes');
const masterDataRoutes = require('./routes/masterData.routes');
const fundRequestsRoutes = require('./routes/fundRequests.routes');
const requisitionsRoutes = require('./routes/requisitions.routes');
const dailyProgressRoutes = require('./routes/dailyProgress.routes');

const { startPolling } = require('./services/telegram.service');

const { globalLimiter } = require('./middleware/rateLimiter');
const requestLogger = require('./middleware/requestLogger');

const app = express();
app.use(helmet());
app.use(globalLimiter);
app.use(requestLogger);
const PORT = process.env.PORT || 5000;

// Configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Trust first proxy (required for correct client IP detection in rate limiting behind reverse proxies)
app.set('trust proxy', 1);

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth/admin', adminRoutes);
app.use('/api/v1/auth/projects', projectRoutes);
app.use('/api/v1/auth/reports', reportRoutes);
// Materials endpoint — requires JWT via verifyJwt inside materials.routes.js (SEC-1)
app.use('/api/v1/auth/materials', materialsRoutes);
app.use('/api/v1/auth/estimates', estimatesRoutes);
app.use('/api/v1/auth/purchase-data', purchaseDataRoutes);
app.use('/api/v1/auth/master-data', masterDataRoutes);
app.use('/api/v1/auth/fund-requests', fundRequestsRoutes);
app.use('/api/v1/auth/requisitions', requisitionsRoutes);
app.use('/api/v1/auth/daily-progress', dailyProgressRoutes);

// Basic sanity route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// 404 Route handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Resource not found.' });
});

// Global error handler middleware
app.use((err, req, res, next) => {
  console.error(`Unhandled Application Error: ${err.message}`, err.stack);
  res.status(500).json({ success: false, message: 'An internal server error occurred.' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode.`);
  // Start Telegram bot long-polling loop for auto-reply Chat ID flow
  startPolling();
});

module.exports = app;
