const validate = require('../validation/validate');

/**
 * Middleware: validateRequest
 * Validates request properties (body, query, params) using the validation utility.
 */
function validateRequest(schema) {
  return (req, res, next) => {
    if (validate(req, res, schema)) {
      return next();
    }
  };
}

module.exports = validateRequest;
