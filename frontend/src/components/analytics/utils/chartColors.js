// Shared SVG theme-aware color tokens hook for HO and ZO chart primitives.
import { useTheme } from '../../ThemeContext';

export const useChartColors = () => {
  const { isDark } = useTheme();
  return {
    gridLine: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)',
    gridLineDash: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    axisLine: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)',
    labelMuted: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.35)',
    labelFaint: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
    labelNormal: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)',
    labelStrong: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.8)',
    todayLine: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
    todayText: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)',
    quadrantNormal: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    quadrantCritical: isDark ? 'rgba(239,68,68,0.4)' : 'rgba(185,28,28,0.5)',
    cellBorder: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)',
    highChurnLabel: isDark ? '#ef4444' : '#b91c1c',
    normalLabel: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)',
    dropOffConnector: isDark ? 'rgba(239,68,68,0.25)' : 'rgba(185,28,28,0.3)',
    isDark,
  };
};
