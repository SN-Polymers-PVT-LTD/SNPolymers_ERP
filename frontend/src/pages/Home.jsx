import React from 'react';
import { useAuth } from '../components/AuthContext';
import { Link } from 'react-router-dom';

const Home = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-black text-slate-100 flex flex-col font-sans relative overflow-hidden">
      {/* Background Ambient Glows */}
      <div className="absolute top-[10%] left-[10%] w-[35rem] h-[35rem] rounded-full bg-indigo-500/10 blur-[150px] pointer-events-none animate-pulse" style={{ animationDuration: '10s' }}></div>
      <div className="absolute bottom-[20%] right-[10%] w-[30rem] h-[30rem] rounded-full bg-amber-500/5 blur-[130px] pointer-events-none animate-pulse" style={{ animationDuration: '15s' }}></div>

      {/* Header Bar */}
      <header className="glass-nav sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-10 w-auto object-contain" />
            <div className="flex flex-col">
              <span className="font-bold text-sm tracking-wider text-slate-100 uppercase font-sans">
                S.N. Polymers
              </span>
              <span className="text-[10px] text-amber-500 font-bold tracking-widest uppercase">
                Enterprise Resource Planning
              </span>
            </div>
          </div>
          <nav className="flex items-center gap-4">
            {user ? (
              <Link
                to="/dashboard"
                className="px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 shadow-[0_4px_20px_rgba(245,158,11,0.25)] hover:shadow-[0_6px_25px_rgba(245,158,11,0.4)] transition-all duration-300 transform hover:-translate-y-0.5"
              >
                Console Dashboard
              </Link>
            ) : (
              <Link
                to="/login"
                id="office-use-btn"
                className="px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-slate-200 hover:text-slate-100 transition-all duration-300"
              >
                Office Use Log-in
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-20 flex flex-col justify-center relative z-10">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-[11px] font-semibold text-slate-300 mb-8 uppercase tracking-widest">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-ping"></span>
            Official Corporate Gateway
          </div>
          
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-slate-100 leading-none">
            Integrated Digital <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 filter drop-shadow-[0_2px_10px_rgba(245,158,11,0.15)]">
              Business Platform
            </span>
          </h1>
          
          <p className="mt-8 text-base sm:text-lg text-slate-300 font-normal leading-relaxed max-w-xl">
            This gateway provides centralized access to internal management portals for S.N. Polymers manufacturing formulation pipelines, logistics controls, and government infrastructure projects.
          </p>

          <div className="mt-12 flex items-center gap-4">
            <Link
              to="/login"
              className="px-8 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-white text-slate-950 hover:bg-slate-100 hover:shadow-[0_8px_30px_rgba(255,255,255,0.15)] transition-all duration-300 transform hover:-translate-y-0.5"
            >
              Sign In to Office Console
            </Link>
          </div>
        </div>

        {/* Feature Division Information */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-white/5 pt-12">
          <div className="glass-panel glass-card-hover p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <svg className="w-20 h-20 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h4 className="text-xs uppercase tracking-wider font-extrabold text-amber-500">Manufacturing Division</h4>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed font-normal">Chemical formulations, raw materials procurement, internal stock auditing, and batch control systems.</p>
          </div>

          <div className="glass-panel glass-card-hover p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <svg className="w-20 h-20 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h4 className="text-xs uppercase tracking-wider font-extrabold text-amber-500">Government Infrastructure Projects</h4>
            <p className="mt-3 text-sm text-slate-300 leading-relaxed font-normal">Tender tracking, logistics dispatching reports, work order scheduling, and municipal compliance management.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-black/80 py-8 text-center text-xs text-slate-400 font-medium z-10">
        <p>&copy; {new Date().getFullYear()} S.N. Polymers. All access logged and audited. Authorized internal personnel only.</p>
      </footer>
    </div>
  );
};

export default Home;
