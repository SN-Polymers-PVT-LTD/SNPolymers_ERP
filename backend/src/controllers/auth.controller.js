const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../db/supabase');
const { logError } = require('../utils/logger');
const { generateOtp, hashOtp, storeOtp, verifyOtp } = require('../services/otp.service');
const { sendOtp } = require('../services/telegram.service');
const { JWT_SECRET, generateTokens, createSession, closeSession, formatDuration } = require('../services/session.service');
const { notifyAdminLogin, notifyAdminLogout } = require('../services/email.service');
const validate = require('../validation/validate');
const { requestOtpSchema, verifyOtpSchema } = require('../validation/auth.schema');

const isProd = process.env.NODE_ENV === 'production';
const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax'
};

/**
 * POST /api/v1/auth/request-otp
 * Validates mobile number against whitelist.
 * If user has a telegram_chat_id, sends OTP via Telegram.
 * If not, returns needsTelegramSetup: true so the frontend can gate the user.
 */
async function requestOtp(req, res) {
  if (!validate(req, res, requestOtpSchema)) return;
  const { mobileNumber } = req.body;

  try {
    // 1. Check if user is whitelisted & active
    const { data: user, error } = await supabase
      .from('authorised_users')
      .select('*')
      .eq('mobile_number', mobileNumber)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (error || !user) {
      return res.status(403).json({ success: false, message: 'Access denied. This number is not whitelisted or is inactive.' });
    }

    // 2. If no telegram_chat_id set, prompt user to complete Telegram setup first
    if (!user.telegram_chat_id) {
      return res.status(200).json({
        success: true,
        needsTelegramSetup: true,
        message: 'Telegram setup required before OTP can be delivered.'
      });
    }

    // 3. Generate OTP & Hash
    const rawOtp = generateOtp();
    const hashed = await hashOtp(rawOtp);

    // 4. Store OTP in DB
    await storeOtp(mobileNumber, hashed);

    // 5. Send OTP via Telegram
    await sendOtp(user.telegram_chat_id, rawOtp);

    return res.status(200).json({
      success: true,
      needsTelegramSetup: false,
      message: 'OTP has been generated and sent to your Telegram account.'
    });
  } catch (error) {
    logError('requestOtp', error);
    return res.status(500).json({ success: false, message: 'Failed to request OTP.' });
  }
}



/**
 * GET /api/v1/auth/link-status
 * Public polling endpoint. Checks if the user's telegram_chat_id is populated.
 */
async function checkLinkStatus(req, res) {
  const { mobileNumber } = req.query;
  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number is required.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('authorised_users')
      .select('telegram_chat_id')
      .eq('mobile_number', mobileNumber)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ success: false, message: 'User not found or inactive.' });
    }

    const linked = !!user.telegram_chat_id;
    return res.status(200).json({
      success: true,
      linked
    });
  } catch (error) {
    logError('checkLinkStatus', error);
    return res.status(500).json({ success: false, message: 'Failed to verify link status.' });
  }
}

/**
 * POST /api/v1/auth/verify-otp
 * Verifies OTP and generates Session / JWT
 */
