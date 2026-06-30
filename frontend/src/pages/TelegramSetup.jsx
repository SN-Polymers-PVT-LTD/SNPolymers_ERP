import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import authApi from '../api/authApi';
import BackgroundShapes from '../components/BackgroundShapes';

// Telegram Paper Plane SVG icon (brand-accurate)
const TelegramIcon = ({ size = 48 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 240 240"
    width={size}
    height={size}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="tg-grad-setup" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#2AABEE" />
        <stop offset="100%" stopColor="#229ED9" />
      </linearGradient>
    </defs>
    <circle cx="120" cy="120" r="120" fill="url(#tg-grad-setup)" />
    <path
      d="M81.7 133.2l-4.1 43.9c5.9 0 8.4-2.5 11.4-5.5l27.3-26.1 56.6 41.4c10.4 5.7 17.7 2.7 20.5-9.6l37.2-174.4c3.3-15.4-5.6-21.5-15.7-17.8L11.2 98.5c-15 5.9-14.8 14.3-2.7 18.1l49.4 15.4 114.5-72c5.4-3.3 10.3-1.5 6.3 2.1L81.7 133.2z"
      fill="white"
    />
  </svg>
);

const STEPS = [
  {
    number: 1,
    emoji: '🤖',
    label: 'Tap the blue "Open Telegram Bot" button below',
  },
  {
    number: 2,
    emoji: '🚀',
    label: 'Tap the "Start" button at the bottom of the chat',
  },
  {
    number: 3,
    emoji: '📱',
    label: 'Tap the "Share Contact" button in the bot to link automatically',
  },
];

const TelegramSetup = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const mobileNumber = location.state?.mobileNumber;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [linked, setLinked] = useState(false);
  const [checking, setChecking] = useState(true);

  // Redirect back if no mobile number in state
  React.useEffect(() => {
    if (!mobileNumber) {
      navigate('/login', { replace: true });
    }
  }, [mobileNumber, navigate]);

  // Helper to trigger OTP request
  const triggerOtpRequest = async () => {
    setLoading(true);
    setError('');
    try {
      const otpRes = await authApi.post('/request-otp', { mobileNumber });
      if (otpRes.data?.success) {
        navigate('/verify-otp', { state: { mobileNumber } });
      } else {
        setError('Account linked but OTP failed to send. Please try logging in again.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Account linked but OTP failed to send. Please try logging in again.');
    } finally {
      setLoading(false);
    }
  };

  // Poll for link status
  React.useEffect(() => {
    if (!mobileNumber) return;

    let isSubscribed = true;
    let pollInterval = null;

    const checkStatus = async () => {
      try {
        const res = await authApi.get('/link-status', {
          params: { mobileNumber }
        });

        if (res.data?.success && res.data?.linked) {
          if (pollInterval) clearInterval(pollInterval);
          if (isSubscribed) {
            setLinked(true);
            setChecking(false);
            // Automatically request OTP now that the account is linked!
            await triggerOtpRequest();
          }
        }
      } catch (err) {
        console.error('Error checking Telegram link status:', err);
      }
    };

    // Initial check
    checkStatus();

    // Poll every 3 seconds
    pollInterval = setInterval(checkStatus, 3000);

    return () => {
      isSubscribed = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [mobileNumber]);

  // Manual fallback check
  const checkLinkStatusManual = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await authApi.get('/link-status', {
        params: { mobileNumber }
      });

      if (res.data?.success && res.data?.linked) {
        setLinked(true);
        // Request OTP
        const otpRes = await authApi.post('/request-otp', { mobileNumber });
        if (otpRes.data?.success) {
          navigate('/verify-otp', { state: { mobileNumber } });
        } else {
          setError('Account linked but OTP failed to send. Please try logging in again.');
        }
      } else {
        setError('Connection not found yet. Please make sure you clicked "Share Contact" in the Telegram bot.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to check link status. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-slate-100 flex items-center justify-center px-4 font-sans relative overflow-hidden">
      <BackgroundShapes />

      <div className="max-w-md w-full glass-panel p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative z-10">

        {/* Icon + Heading */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-5 mx-auto"
            style={{
              background: 'rgba(42,171,238,0.08)',
              border: '1.5px solid rgba(42,171,238,0.25)',
              boxShadow: '0 0 32px rgba(42,171,238,0.15)',
            }}
          >
            <TelegramIcon size={44} />
          </div>

          <h2 className="text-xl font-extrabold uppercase tracking-widest text-slate-100">
            One-Time Telegram Setup
          </h2>
          <p className="text-xs text-slate-400 mt-3 font-normal leading-relaxed max-w-sm mx-auto">
            IDBP uses Telegram to securely deliver your login codes. This quick setup only takes a minute and you'll only need to do it once.
          </p>
          <div className="h-[1px] w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent mx-auto mt-5" />
        </div>

        {/* Prominent Telegram Action Button */}
        <div className="mb-6">
          <a
            href="https://t.me/snpolymers_bot?start=link"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-4 px-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all duration-300 flex justify-center items-center gap-3 transform hover:-translate-y-0.5 hover:brightness-110 active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #2AABEE 0%, #229ED9 100%)',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(42,171,238,0.25)',
              textDecoration: 'none',
              display: 'flex'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 6px 28px rgba(42,171,238,0.45)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(42,171,238,0.25)';
            }}
          >
            <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.11.02-1.93 1.23-5.46 3.62-.51.35-.98.53-1.4.52-.46-.01-1.35-.26-2.01-.48-.81-.27-1.46-.42-1.4-.88.03-.24.36-.49.99-.75 3.88-1.69 6.46-2.8 7.74-3.32 3.68-1.5 4.44-1.76 4.94-1.77.11 0 .36.03.52.16.14.11.18.27.2.42.02.16.01.32-.01.48z"/>
            </svg>
            Open Telegram Bot
          </a>
        </div>

        {/* Three Steps */}
        <div className="space-y-3 mb-7">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="flex items-start gap-4 p-4 rounded-2xl"
              style={{
                background: 'rgba(42,171,238,0.04)',
                border: '1px solid rgba(42,171,238,0.12)',
              }}
            >
              {/* Step number badge */}
              <div
                className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold"
                style={{
                  background: 'rgba(42,171,238,0.18)',
                  color: '#2AABEE',
                  border: '1px solid rgba(42,171,238,0.3)',
                  minWidth: '28px',
                }}
              >
                {step.number}
              </div>
              <span className="text-xl leading-tight mt-0.5 flex-shrink-0">{step.emoji}</span>
              <p className="text-xs text-slate-300 leading-relaxed font-medium pt-0.5">
                {step.label}
              </p>
            </div>
          ))}
        </div>

        {/* Connection Status Indicator */}
        <div className="space-y-5">
          <div
            className="flex items-center justify-center gap-3.5 p-4 rounded-2xl border transition-all duration-300"
            style={{
              background: 'rgba(42,171,238,0.03)',
              borderColor: linked ? 'rgba(16,185,129,0.3)' : 'rgba(42,171,238,0.15)',
              boxShadow: linked ? '0 0 16px rgba(16,185,129,0.05)' : 'none',
            }}
          >
            {loading ? (
              <div className="animate-spin rounded-full h-4.5 w-4.5 border-t-2 border-b-2 border-white" />
            ) : checking ? (
              <div className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
              </div>
            ) : linked ? (
              <span className="text-emerald-400 font-extrabold text-xs">✓</span>
            ) : null}
            
            <span className="text-xs font-semibold text-slate-300 leading-normal">
              {loading
                ? 'Requesting login passcode...'
                : linked
                ? 'Account linked! Sending login code...'
                : 'Waiting for Telegram connection...'}
            </span>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3.5 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 font-medium leading-relaxed flex items-start gap-2.5">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Manual Link Verification Button */}
          <button
            type="button"
            onClick={checkLinkStatusManual}
            disabled={loading}
            className="w-full py-4 px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-all duration-300 border border-white/10 hover:bg-white/5 active:scale-[0.98] disabled:opacity-50"
          >
            I shared my contact — Send OTP
          </button>
        </div>

        {/* Privacy Note */}
        <p className="mt-6 text-center text-[10px] text-slate-500 leading-relaxed font-normal px-2">
          Your Telegram account is only used for secure login code delivery. We will never send you anything else.
        </p>

        {/* Back link */}
        <div className="mt-4 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-[11px] uppercase tracking-widest font-extrabold text-slate-400 hover:text-slate-200 transition-colors duration-200"
          >
            Change Mobile Number
          </button>
        </div>
      </div>
    </div>
  );
};

export default TelegramSetup;
