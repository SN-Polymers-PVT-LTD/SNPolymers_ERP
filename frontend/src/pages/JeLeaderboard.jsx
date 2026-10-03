import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import authApi from '../api/authApi';
import { useAuth } from '../components/AuthContext';
import { SkeletonTable, SkeletonCard, Pagination } from '../components/ui';
import { useJeLeaderboardUrlState } from '../hooks/useJeLeaderboardUrlState';

const JeLeaderboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const {
    timeframe,
    setTimeframe,
    searchQuery,
    setSearchQuery,
    page: currentPage,
    setPage: setCurrentPage,
    pageSize,
    setPageSize,
    resetFilters
  } = useJeLeaderboardUrlState();

  const [localSearch, setLocalSearch] = useState(searchQuery);

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await authApi.get(`/analytics/je-leaderboard?timeframe=${timeframe}`);
        if (response.data?.success) {
          setLeaderboard(response.data.leaderboard || []);
        }
      } catch (err) {
        console.error('Error fetching JE leaderboard:', err);
        setError(err.response?.data?.message || 'Failed to load leaderboard metrics.');
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [timeframe]);

  const filteredLeaderboard = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return leaderboard;
    return leaderboard.filter(
      je =>
        (je.display_name && je.display_name.toLowerCase().includes(q)) ||
        (je.mobile_number && je.mobile_number.toLowerCase().includes(q))
    );
  }, [leaderboard, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredLeaderboard.length / pageSize));
  const paginatedLeaderboard = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLeaderboard.slice(start, start + pageSize);
  }, [filteredLeaderboard, currentPage, pageSize]);

  const topThree = leaderboard.slice(0, 3);

  // Position mapping for podium display (2nd, 1st, 3rd)
  const podiumOrder = [
    topThree[1] || null, // 2nd Place (Silver)
    topThree[0] || null, // 1st Place (Gold)
    topThree[2] || null  // 3rd Place (Bronze)
  ];

  const hasActiveFilters = Boolean(searchQuery || timeframe !== 'weekly');

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-fadeIn">
      {/* Header section with back navigation */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-6 border-b border-white/5">
        <div>
          <button
            onClick={() => {
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate('/daily-progress');
              }
            }}
            className="group flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-400 hover:text-amber-300 transition mb-3"
          >
            <svg className="w-4 h-4 transform group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Daily Tracking
          </button>

          <div className="flex items-center gap-3">
            <span className="text-3xl">🏆</span>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-100">
              Junior Engineer Performance Leaderboards
            </h1>
          </div>
          <p className="text-xs text-slate-400 font-medium mt-1.5">
            Recognizing field engineering excellence based on daily progress logging activity and upload streaks.
          </p>
        </div>

        {/* Timeframe Filter Switcher */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5 shrink-0 self-stretch md:self-auto">
            {[
              { id: 'weekly', label: 'Weekly' },
              { id: 'monthly', label: 'Monthly' },
              { id: 'annually', label: 'Annually' },
              { id: 'lifetime', label: 'All Time' }
            ].map((tf) => (
              <button
                key={tf.id}
                onClick={() => setTimeframe(tf.id)}
                className={`flex-grow md:flex-none px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition ${
                  timeframe === tf.id
                    ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 font-black'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => {
                setLocalSearch('');
                resetFilters();
              }}
              className="px-3.5 py-2 rounded-xl border border-white/10 hover:border-white/20 bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold uppercase tracking-wider transition-all"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonTable rows={5} columns={6} />
        </div>
      ) : leaderboard.length === 0 ? (
        <div className="glass-panel p-16 rounded-3xl text-center flex flex-col items-center justify-center border border-white/5">
          <span className="text-4xl mb-3">📋</span>
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">No Performance Data Found</h2>
          <p className="text-xs text-slate-500 mt-1">No daily progress reports logged for the selected timeframe.</p>
        </div>
      ) : (
        <>
          {/* Top 3 Podium Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
            {podiumOrder.map((je) => {
              if (!je) return null;
              const isFirst = je.rank === 1;
              const isSecond = je.rank === 2;

              return (
                <div
                  key={je.mobile_number}
                  className={`glass-panel p-6 rounded-3xl relative overflow-hidden flex flex-col items-center text-center transition-transform duration-300 hover:scale-[1.02] shadow-xl ${
                    isFirst
                      ? 'border-2 border-amber-400/60 bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent md:-translate-y-4'
                      : isSecond
                      ? 'border border-slate-300/40 bg-gradient-to-b from-slate-300/10 to-transparent'
                      : 'border border-amber-700/40 bg-gradient-to-b from-amber-700/10 to-transparent'
                  }`}
                >
                  {/* Rank badge */}
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl mb-4 shadow-lg ${
                    isFirst ? 'bg-amber-400 text-slate-950' : isSecond ? 'bg-slate-300 text-slate-950' : 'bg-amber-700 text-slate-100'
                  }`}>
                    #{je.rank}
                  </div>

                  {/* Avatar icon */}
                  <div className="w-16 h-16 rounded-full bg-white/10 border-2 border-white/10 flex items-center justify-center text-2xl font-bold text-slate-200 mb-3 shadow-inner">
                    {je.display_name?.charAt(0) || 'J'}
                  </div>

                  <h3 className="text-base font-extrabold text-slate-100 truncate w-full" title={je.display_name}>
                    {je.display_name}
                  </h3>
                  <p className="text-[10px] font-mono text-slate-400 mt-0.5">{je.mobile_number}</p>

                  {/* Key score metric */}
                  <div className="my-4 px-4 py-2 rounded-2xl bg-white/5 border border-white/10 w-full">
                    <span className="text-[9px] uppercase font-bold tracking-widest text-amber-400 block">Performance Score</span>
                    <span className="text-2xl font-black text-slate-100 font-mono">{je.score}</span>
                  </div>

                  {/* Breakdown stats */}
                  <div className="grid grid-cols-3 gap-2 text-center w-full text-[10px] pt-2 border-t border-white/5">
                    <div>
                      <span className="text-slate-500 block">Reports</span>
                      <span className="font-bold text-slate-200">{je.total_reports}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Streak</span>
                      <span className="font-bold text-orange-400">{je.daily_streak} 🔥</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Avg Prog</span>
                      <span className="font-bold text-emerald-400">{je.avg_progress}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Complete Rankings Table */}
          <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
            <div className="p-4 sm:p-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/[0.01]">
              <span className="text-xs font-extrabold uppercase tracking-widest text-slate-300">
                Full Field Rankings ({filteredLeaderboard.length} Engineers)
              </span>

              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="Search engineer..."
                  value={localSearch}
                  onChange={(e) => {
                    setLocalSearch(e.target.value);
                    setSearchQuery(e.target.value);
                  }}
                  className="px-3.5 py-1.5 rounded-xl text-xs bg-slate-950/80 border border-white/10 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 w-full sm:w-48 font-medium"
                />

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-bold uppercase">Show:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="px-2.5 py-1.5 rounded-xl text-xs bg-slate-950/80 border border-white/10 text-slate-300 focus:outline-none focus:border-amber-500/50 font-bold cursor-pointer"
                  >
                    <option value={5}>5 / pg</option>
                    <option value={10}>10 / pg</option>
                    <option value={20}>20 / pg</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-white/[0.02] text-slate-400 text-[10px] uppercase font-bold tracking-wider border-b border-white/5">
                  <tr>
                    <th className="p-4 w-16 text-center">Rank</th>
                    <th className="p-4">Junior Engineer</th>
                    <th className="p-4 text-center">Active Streak</th>
                    <th className="p-4 text-center">Daily Logs</th>
                    <th className="p-4 text-center">Approved Logs</th>
                    <th className="p-4 text-center">Avg Progress %</th>
                    <th className="p-4 text-right pr-6">Score Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paginatedLeaderboard.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-500 italic">
                        No engineers matching search query
                      </td>
                    </tr>
                  ) : (
                    paginatedLeaderboard.map((je) => (
                      <tr
                        key={je.mobile_number}
                        className={`hover:bg-white/[0.02] transition ${
                          user?.mobile_number === je.mobile_number ? 'bg-amber-500/10 border-l-4 border-l-amber-500' : ''
                        }`}
                      >
                        <td className="p-4 text-center font-mono font-bold text-slate-400">
                          #{je.rank}
                        </td>
                        <td className="p-4">
                          <div className="font-bold text-slate-200">{je.display_name}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{je.mobile_number}</div>
                        </td>
                        <td className="p-4 text-center font-mono font-bold text-orange-400">
                          {je.daily_streak} Days 🔥
                        </td>
                        <td className="p-4 text-center font-mono font-bold text-slate-300">
                          {je.total_reports}
                        </td>
                        <td className="p-4 text-center font-mono font-bold text-emerald-400">
                          {je.approved_reports}
                        </td>
                        <td className="p-4 text-center font-mono font-bold text-sky-400">
                          {je.avg_progress}%
                        </td>
                        <td className="p-4 text-right pr-6 font-mono font-extrabold text-amber-400 text-sm">
                          {je.score}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls Footer */}
            {totalPages > 1 && (
              <div className="p-4 border-t border-white/5 bg-white/[0.01] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs select-none">
                <span className="text-slate-400 font-bold">
                  Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, filteredLeaderboard.length)} of {filteredLeaderboard.length} Engineers (Page {currentPage} of {totalPages})
                </span>
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                  maxVisible={5}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default JeLeaderboard;
