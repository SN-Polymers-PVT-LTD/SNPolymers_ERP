import React from 'react';

const BackgroundShapes = () => {
  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0">
      {/* 1. Large Ambient Blurs (Depth Glows) */}
      <div className="absolute top-[-10%] left-[-10%] w-[50rem] h-[50rem] rounded-full bg-indigo-500/10 blur-[150px] animate-pulse pointer-events-none" style={{ animationDuration: '12s' }}></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[45rem] h-[45rem] rounded-full bg-amber-500/5 blur-[130px] animate-pulse pointer-events-none" style={{ animationDuration: '18s' }}></div>
      <div className="absolute top-[30%] right-[20%] w-[35rem] h-[35rem] rounded-full bg-indigo-600/5 blur-[140px] animate-pulse pointer-events-none" style={{ animationDuration: '15s' }}></div>

      {/* 2. Tech Grid Pattern Overlay */}
      <div className="absolute inset-0 opacity-[0.02] pointer-events-none" style={{ 
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)', 
        backgroundSize: '32px 32px' 
      }}></div>

      {/* 3. Top Right Corner Concentric Rings and Polymer Hexagon (Only SVG Shape Retained) */}
      <svg className="absolute w-[800px] h-[800px] text-white pointer-events-none" style={{ left: '80%', top: '20%', transform: 'translate(-50%, -50%)' }} viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
        <g className="opacity-[0.14] origin-[400px_400px] animate-[spin_100s_linear_infinite]" style={{ transformOrigin: '400px 400px' }}>
          <circle cx="400" cy="400" r="180" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
          <circle cx="400" cy="400" r="240" fill="none" stroke="currentColor" strokeWidth="0.75" />
          <circle cx="400" cy="400" r="320" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="12 6" />
          
          {/* Hexagonal structural silhouette */}
          <polygon 
            points="
              400,300 
              486.6,350 
              486.6,450 
              400,500 
              313.4,450 
              313.4,350
            " 
            fill="rgba(99, 102, 241, 0.05)" 
            stroke="currentColor" 
            strokeWidth="1.5" 
          />
          <line x1="400" y1="400" x2="400" y2="300" stroke="currentColor" strokeWidth="1" />
          <line x1="400" y1="400" x2="486.6" y2="350" stroke="currentColor" strokeWidth="1" />
          <line x1="400" y1="400" x2="486.6" y2="450" stroke="currentColor" strokeWidth="1" />
          <line x1="400" y1="400" x2="400" y2="500" stroke="currentColor" strokeWidth="1" />
          <line x1="400" y1="400" x2="313.4" y2="450" stroke="currentColor" strokeWidth="1" />
          <line x1="400" y1="400" x2="313.4" y2="350" stroke="currentColor" strokeWidth="1" />
        </g>
      </svg>

      {/* Decorative Solid Gradient Silhouette shapes blurred behind glass */}
      <div className="absolute top-[35%] left-[15%] w-[12rem] h-[12rem] bg-indigo-500/10 rounded-[30%_70%_70%_30%_/_30%_30%_70%_70%] pointer-events-none opacity-30 blur-[40px] animate-[pulse_8s_ease-in-out_infinite]"></div>
      <div className="absolute bottom-[25%] right-[25%] w-[15rem] h-[15rem] bg-amber-500/5 rounded-[60%_40%_30%_70%_/_60%_30%_70%_40%] pointer-events-none opacity-20 blur-[50px] animate-[pulse_10s_ease-in-out_infinite]"></div>
    </div>
  );
};

export default BackgroundShapes;
