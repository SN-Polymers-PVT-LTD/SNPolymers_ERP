import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const DARK_BACKGROUNDS = [
  { id: 'radial-indigo', name: 'Radial Glow (Default Dark)', style: 'radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.08) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(245, 158, 11, 0.04) 0px, transparent 50%)' },
  { id: 'rotating-svg-dark', name: 'Rotating SVG Vector & CAD Blueprint', url: '/dark-blueprint.svg', style: "url('/dark-blueprint.svg')" },
  { id: 'image-dark', name: 'Blueprint & Arc Overlay (Image)', url: '/darkmode_background.png', style: "url('/darkmode_background.png')" },
  { id: 'pure-black', name: 'Deep Midnight Black', style: 'none', bgColor: '#000000' },
  { id: 'cyber-mesh', name: 'Cyber Neon Gradient', style: 'radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.25), transparent 70%), radial-gradient(circle at 0% 100%, rgba(236, 72, 153, 0.15), transparent 60%)' },
];

export const LIGHT_BACKGROUNDS = [
  { id: 'radial-soft', name: 'Subtle Indigo Gradient (Default Light)', style: 'radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.04) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(245, 158, 11, 0.03) 0px, transparent 50%)' },
  { id: 'rotating-svg-light', name: 'Rotating SVG Vector & CAD Blueprint', url: '/light-blueprint.svg', style: "url('/light-blueprint.svg')" },
  { id: 'image-light', name: 'Light Tech Arc Overlay (Image)', url: '/lightmode_background.png', style: "url('/lightmode_background.png')" },
  { id: 'clean-slate', name: 'Minimal Soft Slate', style: 'none', bgColor: '#f8fafc' },
  { id: 'warm-sunlight', name: 'Warm Amber Gradient', style: 'radial-gradient(at 100% 0%, rgba(245, 158, 11, 0.08) 0px, transparent 50%), radial-gradient(at 0% 100%, rgba(99, 102, 241, 0.05) 0px, transparent 50%)' },
];

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('app-theme') || 'light';
  });

  const [darkBg, setDarkBg] = useState(() => {
    return localStorage.getItem('app-dark-bg') || 'image-dark';
  });

  const [lightBg, setLightBg] = useState(() => {
    return localStorage.getItem('app-light-bg') || 'image-light';
  });

  useEffect(() => {
    const body = document.body;
    if (theme === 'light') {
      body.classList.add('light');
      body.classList.remove('dark');
      const bgObj = LIGHT_BACKGROUNDS.find(b => b.id === lightBg) || LIGHT_BACKGROUNDS[0];
      if (bgObj.url) {
        body.style.backgroundImage = `url("${bgObj.url}")`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
        body.style.backgroundRepeat = 'no-repeat';
      } else {
        body.style.backgroundImage = bgObj.style;
        body.style.backgroundSize = '';
        body.style.backgroundPosition = '';
        body.style.backgroundRepeat = '';
      }
      if (bgObj.bgColor) {
        body.style.backgroundColor = bgObj.bgColor;
      } else {
        body.style.backgroundColor = '#f8fafc';
      }
    } else {
      body.classList.add('dark');
      body.classList.remove('light');
      const bgObj = DARK_BACKGROUNDS.find(b => b.id === darkBg) || DARK_BACKGROUNDS[0];
      if (bgObj.url) {
        body.style.backgroundImage = `url("${bgObj.url}")`;
        body.style.backgroundSize = 'cover';
        body.style.backgroundPosition = 'center';
        body.style.backgroundRepeat = 'no-repeat';
      } else {
        body.style.backgroundImage = bgObj.style;
        body.style.backgroundSize = '';
        body.style.backgroundPosition = '';
        body.style.backgroundRepeat = '';
      }
      if (bgObj.bgColor) {
        body.style.backgroundColor = bgObj.bgColor;
      } else {
        body.style.backgroundColor = '#050810';
      }
    }
    localStorage.setItem('app-theme', theme);
    localStorage.setItem('app-dark-bg', darkBg);
    localStorage.setItem('app-light-bg', lightBg);
  }, [theme, darkBg, lightBg]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ 
      theme, 
      toggleTheme, 
      isDark: theme === 'dark',
      darkBg,
      setDarkBg,
      lightBg,
      setLightBg,
      DARK_BACKGROUNDS,
      LIGHT_BACKGROUNDS
    }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
