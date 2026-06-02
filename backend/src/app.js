const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();
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
});

module.exports = app;
