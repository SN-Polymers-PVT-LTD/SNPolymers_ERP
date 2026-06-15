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

    // Normalize 'staff' to 'je'
    const effectiveRole = req.user.role === 'staff' ? 'je' : req.user.role;

    if (!allowedRoles.includes(effectiveRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}.`
      });
    }

    next();
  };
}

module.exports = requireRole;
