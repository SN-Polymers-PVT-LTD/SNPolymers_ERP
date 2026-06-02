import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import authApi from '../api/authApi';
import { useAuth } from '../components/AuthContext';

const OtpVerify = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const mobileNumber = location.state?.mobileNumber;

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [countdown, setCountdown] = useState(300); 
  const [resendDisabled, setResendDisabled] = useState(true);
  const [resendTimer, setResendTimer] = useState(30); 
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!mobileNumber) {
      navigate('/login', { replace: true });
    }
  }, [mobileNumber, navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (resendTimer <= 0) {
      setResendDisabled(false);
      return;
    }
    const timer = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendTimer]);

  const handleChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length === 6) {
      const newOtp = pastedData.split('');
      setOtp(newOtp);
      inputRefs.current[5].focus();
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setSuccess('');
    
    const fullOtp = otp.join('');
    if (fullOtp.length !== 6) {
      setError('Complete 6-digit passcode required.');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.post('/verify-otp', {
        mobileNumber,
        otp: fullOtp,
      });

      if (response.data?.success) {
        setSuccess('Identity authorized. Initializing environment...');
        login(response.data.user);
        setTimeout(() => {
          navigate('/dashboard');
        }, 1200);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Verification rejected. Check code or expiry.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setSuccess('');
    setResendDisabled(true);
    setResendTimer(30);
    
    try {
      const response = await authApi.post('/request-otp', { mobileNumber });
      if (response.data?.success) {
        setSuccess('Passcode dispatch re-triggered.');
        setCountdown(300); 
        setOtp(['', '', '', '', '', '']);
        inputRefs.current[0].focus();
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to dispatch new OTP.');
      setResendDisabled(false);
      setResendTimer(0);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-admin-bg text-slate-100 flex items-center justify-center px-4 font-sans">
      <div className="max-w-md w-full bg-admin-card border border-admin-border p-8 rounded shadow-2xl">
        
        {/* Seal and Title */}
        <div className="text-center mb-8">
          <h2 className="text-xl font-bold uppercase tracking-wider text-slate-100">Passcode Verification</h2>
          <p className="text-xs text-slate-300 mt-2 font-semibold">
            Verification code dispatched to authorized destination:
            <span className="block font-mono text-amber-500 mt-1">{mobileNumber}</span>
          </p>
          <div className="h-[1px] w-24 bg-admin-border mx-auto mt-4"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex justify-between gap-2" onPaste={handlePaste}>
            {otp.map((digit, index) => (
              <input
                key={index}
                type="text"
                maxLength={1}
                value={digit}
                ref={(el) => (inputRefs.current[index] = el)}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="w-12 h-14 bg-slate-950 border border-admin-border focus:border-amber-600 outline-none rounded text-center text-xl font-bold text-slate-100 transition duration-150"
                disabled={loading || countdown <= 0}
              />
            ))}
          </div>

          <div className="flex justify-between items-center text-[11px] text-slate-300 font-bold uppercase tracking-wider">
            <div>
              {countdown > 0 ? (
                <span>Expires: <span className="font-mono text-amber-500">{formatTime(countdown)}</span></span>
              ) : (
                <span className="text-red-500 font-bold">Passcode Expired</span>
              )}
            </div>
            <div>
              {resendDisabled ? (
                <span>Re-dispatch: {resendTimer}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  className="text-amber-500 hover:text-amber-400 transition"
                >
                  Request Re-dispatch
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/20 border border-red-900/40 rounded text-xs text-red-300 font-bold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0"></span>
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-950/20 border border-emerald-900/40 rounded text-xs text-emerald-300 font-bold flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
              {success}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || countdown <= 0}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-slate-100 text-xs font-bold uppercase tracking-wider py-3 px-4 rounded border border-amber-500/30 transition duration-150 flex justify-center items-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-slate-100"></div>
                Authorizing Identity...
              </>
            ) : (
              'Verify Authenticity & Access'
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-[11px] uppercase tracking-wider font-bold text-slate-400 hover:text-slate-200 transition"
          >
            Change Input Number
          </button>
        </div>
      </div>
    </div>
  );
};

export default OtpVerify;
