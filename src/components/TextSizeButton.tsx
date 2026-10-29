import React, { useEffect, useState } from 'react';
import { getTextSize, nextTextSize, setTextSize, TEXT_SIZE_LABEL } from '../lib/textSize';
import { LIGHT_LABEL, getLightPref, lightReason, nextLightPref, setLightPref, useLight } from '../lib/lightMode';
import { Gauge } from 'lucide-react';

/** "Aa" button: cycles Normal, Large, Extra large */
export const TextSizeButton: React.FC<{ className?: string; compact?: boolean }> = ({ className = '', compact }) => {
  const [s, setS] = useState(getTextSize());
  useEffect(() => { const h = () => setS(getTextSize()); window.addEventListener('sdm-text-size', h); return () => window.removeEventListener('sdm-text-size', h); }, []);
  return (
    <button type="button" title={`Text size: ${TEXT_SIZE_LABEL[s]} (press to change)`} aria-label="Text size" onClick={() => setTextSize(nextTextSize(s))} className={className}>
      <span className="font-extrabold">A<span className="text-[0.8em]">a</span></span>{!compact && <span className="ml-1.5">{TEXT_SIZE_LABEL[s]}</span>}
    </button>
  );
};

/** "Light mode" button: cycles Auto, On, Off. Light mode removes blur and moving backgrounds so the system runs smoothly on weak PCs */
export const LightModeButton: React.FC<{ className?: string; compact?: boolean }> = ({ className = '', compact }) => {
  const [p, setP] = useState(getLightPref());
  const on = useLight();
  useEffect(() => { const h = () => setP(getLightPref()); window.addEventListener('sdm-light-mode', h); return () => window.removeEventListener('sdm-light-mode', h); }, []);
  const why = p === 'auto' ? (on ? `On automatically: ${lightReason()}` : 'Off: this device is fast enough') : p === 'on' ? 'Always on' : 'Always off';
  return (
    <button type="button" title={`Light mode: ${LIGHT_LABEL[p]} - ${why} (press to change)`} aria-label="Light mode" onClick={() => setLightPref(nextLightPref(p))} className={className}>
      <Gauge size={compact ? 18 : 16} />{!compact && <span className="ml-1.5">Light mode: {LIGHT_LABEL[p]}{p === 'auto' ? (on ? ' (on)' : ' (off)') : ''}</span>}
    </button>
  );
};
