'use client';
// src/components/admin/FitText.tsx
// A job or material name on a slip, shrunk until the whole of it fits its
// cell, instead of being cut off with "…" at one fixed size.
//
// It fills its parent cell and tries sizes from maxMm down to minMm (0.1mm
// steps, binary search), keeping the largest at which every character is
// inside the cell. Wrapping is allowed, so a long name may print on two
// smaller lines when that is bigger than one tiny line. Below minMm it stops
// and clips: smaller than that a thermal head can't print it legibly.
//
// Measured in the browser, so it needs a laid-out element: the print surface
// sits off-screen (SlipsManager) but is laid out, and this runs in a layout
// effect, before SlipsManager's requestAnimationFrame calls window.print().
// Both sizes are read the same way, so the preview's CSS scale doesn't matter.

import { useLayoutEffect, useRef, type CSSProperties } from 'react';

export default function FitText({
  text,
  maxMm,
  minMm,
  center = false,
  style,
}: {
  text: string;
  maxMm: number;
  minMm: number;
  center?: boolean;
  /** Weight, line height and the like; the size is FitText's. */
  style?: CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const b = box.current, t = inner.current;
    if (!b || !t) return;
    const fits = (mm: number) => {
      t.style.fontSize = `${mm}mm`;
      const outer = b.getBoundingClientRect(), r = t.getBoundingClientRect();
      return r.height <= outer.height && t.scrollWidth <= t.clientWidth;
    };
    // In tenths of a millimetre, so every size tried is a round one.
    let lo = Math.round(minMm * 10), hi = Math.round(maxMm * 10);
    if (fits(hi / 10)) return;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid / 10)) lo = mid; else hi = mid - 1;
    }
    fits(lo / 10);
  }, [text, maxMm, minMm]);

  return (
    <div
      ref={box}
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: center ? 'center' : 'flex-start',
      }}
    >
      <span
        ref={inner}
        style={{
          ...style,
          display: 'block',
          minWidth: 0,
          maxWidth: '100%',
          fontSize: `${maxMm}mm`,
          textAlign: center ? 'center' : 'left',
          // A name with no spaces still breaks rather than running out sideways.
          overflowWrap: 'anywhere',
        }}
      >
        {text}
      </span>
    </div>
  );
}
