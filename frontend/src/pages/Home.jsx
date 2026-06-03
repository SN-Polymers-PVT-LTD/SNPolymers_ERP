import React from 'react';
import { useAuth } from '../components/AuthContext';
import { Link } from 'react-router-dom';

const Home = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-admin-bg text-slate-100 flex flex-col font-sans">
      {/* Header Bar */}
      <header className="border-b border-admin-border/80 bg-admin-bg/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <img src="/assets/logo.png" alt="S.N. Polymers Logo" className="h-10 w-auto object-contain" />
            <div className="flex flex-col">
              <span className="font-bold text-sm tracking-wider text-slate-100 uppercase">
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
                className="px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-slate-100 border border-amber-500/30 transition duration-150"
              >
                Console Dashboard
              </Link>
            ) : (
              <Link
                to="/login"
                id="office-use-btn"
                className="px-4 py-1.5 rounded text-xs font-bold uppercase tracking-wider border border-slate-600 hover:border-slate-400 text-slate-200 hover:text-slate-100 transition duration-150"
              >
                Office Use Log-in
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-grow max-w-7xl mx-auto w-full px-6 py-24 flex flex-col justify-center">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 mb-6 uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-amber-600"></span>
            Official Corporate Gateway
          </div>
          
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-100 leading-none">
            Integrated Digital <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600">
              Business Platform
            </span>
          </h1>
          
          <p className="mt-6 text-base text-slate-300 font-medium leading-relaxed max-w-xl">
            This gateway provides centralized access to internal management portals for S.N. Polymers manufacturing formulation pipelines, logistics controls, and government infrastructure projects.
          </p>

          <div className="mt-10 flex items-center gap-4">
            <Link
              to="/login"
              className="px-6 py-3 rounded text-xs font-bold uppercase tracking-wider bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-600 transition duration-150"
            >
              Sign In to Office Console
            </Link>
          </div>
        </div>

        {/* Feature Division Information */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-slate-800/80 pt-12">
          <div>
            <h4 className="text-xs uppercase tracking-wider font-bold text-amber-500">Manufacturing Division</h4>
            <p className="mt-2 text-sm text-slate-300 font-medium">Chemical formulations, raw materials procurement, internal stock auditing, and batch control systems.</p>
          </div>
          <div>
            <h4 className="text-xs uppercase tracking-wider font-bold text-amber-500">Government Infrastructure Projects</h4>
            <p className="mt-2 text-sm text-slate-300 font-medium">Tender tracking, logistics dispatching reports, work order scheduling, and municipal compliance management.</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-admin-bg py-8 text-center text-xs text-slate-400 font-medium">
        <p>&copy; {new Date().getFullYear()} S.N. Polymers. All access logged and audited. Authorized internal personnel only.</p>
      </footer>
    </div>
  );
};

export default Home;
