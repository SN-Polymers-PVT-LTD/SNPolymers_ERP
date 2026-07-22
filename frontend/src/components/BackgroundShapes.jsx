import React from 'react';
import { useTheme } from './ThemeContext';

const BackgroundShapes = () => {
  const { theme, darkBg, lightBg } = useTheme();

  // Check if current active background is the rotating SVG overlay preset
  const isRotatingSvgActive = theme === 'dark'
    ? darkBg === 'rotating-svg-dark'
    : lightBg === 'rotating-svg-light';

  const isSunlightActive = theme === 'dark' ? darkBg === 'warm-sunlight' : lightBg === 'warm-sunlight';
  const isIndigoAuroraActive = theme === 'dark' ? darkBg === 'radial-indigo' : lightBg === 'radial-soft';
  const isTropicalBeachActive = theme === 'dark' ? darkBg === 'tropical-beach' : lightBg === 'tropical-beach';

  return (
    <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none select-none z-0">
      {/* 00. Tropical Beach — Ambient Fluid Ocean & Golden Sand Wave Flow */}
      {isTropicalBeachActive && (
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-80 overflow-hidden">
          <svg className="w-full h-full" viewBox="0 0 1440 900" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              {/* Cyan Lagoon to Emerald Fluid Wave Gradient */}
              <linearGradient id="tropLagoonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(6, 182, 212, 0.22)" />
                <stop offset="50%" stopColor="rgba(20, 184, 166, 0.16)" />
                <stop offset="100%" stopColor="rgba(56, 189, 248, 0.08)" />
              </linearGradient>

              {/* Warm Golden Sunlight Reflection Gradient */}
              <linearGradient id="tropSandGlowGrad" x1="100%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="rgba(251, 191, 36, 0.22)" />
                <stop offset="40%" stopColor="rgba(245, 158, 11, 0.12)" />
                <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
              </linearGradient>
            </defs>

            {/* Upper Sky Cyan Horizon Fluid Contour */}
            <path
              d="M-100,-50 C300,120 700,-30 1100,100 C1300,165 1500,80 1600,-50 Z"
              fill="url(#tropLagoonGrad)"
            />

            {/* Bottom-Right Warm Golden Beach Light Aura */}
            <path
              d="M1600,950 C1200,750 800,920 400,800 C200,740 0,820 -100,950 Z"
              fill="url(#tropSandGlowGrad)"
            />

            {/* Delicate Flowing Contour Waves */}
            <path
              d="M -50,180 C 400,320 900,150 1500,280"
              fill="none"
              stroke="rgba(6, 182, 212, 0.28)"
              strokeWidth="2"
            />
            <path
              d="M -50,220 C 450,360 850,200 1500,320"
              fill="none"
              stroke="rgba(20, 184, 166, 0.20)"
              strokeWidth="1.5"
              strokeDasharray="12 8"
            />
          </svg>
        </div>
      )}
      {/* 0A. Vibrant Oceanic Fluid Waves (Default Light Mode) */}

      {isIndigoAuroraActive && (
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-90 overflow-hidden">
          <svg className="w-full h-full" viewBox="0 0 1440 900" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              {/* Oceanic Sky Blue to Cyan Gradient */}
              <linearGradient id="waveGradOceanSky" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(14, 165, 233, 0.42)" />
                <stop offset="50%" stopColor="rgba(56, 189, 248, 0.24)" />
                <stop offset="100%" stopColor="rgba(186, 230, 253, 0.05)" />
              </linearGradient>

              {/* Deep Sea Azure Gradient */}
              <linearGradient id="waveGradDeepAzure" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(2, 132, 199, 0.38)" />
                <stop offset="60%" stopColor="rgba(14, 165, 233, 0.20)" />
                <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
              </linearGradient>

              {/* Turquoise Aqua Foam Gradient */}
              <linearGradient id="waveGradTurquoise" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(6, 182, 212, 0.32)" />
                <stop offset="70%" stopColor="rgba(45, 212, 191, 0.15)" />
                <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
              </linearGradient>
            </defs>

            {/* Layer 1: Deep Azure Ocean Wave */}
            <path
              d="M 0,280 C 320,120 540,420 900,240 C 1180,100 1340,320 1440,200 L 1440,0 L 0,0 Z"
              fill="url(#waveGradDeepAzure)"
            />

            {/* Layer 2: Main Sky Blue Fluid Wave */}
            <path
              d="M 0,480 C 380,320 650,560 1020,380 C 1260,260 1380,440 1440,360 L 1440,0 L 0,0 Z"
              fill="url(#waveGradOceanSky)"
            />

            {/* Layer 3: Turquoise Aqua Accent Wave */}
            <path
              d="M 0,600 C 420,440 700,680 1100,480 C 1300,380 1400,520 1440,460 L 1440,0 L 0,0 Z"
              fill="url(#waveGradTurquoise)"
            />

            {/* Layer 4: Oceanic Wave Crest Contour Ribbons */}
            <path
              d="M 0,180 Q 380,480 760,240 T 1440,420"
              fill="none"
              stroke="rgba(2, 132, 199, 0.55)"
              strokeWidth="3.5"
              strokeDasharray="14 10"
            />
            <path
              d="M 0,320 Q 480,140 960,380 T 1440,200"
              fill="none"
              stroke="rgba(14, 165, 233, 0.50)"
              strokeWidth="2.5"
            />
            <path
              d="M 0,440 C 400,280 700,520 1050,340 C 1280,220 1400,380 1440,300"
              fill="none"
              stroke="rgba(6, 182, 212, 0.50)"
              strokeWidth="3"
            />
          </svg>
        </div>
      )}
      {/* 0. Expanding Crisp White Glistening Sunlight Beams (Originating from Top-Right Diagonal) */}
      {isSunlightActive && (
        <div className="absolute top-0 right-0 w-full h-full pointer-events-none opacity-85 overflow-hidden">
          <svg className="w-full h-full" viewBox="0 0 1000 1000" preserveAspectRatio="xMaxYMin slice">
            <defs>
              {/* Crisp White Ray Gradient */}
              <linearGradient id="whiteSunRayGrad" x1="100%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.75)" />
                <stop offset="35%" stopColor="rgba(255, 255, 255, 0.35)" />
                <stop offset="70%" stopColor="rgba(251, 191, 36, 0.12)" />
                <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
              </linearGradient>

              {/* Luminous Pure White Sun Core Glow */}
              <radialGradient id="pureWhiteSunSource" cx="100%" cy="0%" r="50%">
                <stop offset="0%" stopColor="rgba(255, 255, 255, 0.95)" />
                <stop offset="25%" stopColor="rgba(254, 240, 138, 0.60)" />
                <stop offset="60%" stopColor="rgba(251, 191, 36, 0.20)" />
                <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
              </radialGradient>
            </defs>

            {/* Intense White Glistening Sun Source at Top-Right */}
            <circle cx="980" cy="-20" r="280" fill="url(#pureWhiteSunSource)" />

            {/* Crisp Diagonal Glistening White Sunlight Rays */}
            <g fill="url(#whiteSunRayGrad)" className="animate-[pulse_5s_ease-in-out_infinite]" style={{ filter: 'blur(4px)' }}>
              {/* Broad luminous white ambient diagonal shaft */}
              <polygon points="980,-20 -150,550 -150,900" opacity="0.45" />

              {/* Distinct Glistening Pure White Ray Shafts */}
              <polygon points="980,-20 -80,300 -20,360" />
              <polygon points="980,-20 80,580 180,660" />
              <polygon points="980,-20 320,780 430,880" />
              <polygon points="980,-20 520,950 620,1000" />
              <polygon points="980,-20 740,1000 820,1000" />
            </g>
          </svg>
        </div>
      )}

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
          className={`absolute inset-0 w-full h-full pointer-events-none ${theme === 'light' ? 'text-indigo-950/20' : 'text-white/20'
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

          {/* Bottom-Left Industrial CAD Working Pipe & Valve Assembly Blueprint */}
          <g className="opacity-65" transform="translate(-60, -220)">
            {/* Main Horizontal & Vertical Polymer Pipe Run */}
            <path
              d="M 50,920 L 220,920 Q 250,920 250,890 L 250,720 Q 250,690 280,690 L 450,690"
              fill="none"
              stroke="currentColor"
              strokeWidth="16"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.12"
            />
            <path
              d="M 50,920 L 220,920 Q 250,920 250,890 L 250,720 Q 250,690 280,690 L 450,690"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Parallel CAD Outer Diameter Boundary Lines */}
            <path
              d="M 50,912 L 215,912 Q 242,912 242,885 L 242,725 Q 242,698 275,698 L 450,698"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.75"
              strokeDasharray="4 2"
            />
            <path
              d="M 50,928 L 225,928 Q 258,928 258,895 L 258,715 Q 258,682 285,682 L 450,682"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.75"
              strokeDasharray="4 2"
            />

            {/* Animated Fluid Flow Centerline Telemetry */}
            <path
              d="M 50,920 L 220,920 Q 250,920 250,890 L 250,720 Q 250,690 280,690 L 450,690"
              fill="none"
              stroke="rgba(245, 158, 11, 0.6)"
              strokeWidth="2"
              strokeDasharray="8 12"
              className="animate-[dash_15s_linear_infinite]"
            />

            {/* Pipe Connection Flanges */}
            {/* Flange 1 (Horizontal Start) */}
            <rect x="110" y="908" width="8" height="24" rx="2" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="1" />
            <line x1="114" y1="904" x2="114" y2="936" stroke="currentColor" strokeWidth="0.75" />

            {/* Flange 2 (Vertical Midpoint) */}
            <rect x="238" y="800" width="24" height="8" rx="2" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="1" />
            <line x1="234" y1="804" x2="266" y2="804" stroke="currentColor" strokeWidth="0.75" />

            {/* Flange 3 (Horizontal End) */}
            <rect x="380" y="678" width="8" height="24" rx="2" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="1" />
            <line x1="384" y1="674" x2="384" y2="706" stroke="currentColor" strokeWidth="0.75" />

            {/* Gate Valve Wheel Assembly on Vertical Pipe */}
            <g transform="translate(250, 750)">
              {/* Valve Bonnet & Stem */}
              <line x1="0" y1="0" x2="-35" y2="0" stroke="currentColor" strokeWidth="2" />
              {/* Valve Handwheel Circle */}
              <circle cx="-42" cy="0" r="16" fill="rgba(99, 102, 241, 0.08)" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="-42" cy="0" r="4" fill="currentColor" />
              <line x1="-58" y1="0" x2="-26" y2="0" stroke="currentColor" strokeWidth="0.75" />
              <line x1="-42" y1="-16" x2="-42" y2="16" stroke="currentColor" strokeWidth="0.75" />
              {/* Valve Body Hourglass Triangle Silhouette */}
              <polygon points="-8,-10 -8,10 8,0" fill="currentColor" opacity="0.4" />
              <polygon points="8,-10 8,10 -8,0" fill="currentColor" opacity="0.4" />
            </g>

            {/* Digital Pressure Gauge Telemetry Node */}
            <g transform="translate(160, 920)">
              <line x1="0" y1="0" x2="0" y2="-28" stroke="currentColor" strokeWidth="1" />
              <circle cx="0" cy="-42" r="14" fill="rgba(15, 23, 42, 0.8)" stroke="currentColor" strokeWidth="1.2" />
              <path d="M 0,-42 L 7,-49" stroke="rgba(245, 158, 11, 0.9)" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="0" cy="-42" r="2" fill="currentColor" />
              <text x="0" y="-22" textAnchor="middle" fill="currentColor" fontSize="7" fontWeight="bold" fontFamily="monospace">6.4 BAR</text>
            </g>

            {/* Fluid Flow Direction Arrows */}
            <path d="M 80,920 L 72,916 L 72,924 Z" fill="currentColor" />
            <path d="M 330,690 L 322,686 L 322,694 Z" fill="currentColor" />
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