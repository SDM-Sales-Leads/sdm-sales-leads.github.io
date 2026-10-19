import React, { createContext, useContext, useEffect, useState } from 'react';
import { setBasePx } from '../lib/textSize';
import { SystemSettings } from '../types';
import { settingsService } from '../services/settingsService';
import { useAuth } from './AuthContext';

interface ThemeContextType {
  settings: SystemSettings;
  updateSettings: (newSettings: SystemSettings) => Promise<void>;
  isLoading: boolean;
}

const defaultSettings: SystemSettings = {
  theme: 'glass',
  primaryColor: '#A6192E',
  backgroundColor: '#F2F2F2',
  effectColor: '#A6192E',
  fontFamily: 'Inter',
  fontSize: 'sm',
  backgroundEffect: 'all',
  gridPattern: 'lines',
  particleShape: 'circle',
  backgroundIntensity: 50,
  borderRadius: 'xl',
  glassIntensity: 70,
  animationSpeed: 'normal'
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [settings, setSettings] = useState<SystemSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // look & feel changes only when an administrator saves it (the page then updates itself): no refresh on focus
    loadSettings();
  }, []);

  const isLoadingSettings = React.useRef(false);
  const loadSettings = async (retryCount = 0) => {
    if (isLoadingSettings.current && retryCount === 0) return;
    isLoadingSettings.current = true;
    try {
      const data = await settingsService.getSettings();
      // Merge with defaults to handle missing fields from old DB versions
      const merged = { ...defaultSettings, ...data };
      setSettings(merged);
      applyTheme(merged);
    } catch (err: any) {
      console.warn('❌ Failed to load theme settings:', err.message || err);
      if (retryCount < 2) {
        const delay = 2000 * (retryCount + 1);
        console.log(`🔄 Retrying theme settings load in ${delay}ms (attempt ${retryCount + 1})...`);
        setTimeout(() => loadSettings(retryCount + 1), delay);
      } else {
        console.warn('All retries failed, using default theme settings');
        setSettings(defaultSettings);
      }
    } finally {
      isLoadingSettings.current = false;
      setIsLoading(false);
    }
  };

  const applyTheme = (s: SystemSettings) => {
    const root = document.documentElement;
    
    // Apply Primary Color
    root.style.setProperty('--color-brand-red', s.primaryColor);
    
    // Apply Background Color
    root.style.setProperty('--color-brand-light', s.backgroundColor);
    
    // Apply Effect Color
    root.style.setProperty('--color-effect', s.effectColor);
    
    // Apply Font Family
    root.style.setProperty('--font-sans', s.fontFamily === 'Inter' ? '"Inter", ui-sans-serif, system-ui, sans-serif' : 
                                         s.fontFamily === 'Roboto' ? '"Roboto", sans-serif' :
                                         s.fontFamily === 'JetBrains Mono' ? '"JetBrains Mono", monospace' :
                                         '"Playfair Display", serif');

    // Apply Font Size Base
    const sizeMap = { xs: '12px', sm: '14px', base: '16px', lg: '18px', xl: '20px' };
    setBasePx(parseInt(sizeMap[s.fontSize], 10) || 14);

    // Apply Border Radius
    const radiusMap = { none: '0px', md: '0.375rem', xl: '0.75rem', '2xl': '1rem', full: '9999px' };
    root.style.setProperty('--radius-2xl', radiusMap[s.borderRadius]);

    // Apply Theme Mode (Dark/Light/Glass)
    if (s.theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('glass-mode');
      root.style.setProperty('--color-brand-black', s.backgroundColor); // In dark mode, background color is the dark color
    } else if (s.theme === 'glass') {
      root.classList.remove('dark');
      root.classList.add('glass-mode');
      root.style.setProperty('--color-brand-black', '#2D2926');
    } else {
      root.classList.remove('dark', 'glass-mode');
      root.style.setProperty('--color-brand-black', '#2D2926');
    }

    // Glass Intensity
    root.style.setProperty('--glass-opacity', (s.glassIntensity / 100).toString());
  };

  const updateSettings = async (newSettings: SystemSettings) => {
    await settingsService.updateSettings(newSettings, user?.id.toString(), user?.name);
    setSettings(newSettings);
    applyTheme(newSettings);
  };

  return (
    <ThemeContext.Provider value={{ settings, updateSettings, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
