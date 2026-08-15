'use client';

import { useEffect, useState } from 'react';

/**
 * Sticky depth indicator pinned to the left edge.
 * Reads scroll progress and renders a "depth in metres" reading
 * styled like a surveyor's clinometer tablet.
 */
export function DepthMeter() {
  const [depth, setDepth] = useState(0);
  const [stratum, setStratum] = useState('SURFACE');

  useEffect(() => {
    const strata: ReadonlyArray<readonly [number, string]> = [
      [0, 'SURFACE'],
      [0.12, 'TOPSOIL'],
      [0.28, 'SANDSTONE'],
      [0.48, 'SHALE'],
      [0.68, 'GRANITE'],
      [0.85, 'BASALT'],
      [0.95, 'BEDROCK'],
    ];

    const onScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      const pct = total > 0 ? window.scrollY / total : 0;
      // 1 page-scroll = ~1200m drilling depth. Arbitrary, but lands the
      // hero in shallow figures and gives the deeper sections meaty
      // double-digit metres without ever exceeding a believable shaft.
      const metres = Math.round(pct * 1200);
      setDepth(metres);
      const hit = [...strata].reverse().find(([p]) => pct >= p);
      setStratum(hit?.[1] ?? 'SURFACE');
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="depth-meter" aria-hidden>
      <span>Depth</span>
      <b className="text-2xl tabular">
        {depth.toString().padStart(4, '0')}
        <span className="text-xs text-[var(--color-shadow)]"> m</span>
      </b>
      <span style={{ color: 'var(--color-dust)' }}>{stratum}</span>
      <div
        className="mt-2"
        style={{
          width: 2,
          height: 80,
          background: 'var(--color-vein-line)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: -5,
            top: 0,
            width: 12,
            height: 2,
            background: 'var(--color-ore)',
            transform: `translateY(${(depth / 1200) * 78}px)`,
            transition: 'transform 120ms ease-out',
          }}
        />
      </div>
    </div>
  );
}
