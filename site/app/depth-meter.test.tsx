import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepthMeter } from './depth-meter';

// jsdom leaves scrollHeight/scrollY/innerHeight at 0/0/768 and treats them as
// read-only getters, so we override them per scenario.
function setScroll(opts: { scrollY: number; scrollHeight: number; innerHeight: number }) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: opts.innerHeight });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: opts.scrollY });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: opts.scrollHeight,
  });
}

describe('DepthMeter', () => {
  beforeEach(() => setScroll({ scrollY: 0, scrollHeight: 0, innerHeight: 768 }));
  afterEach(() => cleanup());

  it('starts at the surface with a zero-padded reading', () => {
    render(<DepthMeter />);
    expect(screen.getByText('SURFACE')).toBeTruthy();
    expect(document.body.textContent).toContain('0000');
  });

  it('maps scroll progress to metres and the matching stratum', () => {
    // total = 2000 - 800 = 1200; scrollY 600 => 50% => round(0.5 * 1200) = 600m.
    // 0.5 falls in the SHALE band ([0.48, "SHALE"]).
    setScroll({ scrollY: 600, scrollHeight: 2000, innerHeight: 800 });
    render(<DepthMeter />);
    fireEvent.scroll(window);
    expect(document.body.textContent).toContain('0600');
    expect(screen.getByText('SHALE')).toBeTruthy();
  });

  it('reads BEDROCK near the bottom of the shaft', () => {
    // pct 0.97 -> >= 0.95 BEDROCK; round(0.97 * 1200) = 1164m.
    setScroll({ scrollY: 1164, scrollHeight: 2000, innerHeight: 800 });
    render(<DepthMeter />);
    fireEvent.scroll(window);
    expect(screen.getByText('BEDROCK')).toBeTruthy();
    expect(document.body.textContent).toContain('1164');
  });

  it('handles negative/bounce scroll gracefully by falling back to SURFACE', () => {
    setScroll({ scrollY: -100, scrollHeight: 2000, innerHeight: 800 });
    render(<DepthMeter />);
    fireEvent.scroll(window);
    expect(screen.getByText('SURFACE')).toBeTruthy();
  });
});
