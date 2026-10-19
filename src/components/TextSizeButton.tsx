import React, { useEffect, useState } from 'react';
import { getTextSize, nextTextSize, setTextSize, TEXT_SIZE_LABEL } from '../lib/textSize';

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
