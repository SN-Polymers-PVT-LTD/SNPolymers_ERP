import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const DARK_BACKGROUNDS = [
  { id: 'radial-indigo', name: 'Oceanic Wave Flow (Default Dark)', style: 'radial-gradient(ellipse 90% 60% at 10% -10%, rgba(14, 165, 233, 0.18), transparent 60%), radial-gradient(circle at 90% 20%, rgba(6, 182, 212, 0.14), transparent 50%), radial-gradient(circle at 50% 90%, rgba(99, 102, 241, 0.12), transparent 60%)' },
  { id: 'tropical-beach', name: 'Tropical Beach Horizon 🏝️', style: 'radial-gradient(circle at 95% 15%, rgba(16, 185, 129, 0.18), transparent 55%), radial-gradient(ellipse 90% 60% at 40% -10%, rgba(6, 182, 212, 0.18), transparent 70%), radial-gradient(circle at 10% 20%, rgba(14, 165, 233, 0.15), transparent 50%), radial-gradient(circle at 90% 85%, rgba(245, 158, 11, 0.15), transparent 50%), linear-gradient(180deg, #07111e 0%, #050d1a 50%, #17150c 100%)', bgColor: '#050d1a' },
  { id: 'rotating-svg-dark', name: 'Rotating SVG Vector & CAD Blueprint', url: '/dark-blueprint.svg', style: "url('/dark-blueprint.svg')" },
  { id: 'image-dark', name: 'Light Tech Arc Overlay (Image)', url: '/darkmode_background.png', style: "url('/darkmode_background.png')" },
  { id: 'pure-black', name: 'Minimal Deep Black', style: 'none', bgColor: '#000000' },
  { id: 'warm-sunlight', name: 'Glistening Sunlight Ray', style: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(251, 191, 36, 0.20), transparent), radial-gradient(circle at 85% 10%, rgba(245, 158, 11, 0.14), transparent 45%), radial-gradient(circle at 15% 30%, rgba(245, 158, 11, 0.10), transparent 50%)' },
];

export const LIGHT_BACKGROUNDS = [
  { id: 'radial-soft', name: 'Oceanic Wave Flow (Default Light)', style: 'radial-gradient(ellipse 90% 60% at 10% -10%, rgba(14, 165, 233, 0.14), transparent 60%), radial-gradient(circle at 90% 20%, rgba(6, 182, 212, 0.10), transparent 50%), radial-gradient(circle at 50% 90%, rgba(99, 102, 241, 0.05), transparent 60%)' },
  { id: 'tropical-beach', name: 'Tropical Beach Horizon 🏝️', style: 'radial-gradient(circle at 95% 15%, rgba(16, 185, 129, 0.22), transparent 55%), radial-gradient(ellipse 90% 60% at 40% -10%, rgba(6, 182, 212, 0.22), transparent 70%), radial-gradient(circle at 10% 20%, rgba(14, 165, 233, 0.18), transparent 50%), radial-gradient(circle at 90% 85%, rgba(251, 191, 36, 0.18), transparent 50%), linear-gradient(180deg, #f0f9ff 0%, #e0f2fe 50%, #fef3c7 100%)', bgColor: '#e0f2fe' },
  { id: 'rotating-svg-light', name: 'Rotating SVG Vector & CAD Blueprint', url: '/light-blueprint.svg', style: "url('/light-blueprint.svg')" },
  { id: 'image-light', name: 'Light Tech Arc Overlay (Image)', url: '/lightmode_background.png', style: "url('/lightmode_background.png')" },
  { id: 'clean-slate', name: 'Minimal Soft Slate', style: 'none', bgColor: '#f8fafc' },
  { id: 'warm-sunlight', name: 'Glistening Sunlight Ray', style: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(251, 191, 36, 0.28), rgba(255, 255, 255, 0)), radial-gradient(circle at 85% 10%, rgba(245, 158, 11, 0.18), transparent 45%), radial-gradient(circle at 15% 30%, rgba(253, 230, 138, 0.22), transparent 50%)' },
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
