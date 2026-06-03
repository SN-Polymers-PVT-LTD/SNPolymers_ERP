import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import authApi from '../api/authApi';

const Login = () => {
  const [mobileNumber, setMobileNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    let formattedNumber = mobileNumber.trim();
    if (/^\d{10}$/.test(formattedNumber)) {
      formattedNumber = `+91${formattedNumber}`;
    }

    if (!/^\+?[1-9]\d{1,14}$/.test(formattedNumber)) {
      setError('Please enter a valid mobile number (e.g. +91XXXXXXXXXX).');
      setLoading(false);
      return;
    }

    try {
      const response = await authApi.post('/request-otp', { mobileNumber: formattedNumber });
      if (response.data?.success) {
        navigate('/verify-otp', { state: { mobileNumber: formattedNumber } });
      } else {
        setError(response.data?.message || 'Authorization check failed.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Access Denied: Registered whitelisted credentials required.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-admin-bg text-slate-100 flex items-center justify-center px-4 font-sans">
      <div className="max-w-md w-full bg-admin-card border border-admin-border p-8 rounded shadow-2xl">
        
        {/* Seal and Title */}
        <div className="text-center mb-8">
          <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-16 w-auto mx-auto mb-4 object-contain" />
          <h2 className="text-xl font-bold uppercase tracking-wider text-slate-100">Portal Authentication</h2>
          <span className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold block mt-1">
            Office Console Verification
          </span>
          <div className="h-[1px] w-24 bg-admin-border mx-auto mt-4"></div>
        </div>

        {/* Informative Security Notice */}
        <div className="mb-6 p-4 rounded bg-slate-900/60 border border-admin-border text-xs text-slate-200 leading-relaxed font-medium">
          <strong className="text-amber-500">Security Notice:</strong> Access is restricted to pre-registered, whitelisted mobile numbers. The system will deliver a one-time verification passcode (OTP) to your authorized WhatsApp number.
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="mobile" className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2">
              Authorized Mobile Number
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400 font-semibold text-sm select-none pointer-events-none">
                +91
              </span>
              <input
                id="mobile"
                type="tel"
                value={mobileNumber.replace(/^\+91/, '')}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="9876543210"
                className="w-full bg-slate-950 border border-admin-border focus:border-amber-600 focus:ring-0 outline-none rounded pl-14 pr-4 py-2.5 text-slate-100 text-sm font-semibold transition duration-150"
                required
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/40 border border-red-900/60 rounded text-xs text-red-300 font-bold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-slate-100 text-xs font-bold uppercase tracking-wider py-3 px-4 rounded border border-amber-500/30 transition duration-150 flex justify-center items-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-slate-100"></div>
                Checking Credentials...
              </>
            ) : (
              'Verify Whitelist & Send OTP'
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/')}
            className="text-[11px] uppercase tracking-wider font-bold text-slate-400 hover:text-slate-200 transition"
          >
            Cancel and Return
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
