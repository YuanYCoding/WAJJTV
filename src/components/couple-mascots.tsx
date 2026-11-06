'use client';
/* eslint-disable @next/next/no-img-element -- private authenticated artwork, no public optimization cache */
import { useState } from 'react';
import { useAuth } from './auth';

export function CoupleMascots() {
  const { verified } = useAuth();
  const [failed, setFailed] = useState(false);
  return <aside className="couple-stage" aria-label="海清和静静">
    <div className="stage-glow" aria-hidden />
    <div className="stage-line" aria-hidden />
    {verified && !failed ? <img className="couple-mascots" src="/api/couple-art" decoding="async" fetchPriority="high" alt="海清和静静的双人插画，坐在放映台上" onError={() => setFailed(true)} /> : <span className="stage-monogram" aria-hidden>J & J</span>}

  </aside>;
}
