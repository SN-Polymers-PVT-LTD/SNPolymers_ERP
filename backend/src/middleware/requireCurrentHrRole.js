const { supabase } = require('../db/supabase');

module.exports = function requireCurrentHrRole(allowedRoles) {
  return async (req, res, next) => {
    const { data, error } = await supabase.from('authorised_users')
      .select('role,is_active').eq('id', req.user.id).maybeSingle();
    if (error) return res.status(500).json({ success: false, message: 'Unable to verify factory access.' });
    if (!data?.is_active || !allowedRoles.includes(data.role)) {
      return res.status(403).json({ success: false, message: 'Factory access denied.' });
    }
    req.user.role = data.role;
    return next();
  };
};
