import React, { useEffect, useMemo } from 'react';
import { motion, useSpring, useMotionValue, useTransform } from 'motion/react';
import { useTheme } from '../services/ThemeContext';
import { useLight, isLight } from '../lib/lightMode';

export const AnimatedBackground: React.FC = () => {
  const { settings } = useTheme();
  const light = useLight();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Smooth out the mouse movement
  const springConfig = { damping: 20, stiffness: 100 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  // Map mouse position to a movement range - HOOKS AT TOP LEVEL
  const orb1X = useTransform(smoothX, [0, 1920], [-150, 150]);
  const orb1Y = useTransform(smoothY, [0, 1080], [-150, 150]);
  
  const orb2X = useTransform(smoothX, [0, 1920], [150, -150]);
  const orb2Y = useTransform(smoothY, [0, 1080], [150, -150]);

  const gridX = useTransform(smoothX, [0, 1920], [-30, 30]);
  const gridY = useTransform(smoothY, [0, 1080], [-30, 30]);

  // Particle parallax tiers to avoid hooks in loops
  const pTier1X = useTransform(smoothX, [0, 1920], [-10, 10]);
  const pTier1Y = useTransform(smoothY, [0, 1080], [-10, 10]);
  const pTier2X = useTransform(smoothX, [0, 1920], [-25, 25]);
  const pTier2Y = useTransform(smoothY, [0, 1080], [-25, 25]);
  const pTier3X = useTransform(smoothX, [0, 1920], [-40, 40]);
  const pTier3Y = useTransform(smoothY, [0, 1080], [-40, 40]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };

    // Mouse parallax moved large blurred layers on every mouse move (costly on big screens). Kept only when the
    // person has not asked for reduced motion AND the screen is small enough for it to be cheap.
    const cheap = !isLight() && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.innerWidth * window.innerHeight < 1_400_000;
    if (cheap) window.addEventListener('mousemove', handleMouseMove);
    // Trigger initial position
    if (typeof window !== 'undefined') {
      mouseX.set(window.innerWidth / 2);
      mouseY.set(window.innerHeight / 2);
    }
    
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY]);

  const intensity = settings.backgroundIntensity / 100;
  const speedScale = settings.animationSpeed === 'slow' ? 2 : settings.animationSpeed === 'fast' ? 0.5 : 1;

  const particles = useMemo(() => {
    // Reduce particle count for better performance
    const count = Math.floor(12 * intensity + 3);
    return [...Array(count)].map((_, i) => ({
      id: i,
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      duration: (15 + Math.random() * 20) * speedScale, // Slower is cheaper
      delay: Math.random() * 5,
      size: Math.random() * 3 + 2,
      tier: (i % 3) + 1
    }));
  }, [intensity, speedScale]);

  // Early return ONLY after all hooks are called
  // light mode: a plain colour, nothing moves (the orbs, grid and particles are the biggest constant cost on weak devices)
  if (light) return <div className="fixed inset-0 z-[-10] pointer-events-none" style={{ backgroundColor: settings.backgroundColor }} />;
  if (settings.backgroundEffect === 'none') return null;

  const getGridImage = () => {
    const color = settings.effectColor;
    if (settings.gridPattern === 'dots') {
      return `radial-gradient(${color} 1px, transparent 1px)`;
    }
    return `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`;
  };

  const getParticleShape = () => {
    if (settings.particleShape === 'square') return 'rounded-sm';
    if (settings.particleShape === 'star') return 'clip-path-star';
    return 'rounded-full';
  };

  return (
    <div 
      className={`fixed inset-0 z-[-10] overflow-hidden pointer-events-none transition-colors duration-700`}
      style={{ backgroundColor: settings.backgroundColor }}
    >
      {/* Animated Gradient Orbs */}
      {(settings.backgroundEffect === 'orbs' || settings.backgroundEffect === 'all') && (
        <>
          <motion.div
            style={{
              x: orb1X,
              y: orb1Y,
              left: '15%',
              top: '15%',
            }}
            className="absolute w-[800px] h-[800px] rounded-full blur-[80px] will-change-transform"
            animate={{
              backgroundColor: settings.effectColor,
              opacity: [0.15 * intensity, 0.25 * intensity, 0.15 * intensity],
              scale: [1, 1.1, 1],
            }}
            transition={{
              opacity: { duration: 10 * speedScale, repeat: Infinity, ease: "easeInOut" },
              scale: { duration: 15 * speedScale, repeat: Infinity, ease: "easeInOut" },
            }}
          />
          <motion.div
            style={{
              x: orb2X,
              y: orb2Y,
              right: '10%',
              bottom: '10%',
            }}
            className="absolute w-[600px] h-[600px] rounded-full blur-[60px] will-change-transform"
            animate={{
              backgroundColor: settings.primaryColor,
              opacity: [0.1 * intensity, 0.2 * intensity, 0.1 * intensity],
              scale: [1, 1.2, 1],
            }}
            transition={{
              opacity: { duration: 12 * speedScale, repeat: Infinity, ease: "easeInOut" },
              scale: { duration: 18 * speedScale, repeat: Infinity, ease: "easeInOut" },
            }}
          />
        </>
      )}
      
      {/* Grid Pattern */}
      {(settings.backgroundEffect === 'grid' || settings.backgroundEffect === 'all') && (
        <motion.div 
          className="absolute inset-0 transition-opacity duration-500 will-change-transform"
          style={{
            opacity: 0.1 * intensity,
            backgroundImage: getGridImage(),
            backgroundSize: settings.gridPattern === 'dots' ? '40px 40px' : '80px 80px',
            x: gridX,
            y: gridY,
          }}
        />
      )}

      {/* Floating Particles */}
      {(settings.backgroundEffect === 'particles' || settings.backgroundEffect === 'all') && (
        particles.map((p) => (
          <motion.div
            key={p.id}
            animate={{
              y: [0, -100, 0],
              opacity: [0.2 * intensity, 0.5 * intensity, 0.2 * intensity],
            }}
            transition={{
              duration: p.duration,
              repeat: Infinity,
              ease: "easeInOut",
              delay: p.delay
            }}
            className={`absolute ${getParticleShape()} will-change-transform`}
            style={{
              top: p.top,
              left: p.left,
              width: p.size,
              height: p.size,
              backgroundColor: settings.effectColor,
              x: p.tier === 1 ? pTier1X : p.tier === 2 ? pTier2X : pTier3X,
              y: p.tier === 1 ? pTier1Y : p.tier === 2 ? pTier2Y : pTier3Y,
            }}
          />
        ))
      )}

      {/* Subtle overlay for depth - removed expensive backdrop-blur */}
      <div 
        className={`absolute inset-0`} 
        style={{ backgroundColor: settings.theme === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.05)' }}
      />
    </div>
  );
};
