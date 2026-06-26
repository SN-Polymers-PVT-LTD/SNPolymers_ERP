'use strict';

/**
 * Log error contextually based on NODE_ENV.
 * Logs full stack trace in development/test, and message-only in production.
 * @param {string} context - The function/method context (e.g. 'createEstimate')
 * @param {Error} error - The error object
 */
function logError(context, error) {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`${context} failed:`, error);
  } else {
    console.error(`${context} failed: ${error.message}`);
  }
}

module.exports = { logError };
