import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import authApi from '../api/authApi';
import BackgroundShapes from '../components/BackgroundShapes';

const Login = () => {
  const [mobileNumber, setMobileNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Always normalise: strip everything except digits, then prepend +91
    const digits = mobileNumber.replace(/\D/g, '');
    // Support full 12-digit input (91XXXXXXXXXX) or 10-digit (XXXXXXXXXX)
    const last10 = digits.slice(-10);
    const formattedNumber = last10.length === 10 ? `+91${last10}` : mobileNumber.trim();

    if (!/^\+91\d{10}$/.test(formattedNumber)) {
      setError('Please enter a valid 10-digit mobile number.');
      setLoading(false);
      return;
    }

    try {
      const response = await authApi.post('/request-otp', { mobileNumber: formattedNumber });
      if (response.data?.success) {
        if (response.data?.needsTelegramSetup) {
          navigate('/telegram-setup', { state: { mobileNumber: formattedNumber } });
        } else {
          navigate('/verify-otp', { state: { mobileNumber: formattedNumber } });
        }
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
    <div className="min-h-screen bg-transparent text-slate-100 flex items-center justify-center px-4 font-sans relative overflow-hidden">
      {/* Background Silhouettes & Ambient Glows */}
      <BackgroundShapes />

      <div className="max-w-md w-full glass-panel p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative z-10">
        
        {/* Seal and Title */}
        <div className="text-center mb-8">
          <img src="/assets/logo.png" alt="SN Polymers Pvt LTD Logo" className="h-16 w-auto mx-auto mb-5 object-contain filter drop-shadow-[0_2px_8px_rgba(255,255,255,0.08)]" />
          <h2 className="text-xl font-extrabold uppercase tracking-widest text-slate-100">Portal Authentication</h2>
          <span className="text-[10px] uppercase tracking-widest text-amber-500/90 font-bold block mt-1.5">
            Office Console Verification
          </span>
          <div className="h-[1px] w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent mx-auto mt-4"></div>
        </div>

        {/* Informative Security Notice */}
        <div className="mb-8 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/10 text-xs text-slate-300 leading-relaxed font-normal shadow-inner">
          <strong className="text-amber-500 font-semibold">Security Notice:</strong> Access is restricted to pre-registered, whitelisted mobile numbers. The system will deliver a one-time verification passcode (OTP) to your authorized Telegram account.
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="mobile" className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              Authorized Mobile Number
            </label>
            <div className="relative rounded-xl overflow-hidden">
              <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400 font-bold text-sm select-none pointer-events-none">
                +91
              </span>
              <input
                id="mobile"
                type="tel"
                value={mobileNumber.replace(/^\+91/, '')}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="9876543210"
                className="w-full glass-input focus:ring-0 outline-none rounded-xl pl-14 pr-4 py-3.5 text-slate-100 text-sm font-semibold transition duration-200"
                required
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <div className="p-3.5 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 font-bold flex items-center gap-2.5 animate-headShake">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-950 text-xs font-bold uppercase tracking-wider py-4 px-4 rounded-xl shadow-[0_4px_20px_rgba(255,255,255,0.1)] hover:shadow-[0_6px_25px_rgba(255,255,255,0.2)] transition-all duration-300 transform hover:-translate-y-0.5 flex justify-center items-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-slate-950"></div>
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
            className="text-[11px] uppercase tracking-widest font-extrabold text-slate-400 hover:text-slate-200 transition-colors duration-200"
          >
            Cancel and Return
          </button>
        </div>
      </div>
    </div>
  );
};

export default Login;
