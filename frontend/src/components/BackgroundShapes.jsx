import React from 'react';
import { useTheme } from './ThemeContext';

const BackgroundShapes = () => {
  const { theme, darkBg, lightBg } = useTheme();

  // Check if current active background is the rotating SVG overlay preset
  const isRotatingSvgActive = theme === 'dark' 
    ? darkBg === 'rotating-svg-dark' 
    : lightBg === 'rotating-svg-light';

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0">
      {/* 1. Large Ambient Blurs (Depth Glows) */}
      <div className="absolute top-[-10%] left-[-10%] w-[50rem] h-[50rem] rounded-full bg-indigo-500/10 blur-[150px] animate-pulse pointer-events-none" style={{ animationDuration: '12s' }}></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[45rem] h-[45rem] rounded-full bg-amber-500/5 blur-[130px] animate-pulse pointer-events-none" style={{ animationDuration: '18s' }}></div>
      <div className="absolute top-[30%] right-[20%] w-[35rem] h-[35rem] rounded-full bg-indigo-600/5 blur-[140px] animate-pulse pointer-events-none" style={{ animationDuration: '15s' }}></div>

      {/* 2. Tech Grid Pattern Overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ 
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.2) 1px, transparent 1px)', 
        backgroundSize: '32px 32px' 
      }}></div>

      {/* 3. Rotating SVG Vector Shapes — Render ONLY when selected in User Profile */}
      {isRotatingSvgActive && (
        <svg 
          className={`absolute inset-0 w-full h-full pointer-events-none ${
            theme === 'light' ? 'text-indigo-950/20' : 'text-white/20'
          }`} 
          viewBox="0 0 1000 1000"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Concentric Rings and Polymer Hexagon (Rightside 80% X, 35% Y) */}
          <g className="opacity-75 animate-[spin_100s_linear_infinite]" style={{ transformOrigin: '800px 350px' }}>
            <circle cx="800" cy="350" r="90" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx="800" cy="350" r="130" fill="none" stroke="currentColor" strokeWidth="0.75" />
            <circle cx="800" cy="350" r="170" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="8 4" />

            {/* Hexagonal structural silhouette */}
            <polygon
              points="800,300 843,325 843,375 800,400 757,375 757,325"
              fill="rgba(99, 102, 241, 0.05)"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <line x1="800" y1="350" x2="800" y2="300" stroke="currentColor" strokeWidth="0.75" />
            <line x1="800" y1="350" x2="843" y2="325" stroke="currentColor" strokeWidth="0.75" />
            <line x1="800" y1="350" x2="843" y2="375" stroke="currentColor" strokeWidth="0.75" />
            <line x1="800" y1="350" x2="800" y2="400" stroke="currentColor" strokeWidth="0.75" />
            <line x1="800" y1="350" x2="757" y2="375" stroke="currentColor" strokeWidth="0.75" />
            <line x1="800" y1="350" x2="757" y2="325" stroke="currentColor" strokeWidth="0.75" />
          </g>
        </svg>
      )}

      {/* Decorative Solid Gradient Silhouette shapes blurred behind glass */}
      <div className="absolute top-[35%] left-[15%] w-[12rem] h-[12rem] bg-indigo-500/10 rounded-[30%_70%_70%_30%_/_30%_30%_70%_70%] pointer-events-none opacity-30 blur-[40px] animate-[pulse_8s_ease-in-out_infinite]"></div>
      <div className="absolute bottom-[25%] right-[25%] w-[15rem] h-[15rem] bg-amber-500/5 rounded-[60%_40%_30%_70%_/_60%_30%_70%_40%] pointer-events-none opacity-20 blur-[50px] animate-[pulse_10s_ease-in-out_infinite]"></div>
    </div>
  );
};

export default BackgroundShapes;
