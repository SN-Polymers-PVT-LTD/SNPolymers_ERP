function buildAllowedOrigins() {
  return [
    process.env.FRONTEND_URL,
    'https://sn-polymers.vercel.app',
    'https://snpolymers.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ].filter(Boolean);
}

/**
 * Returns true when the request Origin should be accepted by CORS middleware.
 */
function isOriginAllowed(origin, { nodeEnv = process.env.NODE_ENV, allowedOrigins = buildAllowedOrigins() } = {}) {
  if (!origin) return true;

  let isVercel = false;
  try {
    isVercel = /\.vercel\.app$/.test(new URL(origin).hostname);
  } catch {
    isVercel = false;
  }

  if (allowedOrigins.includes(origin) || isVercel) {
    return true;
  }

  if (nodeEnv !== 'production') {
    return true;
  }

  return /^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);
}

module.exports = { buildAllowedOrigins, isOriginAllowed };
