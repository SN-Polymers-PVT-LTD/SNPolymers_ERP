import React, { useState, useEffect } from 'react';
import authApi from '../api/authApi';
import { useTheme } from '../components/ThemeContext';

const Profile = () => {
  const { theme, toggleTheme, darkBg, setDarkBg, lightBg, setLightBg, DARK_BACKGROUNDS, LIGHT_BACKGROUNDS } = useTheme();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await authApi.get('/profile');
        if (response.data?.success) {
          setProfile(response.data.profile);
        }
      } catch (err) {
        console.error('Error fetching profile data:', err);
        setError(err.response?.data?.message || 'Failed to fetch profile details.');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  return (
    <>
      {/* Header Section */}
      <div className="mb-8 pb-6 border-b border-white/5">
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">My Account</span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">User Profile</h1>
        <p className="text-xs text-slate-400 font-medium mt-1.5">
          View your identity, assignment details, and customize your UI theme and background preferences.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center justify-between">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-8 animate-pulse">
          {/* Profile Card Skeleton */}
          <div className="glass-panel p-6 rounded-3xl flex flex-col md:flex-row items-center gap-6">
            <div className="w-20 h-20 rounded-2xl bg-white/10 shrink-0" />
            <div className="flex-1 space-y-3 w-full">
              <div className="h-6 w-48 bg-white/10 rounded-lg" />
              <div className="h-4 w-32 bg-white/5 rounded-md" />
              <div className="flex gap-4 pt-2">
                <div className="h-4 w-24 bg-white/5 rounded-md" />
                <div className="h-4 w-28 bg-white/5 rounded-md" />
              </div>
            </div>
          </div>
        </div>
      ) : !profile ? (
        <div className="text-center text-slate-500 py-12">No profile data available.</div>
      ) : (
        <div className="space-y-8 animate-fadeIn">
          
          {/* Identity Card */}
          <div className="glass-panel p-6 rounded-3xl flex flex-col md:flex-row items-center gap-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
            
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-amber-500 to-indigo-500 flex items-center justify-center font-black text-slate-950 text-3xl select-none shadow-lg">
              {profile.display_name ? profile.display_name[0].toUpperCase() : 'U'}
            </div>

            <div className="flex-grow text-center md:text-left">
              <div className="flex flex-col md:flex-row md:items-center gap-2 justify-center md:justify-start">
                <h2 className="text-xl font-bold text-slate-100">{profile.display_name}</h2>
                <span className="inline-block w-fit mx-auto md:mx-0 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {profile.role}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium mt-1">Phone: {profile.mobile_number}</p>
              
              <div className="mt-4 flex flex-wrap gap-2 justify-center md:justify-start">
                {profile.role === 'je' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-wider bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    <span>🔥</span>
                    <span>{profile.daily_streak || 0} Day Streak</span>
                  </span>
                )}

                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-wider ${
                  profile.is_active 
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${profile.is_active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  {profile.is_active ? 'Account Active' : 'Account Inactive'}
                </span>

                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-wider ${
                  profile.telegram_chat_id 
                    ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
                    : 'bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse'
                }`}>
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15.75-.8 3.51-1.12 4.79-.14.54-.34.72-.43.73-.2.02-.35-.13-.55-.26-.3-.21-.47-.32-.76-.51-.34-.23-.12-.35.07-.55.05-.05.94-.87.96-.95.002-.01.002-.04-.01-.05-.01-.01-.04-.01-.06.00-.03.01-.48.31-1.37.91-.13.09-.25.13-.36.13-.12-.01-.35-.07-.52-.13-.21-.07-.38-.11-.36-.23.01-.06.1-.12.26-.19 1.01-.44 1.68-.73 2.01-.87 1.92-.81 2.32-.95 2.58-.95.06 0 .19.01.27.08.07.06.09.14.1.22-.01.04-.01.12-.02.19z"/>
                  </svg>
                  {profile.telegram_chat_id ? `Telegram ID: ${profile.telegram_chat_id}` : 'Telegram Setup Needed'}
                </span>
              </div>
            </div>
          </div>

          {/* Theme & Background Personalization Settings */}
          <div className="glass-panel p-6 rounded-3xl shadow-xl relative overflow-hidden mt-8">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-white/5 pb-4 mb-6">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Personalization</span>
                <h3 className="text-lg font-bold text-slate-100 mt-0.5">Appearance & Custom Backgrounds</h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">Customize your preferred UI theme and select unique background styles for light and dark modes.</p>
              </div>
              <button
                onClick={toggleTheme}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition shrink-0"
              >
                <span>{theme === 'light' ? '🌙 Switch to Dark Mode' : '☀️ Switch to Light Mode'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Dark Theme Background Selector */}
              <div className="p-4 rounded-2xl bg-white/2 border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span>🌙</span>
                    <span>Dark Theme Background</span>
                  </div>
                  {theme === 'dark' && (
                    <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active Now</span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2.5 pt-1">
                  {DARK_BACKGROUNDS.map((bg) => (
                    <button
                      key={bg.id}
                      onClick={() => setDarkBg(bg.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        darkBg === bg.id
                          ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-md ring-1 ring-amber-500/30'
                          : 'bg-white/2 border-white/5 text-slate-300 hover:bg-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg border border-white/10 shrink-0 overflow-hidden relative" style={{ background: bg.url ? `url(${bg.url}) center/cover` : bg.style }}>
                          {!bg.url && bg.bgColor && <div className="w-full h-full" style={{ backgroundColor: bg.bgColor }} />}
                        </div>
                        <div>
                          <div className="text-xs font-bold">{bg.name}</div>
                          <div className="text-[10px] text-slate-500">{bg.url ? 'High-res image background' : 'CSS vector / gradient'}</div>
                        </div>
                      </div>
                      {darkBg === bg.id && (
                        <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Light Theme Background Selector */}
              <div className="p-4 rounded-2xl bg-white/2 border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <span>☀️</span>
                    <span>Light Theme Background</span>
                  </div>
                  {theme === 'light' && (
                    <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active Now</span>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2.5 pt-1">
                  {LIGHT_BACKGROUNDS.map((bg) => (
                    <button
                      key={bg.id}
                      onClick={() => setLightBg(bg.id)}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        lightBg === bg.id
                          ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-md ring-1 ring-amber-500/30'
                          : 'bg-white/2 border-white/5 text-slate-300 hover:bg-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg border border-white/10 shrink-0 overflow-hidden relative" style={{ background: bg.url ? `url(${bg.url}) center/cover` : bg.style }}>
                          {!bg.url && bg.bgColor && <div className="w-full h-full" style={{ backgroundColor: bg.bgColor }} />}
                        </div>
                        <div>
                          <div className="text-xs font-bold">{bg.name}</div>
                          <div className="text-[10px] text-slate-500">{bg.url ? 'High-res image background' : 'CSS vector / gradient'}</div>
                        </div>
                      </div>
                      {lightBg === bg.id && (
                        <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Profile;
