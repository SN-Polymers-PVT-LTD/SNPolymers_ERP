/**
 * Middleware factory: restricts route access to users with one of the specified roles.
 * Normalizes 'staff' role to 'je' for backward compatibility.
 *
 * Usage: requireRole(['je', 'zo', 'ho', 'admin'])
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}.`
      });
    }

    next();
  };
}

module.exports = requireRole;
