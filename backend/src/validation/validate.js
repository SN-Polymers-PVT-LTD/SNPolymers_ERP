/**
 * Utility: validate
 * Performs synchronous Zod schema parsing on request components (params, query, body)
 * and formats the error response if validation fails.
 * Returns true if valid, false if invalid (having already sent the response).
 */
function validate(req, res, schema) {
  if (schema.params) {
    const parsed = schema.params.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0].message });
      return false;
    }
    req.params = parsed.data;
  }
  if (schema.body) {
    const parsed = schema.body.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0].message });
      return false;
    }
    req.body = parsed.data;
  }
  if (schema.query) {
    const parsed = schema.query.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.issues[0].message });
      return false;
    }
    req.query = parsed.data;
  }
  return true;
}

module.exports = validate;
