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
    emoji: '📱',
    label: 'Open Telegram on your phone',
  },
  {
    number: 2,
    emoji: '💬',
    label: (
      <>
        Search{' '}
        <a
          href="https://t.me/snpolymers_bot"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#2AABEE' }}
          className="font-bold underline underline-offset-2"
        >
          @snpolymers_bot
        </a>{' '}
        and send any message — the bot will instantly reply with your Chat ID
      </>
    ),
  },
  {
    number: 3,
    emoji: '🔢',
    label: 'Enter that Chat ID below and tap Link Account',
  },
];

const TelegramSetup = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const mobileNumber = location.state?.mobileNumber;

  const [chatId, setChatId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Redirect back if no mobile number in state
  React.useEffect(() => {
    if (!mobileNumber) {
      navigate('/login', { replace: true });
    }
  }, [mobileNumber, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedId = chatId.trim();
    if (!trimmedId) {
      setError('Please enter the Chat ID the bot sent you.');
      return;
    }

    setLoading(true);

    try {
      // Step 1: Link the Telegram Chat ID to this user
      const linkRes = await authApi.post('/link-telegram', {
        mobileNumber,
        chatId: trimmedId,
      });

      if (!linkRes.data?.success) {
        setError('Invalid Chat ID. Please make sure you entered the number the bot sent you.');
        setLoading(false);
        return;
      }

      // Step 2: Immediately trigger OTP send (now that chat_id is saved)
      const otpRes = await authApi.post('/request-otp', { mobileNumber });

      if (!otpRes.data?.success) {
        setError('Account linked but OTP failed to send. Please try logging in again.');
        setLoading(false);
        return;
      }

      // Step 3: Navigate to OTP entry
      navigate('/verify-otp', { state: { mobileNumber } });
    } catch (err) {
      const msg = err.response?.data?.message;
      // Distinguish link errors from OTP errors based on typical error messages
      if (err.config?.url?.includes('link-telegram')) {
        setError(msg || 'Invalid Chat ID. Please make sure you entered the number the bot sent you.');
      } else {
        setError(msg || 'Account linked but OTP failed to send. Please try logging in again.');
      }
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

        {/* Chat ID Input Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="telegram-chat-id"
              className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5"
            >
              Your Telegram Chat ID
            </label>
            <input
              id="telegram-chat-id"
              type="text"
              inputMode="numeric"
              pattern="-?[0-9]*"
              placeholder="Enter the number the bot sent you"
              value={chatId}
              onChange={(e) => {
                // Accept digits and an optional leading minus (for group chats)
                const val = e.target.value.replace(/[^\d-]/g, '');
                setChatId(val);
              }}
              className="w-full glass-input focus:ring-0 outline-none rounded-xl px-4 py-3.5 text-slate-100 text-sm font-mono font-semibold transition duration-200"
              style={chatId ? { borderColor: 'rgba(42,171,238,0.4)', boxShadow: '0 0 12px rgba(42,171,238,0.1)' } : {}}
              disabled={loading}
              required
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3.5 bg-red-950/20 border border-red-900/30 rounded-xl text-xs text-red-300 font-medium leading-relaxed flex items-start gap-2.5">
              <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* CTA Button */}
          <button
            id="telegram-link-btn"
            type="submit"
            disabled={loading || !chatId.trim()}
            className="w-full py-4 px-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all duration-300 flex justify-center items-center gap-2.5 disabled:opacity-50 transform hover:-translate-y-0.5"
            style={{
              background: '#2AABEE',
              color: '#fff',
              boxShadow: '0 4px 20px rgba(42,171,238,0.3)',
            }}
            onMouseEnter={(e) => {
              if (!loading && chatId.trim()) {
                e.currentTarget.style.boxShadow = '0 6px 28px rgba(42,171,238,0.45)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(42,171,238,0.3)';
            }}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white" />
                Linking Account...
              </>
            ) : (
              'Link My Account — Send OTP'
            )}
          </button>
        </form>

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
