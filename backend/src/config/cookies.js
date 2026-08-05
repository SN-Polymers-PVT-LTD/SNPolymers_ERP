function getCookieOptions(nodeEnv = process.env.NODE_ENV) {
  const isProd = nodeEnv === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax'
  };
}

module.exports = { getCookieOptions };