async function verifyOtpCode(req, res) {
  if (!validate(req, res, verifyOtpSchema)) return;
  const { mobileNumber, otp } = req.body;

  try {
    // 1. Verify OTP
    const verificationResult = await verifyOtp(mobileNumber, otp);

    if (!verificationResult.success) {
      return res.status(400).json({
        success: false,
        message: verificationResult.reason,
        attemptsLeft: verificationResult.attemptsLeft
      });
    }

    // 2. Fetch User to populate payload details
    const { data: user, error } = await supabase
      .from('authorised_users')
      .select('*')
      .eq('mobile_number', mobileNumber)
      .limit(1)
      .single();

    if (error || !user) {
      return res.status(403).json({ success: false, message: 'User verification failed.' });
    }

    // 3. Issue Tokens & Create DB Session
    const refreshJti = uuidv4();
    const ipAddress = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'];

    const session = await createSession({
      userId: user.id,
      jti: refreshJti,
      ipAddress,
      userAgent
    });

    const { accessToken, refreshToken } = generateTokens(user, session.id, refreshJti);

    // 4. Store Tokens in httpOnly Cookies
    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // 5. Send parallel async Admin Notification Email
    // Runs in the background, does not block the response
    notifyAdminLogin({
      mobileNumber: user.mobile_number,
      displayName: user.display_name,
      role: user.role,
      ipAddress,
      userAgent
    });

    return res.status(200).json({
      success: true,
      message: 'Authentication successful.',
      user: {
        id: user.id,
        mobile_number: user.mobile_number,
        display_name: user.display_name,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (error) {
    logError('verifyOtpCode', error);
    return res.status(500).json({ success: false, message: 'Failed to verify OTP code.' });
  }
}

/**
 * POST /api/v1/auth/logout
 * Logs out user, invalidates JWT jti in sessions and notifies admin
 */
async function logout(req, res) {
  try {
    const sessionId = req.sessionId;
    const user = req.user;

    // 1. Close Session in DB
    const closedSession = await closeSession(sessionId);
    const durationFormatted = formatDuration(closedSession.duration_seconds);

    // 2. Clear Token Cookies
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('token', cookieOptions);

    // 3. Trigger Admin Notification (async)
    notifyAdminLogout({
      mobileNumber: user.mobile_number,
      displayName: user.displayName,
      durationFormatted,
      logoutTime: closedSession.logout_at
    });

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  } catch (error) {
    logError('logout', error);
    return res.status(500).json({ success: false, message: 'Failed to logout.' });
  }
}

/**
 * POST /api/v1/auth/refresh
 * Refreshes access token and rotates refresh token (RTR)
 */
async function refreshTokens(req, res) {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ success: false, message: 'Authentication required. No refresh token provided.' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);

    // 1. Fetch active session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', decoded.session_id)
      .limit(1)
      .single();

    if (sessionError || !session || !session.is_active) {
      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('token', cookieOptions);
      return res.status(401).json({ success: false, message: 'Session is inactive or has been logged out.' });
    }

    // 2. Replay Attack Detection (RTR)
    if (session.jwt_jti !== decoded.jti) {
      // Invalidate the session immediately
      await supabase
        .from('sessions')
        .update({ is_active: false, logout_at: new Date().toISOString() })
        .eq('id', session.id);

      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('token', cookieOptions);
      return res.status(401).json({ success: false, message: 'Replay attack detected. Session revoked.' });
    }

    // 3. User Whitelist status check
    const { data: user, error: userError } = await supabase
      .from('authorised_users')
      .select('*')
      .eq('id', decoded.user_id)
      .limit(1)
      .single();

    if (userError || !user || !user.is_active) {
      res.clearCookie('accessToken', cookieOptions);
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('token', cookieOptions);
      return res.status(403).json({ success: false, message: 'Access denied. Account is deactivated or removed.' });
    }

    // 4. Rotate tokens
    const newRefreshJti = uuidv4();
    const { data: updatedSession, error: updateError } = await supabase
      .from('sessions')
      .update({ jwt_jti: newRefreshJti })
      .eq('id', session.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update session: ${updateError.message}`);
    }

    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user, session.id, newRefreshJti);

    // 5. Send updated cookies
    res.cookie('accessToken', newAccessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000 // 15 mins
    });

    res.cookie('refreshToken', newRefreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.status(200).json({
      success: true,
      message: 'Tokens refreshed successfully.',
      user: {
        id: user.id,
        mobile_number: user.mobile_number,
        display_name: user.display_name,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (error) {
    logError('refreshTokens', error);
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('token', cookieOptions);
    return res.status(401).json({ success: false, message: 'Failed to refresh tokens.' });
  }
}

/**
 * GET /api/v1/auth/me
 * Returns current authenticated user
 */
async function getMe(req, res) {
  return res.status(200).json({
    success: true,
    user: req.user
  });
}

/**
 * GET /api/v1/auth/profile
 * Returns detailed, role-specific profile data for current user.
 */
async function getProfileData(req, res) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    // 1. Fetch user's basic record to get the latest telegram chat id and active status
    const { data: userRecord, error: userError } = await supabase
      .from('authorised_users')
      .select('display_name, mobile_number, role, telegram_chat_id, is_active')
      .eq('mobile_number', user.mobile_number)
      .maybeSingle();

    if (userError || !userRecord) {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }

    const profile = {
      display_name: userRecord.display_name,
      mobile_number: userRecord.mobile_number,
      role: userRecord.role,
      telegram_chat_id: userRecord.telegram_chat_id,
      is_active: userRecord.is_active
    };

    let roleData = {};

    if (userRecord.role === 'je') {
      // Find active ZO mapping
      const { data: mapping } = await supabase
        .from('je_zo_mappings')
        .select('zo_user_id')
        .eq('je_user_id', userRecord.mobile_number)
        .eq('is_active', true)
        .maybeSingle();

      let zoDetails = null;
      if (mapping) {
        const { data: zoUser } = await supabase
          .from('authorised_users')
          .select('display_name, mobile_number')
          .eq('mobile_number', mapping.zo_user_id)
          .maybeSingle();
        if (zoUser) {
          zoDetails = zoUser;
        }
      }

      // Find active work orders assigned to JE
      const { data: woMappings } = await supabase
        .from('work_order_mappings')
        .select('work_order_no')
        .eq('je_user_id', userRecord.mobile_number)
        .eq('is_active', true);

      let workOrders = [];
      if (woMappings && woMappings.length > 0) {
        const woNos = woMappings.map(m => m.work_order_no);
        const { data: projects } = await supabase
          .from('projects_master')
          .select('work_order_no, estimate_no, site_details, state, district, zone, department, status')
          .in('work_order_no', woNos);
        if (projects) {
          workOrders = projects;
        }
      }

      // Analytics: Daily progress reports & Cost Estimates
      const { data: progressReports } = await supabase
        .from('daily_progress_reports')
        .select('report_id, site_visit_date, physical_work_progress, approved_user_id, work_order_no')
        .eq('created_by', userRecord.mobile_number)
        .order('site_visit_date', { ascending: false });

      const totalReports = progressReports ? progressReports.length : 0;
      const recentReports = progressReports ? progressReports.slice(0, 5) : [];

      // Query cost estimates created by this JE
      const { data: jeEstimates } = await supabase
        .from('project_cost_estimates')
        .select('estimate_status')
        .eq('je_user_id', userRecord.mobile_number);

      const approvedCount = jeEstimates ? jeEstimates.filter(e => e.estimate_status === 'Final Approved').length : 0;
      const pendingCount = jeEstimates ? jeEstimates.filter(e => ['Submitted', 'Under ZO Review', 'ZO Approved', 'Under HO Review', 'ZO Revision Requested', 'HO Revision Requested', 'Estimate Reopened'].includes(e.estimate_status)).length : 0;

      roleData = {
        zoDetails,
        workOrders,
        stats: { totalReports, approvedCount, pendingCount },
        recentReports
      };
    } else if (userRecord.role === 'zo') {
      // Find Zonal Balance
      const { data: balanceData } = await supabase
        .from('zo_balances')
        .select('available_balance')
        .eq('zo_user_id', userRecord.mobile_number)
        .maybeSingle();
      const balance = balanceData ? parseFloat(balanceData.available_balance) : 0;

      // Find JEs mapped under this ZO
      const { data: jeMappings } = await supabase
        .from('je_zo_mappings')
        .select('je_user_id')
        .eq('zo_user_id', userRecord.mobile_number)
        .eq('is_active', true);

      let jes = [];
      if (jeMappings && jeMappings.length > 0) {
        const jeIds = jeMappings.map(m => m.je_user_id);
        const { data: users } = await supabase
          .from('authorised_users')
          .select('display_name, mobile_number, is_active')
          .in('mobile_number', jeIds);
        if (users) {
          jes = users;
        }
      }

      // Find owned Work Orders/Projects
      const { data: ownedProjects } = await supabase
        .from('projects_master')
        .select('work_order_no, estimate_no, site_details, state, district, zone, department, status')
        .eq('zo_user_id', userRecord.mobile_number);

      let jeMappingsWithNames = [];
      if (ownedProjects && ownedProjects.length > 0) {
        const ownedWoNos = ownedProjects.map(p => p.work_order_no);
        const { data: woMapData } = await supabase
          .from('work_order_mappings')
          .select('work_order_no, je_user_id')
          .eq('is_active', true)
          .in('work_order_no', ownedWoNos);

        if (woMapData && woMapData.length > 0) {
          const uniqueJeIds = [...new Set(woMapData.map(m => m.je_user_id))];
          const { data: jeUsers } = await supabase
            .from('authorised_users')
            .select('display_name, mobile_number, is_active')
            .in('mobile_number', uniqueJeIds);

          const jeUserMap = {};
          if (jeUsers) {
            jeUsers.forEach(u => {
              jeUserMap[u.mobile_number] = u;
            });
          }

          jeMappingsWithNames = woMapData.map(m => ({
            work_order_no: m.work_order_no,
            je_user_id: m.je_user_id,
            display_name: jeUserMap[m.je_user_id]?.display_name || 'Unknown JE',
            mobile_number: jeUserMap[m.je_user_id]?.mobile_number || m.je_user_id,
            is_active: jeUserMap[m.je_user_id]?.is_active ?? false
          }));
        }
      }

      // Find Fund Ledger transactions
      const { data: transactions } = await supabase
        .from('zo_fund_ledger')
        .select('ledger_id, transaction_type, reference_type, amount, work_order_no, created_at')
        .eq('zo_user_id', userRecord.mobile_number)
        .order('created_at', { ascending: false })
        .limit(10);

      roleData = {
        balance,
        jes,
        workOrders: ownedProjects || [],
        jeMappings: jeMappingsWithNames,
        recentTransactions: transactions || []
      };
    } else if (userRecord.role === 'ho' || userRecord.role === 'admin') {
      // 1. Fetch system-wide summaries
      const { count: usersCount } = await supabase
        .from('authorised_users')
        .select('id', { count: 'exact', head: true });
      const { count: projectsCount } = await supabase
        .from('projects_master')
        .select('work_order_no', { count: 'exact', head: true });
      const { count: activeMappingsCount } = await supabase
        .from('je_zo_mappings')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);
      const { data: zoBalances } = await supabase
        .from('zo_balances')
        .select('zo_user_id, available_balance');

      let balancesWithNames = [];
      let totalBalancesSum = 0;
      if (zoBalances && zoBalances.length > 0) {
        const zoIds = zoBalances.map(b => b.zo_user_id);
        const { data: names } = await supabase
          .from('authorised_users')
          .select('mobile_number, display_name')
          .in('mobile_number', zoIds);
        
        balancesWithNames = zoBalances.map(b => {
          const u = names ? names.find(n => n.mobile_number === b.zo_user_id) : null;
          const amt = parseFloat(b.available_balance);
          totalBalancesSum += amt;
          return {
            zo_user_id: b.zo_user_id,
            zo_name: u ? u.display_name : 'Unknown ZO',
            available_balance: amt
          };
        });
      }

      // 2. Fetch Admin's own recent actions
      const { data: recentActions } = await supabase
        .from('audit_log')
        .select('id, action, module_name, record_identifier, timestamp')
        .eq('user_id', userRecord.mobile_number)
        .order('timestamp', { ascending: false })
        .limit(10);

      // 3. Fetch all projects with their details and calculate estimate sheets count
      const { data: projectsList } = await supabase
        .from('projects_master')
        .select('work_order_no, estimate_no, site_details, state, district, zone, department, status, work_order_value');

      const { data: allEstimates } = await supabase
        .from('project_cost_estimates')
        .select('work_order_no');

      const estimateCounts = {};
      if (allEstimates) {
        allEstimates.forEach(est => {
          estimateCounts[est.work_order_no] = (estimateCounts[est.work_order_no] || 0) + 1;
        });
      }

      // Fetch requisitions to sum up requisition amounts and counts per work order
      const { data: allRequisitions } = await supabase
        .from('requisitions')
        .select('work_order_no, requisition_amount');

      const reqSum = {};
      const reqCount = {};
      if (allRequisitions) {
        allRequisitions.forEach(r => {
          const amt = parseFloat(r.requisition_amount || 0);
          reqSum[r.work_order_no] = (reqSum[r.work_order_no] || 0) + amt;
          reqCount[r.work_order_no] = (reqCount[r.work_order_no] || 0) + 1;
        });
      }

      // Fetch daily progress reports to get counts and max physical progress per work order
      const { data: allProgress } = await supabase
        .from('daily_progress_reports')
        .select('work_order_no, physical_work_progress');

      const progressCount = {};
      const maxProgress = {};
      if (allProgress) {
        allProgress.forEach(p => {
          const val = parseFloat(p.physical_work_progress || 0);
          progressCount[p.work_order_no] = (progressCount[p.work_order_no] || 0) + 1;
          if (val > (maxProgress[p.work_order_no] || 0)) {
            maxProgress[p.work_order_no] = val;
          }
        });
      }

      const enrichedProjects = (projectsList || []).map(p => ({
        work_order_no: p.work_order_no,
        estimate_no: p.estimate_no,
        site_details: p.site_details,
        state: p.state,
        district: p.district,
        zone: p.zone,
        department: p.department,
        status: p.status,
        work_order_value: parseFloat(p.work_order_value || 0),
        estimate_sheets_count: estimateCounts[p.work_order_no] || 0,
        requisitions_total_amount: reqSum[p.work_order_no] || 0,
        requisitions_count: reqCount[p.work_order_no] || 0,
        progress_reports_count: progressCount[p.work_order_no] || 0,
        max_physical_progress: maxProgress[p.work_order_no] || 0
      }));

      // 4. Fetch latest transactions (Combined Fund Requests + Requisitions)
      const [fundRequestsRes, requisitionsRes] = await Promise.all([
        supabase
          .from('fund_requests')
          .select('zo_fr_no, zo_fr_amount, request_status, created_at')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('requisitions')
          .select('requisition_no, requisition_amount, requisition_status, created_at')
          .order('created_at', { ascending: false })
          .limit(10)
      ]);

      const fundReqs = (fundRequestsRes.data || []).map(fr => ({
        type: 'Fund Request',
        identifier: fr.zo_fr_no,
        amount: parseFloat(fr.zo_fr_amount),
        status: fr.request_status,
        date: fr.created_at
      }));

      const reqs = (requisitionsRes.data || []).map(r => ({
        type: 'Requisition',
        identifier: r.requisition_no,
        amount: parseFloat(r.requisition_amount),
        status: r.requisition_status,
        date: r.created_at
      }));

      const combinedTransactions = [...fundReqs, ...reqs]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10);

      // 5. Calculate Capital Flow Metrics
      // A. Pending Clearance (In-Flight)
      const { data: pendingFRs } = await supabase
        .from('fund_requests')
        .select('zo_fr_amount')
        .eq('request_status', 'Pending');
      
      const { data: pendingReqs } = await supabase
        .from('requisitions')
        .select('requisition_amount')
        .eq('requisition_status', 'Pending');

      const pendingFRsSum = pendingFRs ? pendingFRs.reduce((sum, r) => sum + parseFloat(r.zo_fr_amount || 0), 0) : 0;
      const pendingReqsSum = pendingReqs ? pendingReqs.reduce((sum, r) => sum + parseFloat(r.requisition_amount || 0), 0) : 0;

      // B. Recent Movement (Last 30 Days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();

      const { data: recentApprovedFRs } = await supabase
        .from('fund_requests')
        .select('approve_ho_amount')
        .eq('request_status', 'Approved')
        .gte('created_at', thirtyDaysAgoIso);

      const { data: recentApprovedReqs } = await supabase
        .from('requisitions')
        .select('approved_amount')
        .eq('requisition_status', 'Approved')
        .gte('created_at', thirtyDaysAgoIso);

      const approvedFRsSum = recentApprovedFRs ? recentApprovedFRs.reduce((sum, r) => sum + parseFloat(r.approve_ho_amount || 0), 0) : 0;
      const approvedReqsSum = recentApprovedReqs ? recentApprovedReqs.reduce((sum, r) => sum + parseFloat(r.approved_amount || 0), 0) : 0;

      roleData = {
        stats: {
          totalUsers: usersCount || 0,
          totalProjects: projectsCount || 0,
          activeMappings: activeMappingsCount || 0,
          totalZonalBalances: totalBalancesSum
        },
        capitalFlow: {
          inFlight: {
            total: pendingFRsSum + pendingReqsSum,
            fundRequests: pendingFRsSum,
            requisitions: pendingReqsSum
          },
          recentMoved: {
            total: approvedFRsSum + approvedReqsSum,
            zonalAllocations: approvedFRsSum,
            requisitionsDisbursed: approvedReqsSum
          }
        },
        balances: balancesWithNames,
        recentActions: recentActions || [],
        enrichedProjects,
        latestTransactions: combinedTransactions
      };
    }

    return res.status(200).json({
      success: true,
      profile,
      roleData
    });
  } catch (error) {
    logError('getProfileData', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve profile data.' });
  }
}

module.exports = {
  requestOtp,
  checkLinkStatus,
  verifyOtpCode,
  logout,
  refreshTokens,
  getMe,
  getProfileData
};

