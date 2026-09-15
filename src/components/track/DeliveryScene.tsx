'use client';
// src/components/track/DeliveryScene.tsx
// The /track footer: a delivery truck drives from the press (left) to the
// client's receiving dock (right) and unloads label rolls. On the landing
// page it loops as the portal's signature; on a job page its position is
// the job's real pipeline progress (see DeliverySceneContext).

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { useDeliveryScene } from './DeliverySceneContext';

registerGsap();

const ROAD_H = 20;
const LABEL_COUNT = 3;
const LABEL_W = 16;
const LABEL_GAP = 3;
// Platform geometry inside the dock SVG (viewBox 0 0 130 90).
const DOCK_VB_W = 130;
const DOCK_VB_H = 90;
const DOCK_PLATFORM_W = 48;
const DOCK_PLATFORM_TOP = 78;

// Points inside the press SVG (viewBox 0 0 140 90) and truck SVG (viewBox 0 0 160 68).
const PRESS_VB_W = 140;
const PRESS_VB_H = 90;
const CHARGER_CX = 128;
const CHARGER_TOP = 72;
const DOOR_CX = 88;
const TRUCK_VB_W = 160;
const TRUCK_VB_H = 68;
const PORT_X = 3;
const PORT_Y = 40;
const CARGO_CX = 51;
const CARGO_CY = 28;

type Layout = {
  width: number; truckW: number;
  dockLeft: number; dockW: number; dockH: number;
  pressLeft: number; pressW: number; pressH: number;
};

export function DeliveryScene() {
  const scene = useDeliveryScene();
  const state = scene?.state ?? null;

  const root = useRef<HTMLDivElement>(null);
  const truck = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const press = useRef<HTMLDivElement>(null);
  const readoutEl = useRef<HTMLParagraphElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    const dockEl = dock.current;
    const truckEl = truck.current;
    const pressEl = press.current;
    if (!el || !dockEl || !truckEl || !pressEl) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const d = dockEl.getBoundingClientRect();
      const pr = pressEl.getBoundingClientRect();
      setLayout({
        width: r.width,
        truckW: truckEl.getBoundingClientRect().width,
        dockLeft: d.left - r.left,
        dockW: d.width,
        dockH: d.height,
        pressLeft: pr.left - r.left,
        pressW: pr.width,
        pressH: pr.height,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dock platform geometry (where rolls land).
  const platformLeft = layout ? layout.dockLeft : 0;
  const platformScale = layout ? layout.dockW / DOCK_VB_W : 1;
  const labelBottom = layout
    ? ROAD_H + (DOCK_VB_H - DOCK_PLATFORM_TOP) * (layout.dockH / DOCK_VB_H)
    : ROAD_H;
  const labelsStartX = platformLeft + 4 * platformScale;
  const platformInnerW = DOCK_PLATFORM_W * platformScale - 8 * platformScale;
  const labelStep = Math.min(LABEL_W + LABEL_GAP, Math.max(LABEL_W * 0.7, (platformInnerW - LABEL_W) / (LABEL_COUNT - 1)));

  // Press geometry (where the truck charges and loads).
  const pressScale = layout ? layout.pressW / PRESS_VB_W : 1;
  const chargerX = layout ? layout.pressLeft + CHARGER_CX * pressScale : 0;
  const chargerTop = layout ? ROAD_H + (PRESS_VB_H - CHARGER_TOP) * pressScale : ROAD_H;
  const doorX = layout ? layout.pressLeft + DOOR_CX * pressScale - LABEL_W / 2 : 0;
  const truckScale = layout ? layout.truckW / TRUCK_VB_W : 1;
  const truckBottom = ROAD_H - 2;
  const loadX = chargerX + 12;
  const portX = loadX + PORT_X * truckScale;
  const portY = truckBottom + (TRUCK_VB_H - PORT_Y) * truckScale;
  const cargoX = loadX + CARGO_CX * truckScale - LABEL_W / 2;
  const cargoY = truckBottom + (TRUCK_VB_H - CARGO_CY) * truckScale - LABEL_W / 2;
  const cableW = Math.max(1, portX - chargerX);
  const cableH = Math.max(chargerTop, portY) - ROAD_H + 2;

  const percent = state ? Math.max(0, Math.min(100, state.percent)) : null;
  const delivered = Boolean(state?.delivered);
  const paused = Boolean(state?.paused);
  const idleReadout = 'Ankleshwar GIDC → your dock';

  useGSAP(
    () => {
      const truckEl = truck.current;
      const rootEl = root.current;
      if (!truckEl || !rootEl || !layout) return;

      const wheels = truckEl.querySelectorAll<SVGGElement>('.wheel');
      const body = truckEl.querySelector<HTMLElement>('.truck-body');
      const hazards = truckEl.querySelectorAll<SVGElement>('.hazard');
      const bars = truckEl.querySelectorAll<SVGElement>('.ev-bar');
      const bolt = truckEl.querySelector<SVGElement>('.ev-bolt');
      const labels = rootEl.querySelectorAll<HTMLElement>('.delivered-label');
      const loading = rootEl.querySelectorAll<HTMLElement>('.loading-label');
      const cable = rootEl.querySelector<HTMLElement>('.charge-cable');
      const lamp = rootEl.querySelector<SVGElement>('.dock-lamp');
      const flow = rootEl.querySelector<SVGPathElement>('.charge-flow');
      const say = (text: string) => () => { if (readoutEl.current) readoutEl.current.textContent = text; };

      const startX = -layout.truckW - 24;
      const exitX = layout.width + 40;
      const stopX = platformLeft - layout.truckW - 6 * platformScale;
      const unloadFromX = stopX + layout.truckW * 0.3;
      // Job page: the road from the press charger to the dock is the progress bar.
      const jobX = (pct: number) => loadX + (stopX - loadX) * (pct / 100);
      const litBars = (pct: number) => Math.min(LABEL_COUNT, Math.floor((pct / 100) * LABEL_COUNT + 0.001));

      const labelFrom = (i: number) => ({
        x: unloadFromX - (labelsStartX + i * labelStep),
        y: -22 - i * 4,
        scale: 0.6,
        opacity: 0,
      });
      const labelTo = { x: 0, y: 0, scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.4)' };

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set(hazards, { opacity: paused ? 1 : 0 });
        gsap.set(loading, { opacity: 0 });
        if (percent === null || delivered) {
          gsap.set(truckEl, { x: stopX });
          gsap.set(cable, { opacity: 0 });
          gsap.set(bars, { opacity: 1 });
          gsap.set(lamp, { opacity: 1 });
          gsap.set(labels, { x: 0, y: 0, scale: 1, opacity: 1 });
        } else {
          gsap.set(lamp, { opacity: 0.18 });
          gsap.set(truckEl, { x: jobX(percent) });
          gsap.set(cable, { opacity: percent === 0 ? 1 : 0 });
          bars.forEach((b, i) => gsap.set(b, { opacity: i < litBars(percent) ? 1 : 0.2 }));
          gsap.set(labels, { opacity: 0 });
        }
      });

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        // The ambient loop on /track cruises; the job page arrives briskly. Wheel spin matches road speed.
        const ambient = percent === null;
        const spin = gsap.to(wheels, {
          rotation: 360, duration: ambient ? 1.5 : 0.55, ease: 'none', repeat: -1, transformOrigin: '50% 50%', paused: true,
        });
        const bob = body
          ? gsap.to(body, { y: -1.2, duration: 0.16, ease: 'sine.inOut', yoyo: true, repeat: -1, paused: true })
          : null;
        const rays = rootEl.querySelectorAll<SVGElement>('.sun-ray');
        const sunlight = rays.length
          ? gsap.to(rays, { strokeDashoffset: -28, duration: 2.8, ease: 'none', repeat: -1 })
          : null;
        const solar = rootEl.querySelectorAll<SVGElement>('.solar-glow');
        const solarPulse = solar.length
          ? gsap.to(solar, { opacity: 0.85, duration: 2.6, ease: 'sine.inOut', yoyo: true, repeat: -1 })
          : null;
        const current = flow
          ? gsap.to(flow, { strokeDashoffset: -24, duration: 0.8, ease: 'none', repeat: -1, paused: true })
          : null;
        const drive = () => { spin.play(); bob?.play(); };
        const park = () => { spin.pause(); bob?.pause(); if (body) gsap.to(body, { y: 0, duration: 0.2 }); };

        const tl = gsap.timeline({ repeat: ambient ? -1 : 0, repeatDelay: 1.8 });
        tl.set(truckEl, { x: startX });
        tl.set(hazards, { opacity: 0 });
        tl.set([loading, cable], { opacity: 0 });
        tl.set(lamp, { opacity: 0.18 });
        tl.set(bars, { opacity: ambient ? 0.2 : 1 });
        labels.forEach((l, i) => tl.set(l, labelFrom(i)));

        if (ambient) {
          // 1. Pull up beside the press, rear to the charger.
          tl.call(say(idleReadout))
            .call(drive)
            .to(truckEl, { x: loadX, duration: 4.5, ease: 'power1.out' })
            .call(park);

          // 2. Plug in: cable on, current flowing, battery filling bar by bar…
          tl.call(say('Charging · loading at the press'), undefined, '+=0.3')
            .to(cable, { opacity: 1, duration: 0.4 })
            .call(() => current?.play());
          tl.to(bars, { opacity: 1, duration: 0.6, stagger: 2.3, ease: 'power1.out' }, '>0.2');
          if (bolt) tl.to(bolt, { opacity: 0.35, duration: 0.4, yoyo: true, repeat: 15, ease: 'sine.inOut' }, '<');

          // …while rolls come out of the door and go into the cargo box.
          loading.forEach((l, i) => {
            const at = i === 0 ? '<0.3' : '<0.9';
            tl.fromTo(
              l,
              { x: 0, y: 0, scale: 0.7, opacity: 0 },
              { opacity: 1, scale: 1, duration: 0.3, ease: 'power1.out' },
              at
            )
              .to(l, { x: cargoX - doorX, y: -(cargoY - (ROAD_H + 2)), duration: 1.1, ease: 'power1.inOut' }, '>')
              .to(l, { scale: 0.35, opacity: 0, duration: 0.3, ease: 'power1.in' }, '>-0.05');
          });

          // 3. Unplug and dispatch.
          tl.call(() => current?.pause(), undefined, '>0.5')
            .to(cable, { opacity: 0, duration: 0.35 })
            .call(say('En route · your dock'))
            .call(drive, undefined, '+=0.4')
            .to(truckEl, { x: stopX, duration: 9, ease: 'power1.inOut' })
            .call(park)
            .call(say('Delivered'));
          labels.forEach((l, i) => tl.to(l, labelTo, i === 0 ? '>0.4' : '>-0.3'));
          tl.to(lamp, { opacity: 1, duration: 0.3, ease: 'power1.out' }, '>-0.2');
          tl.call(drive, undefined, '+=1.8')
            .to(truckEl, { x: exitX, duration: 5.5, ease: 'power1.in' })
            .call(park)
            .to(labels, { opacity: 0, y: -6, duration: 0.5, stagger: 0.06 }, '-=0.3')
            .to(lamp, { opacity: 0.18, duration: 0.4 }, '<');
        } else {
          // Job page: drive in to where the job actually is. Fresh POs sit plugged in at
          // the press; each completed stage moves the truck further down the road and
          // lights the battery; Dispatched parks it at the dock and unloads.
          const targetX = delivered ? stopX : jobX(percent);
          const lit = delivered ? LABEL_COUNT : litBars(percent);
          tl.set(bars, { opacity: 0.2 });
          tl.call(drive)
            .to(truckEl, { x: targetX, duration: 2 + 2.5 * ((targetX - startX) / (stopX - startX)), ease: 'power2.out' })
            .call(park);
          bars.forEach((b, i) => {
            if (i < lit) tl.to(b, { opacity: 1, duration: 0.35, ease: 'power1.out' }, i === 0 ? '>0.1' : '>-0.1');
          });
          if (!delivered && percent === 0) {
            tl.to(cable, { opacity: 1, duration: 0.4 }, '<').call(() => current?.play());
          }
          if (delivered) {
            labels.forEach((l, i) => tl.to(l, labelTo, i === 0 ? '>0.3' : '>-0.38'));
            tl.to(lamp, { opacity: 1, duration: 0.3, ease: 'power1.out' }, '>-0.2');
          }
          if (paused) {
            tl.to(hazards, { opacity: 1, duration: 0.5, ease: 'steps(1)', yoyo: true, repeat: -1 }, '>');
          }
        }

        return () => {
          spin.kill(); bob?.kill(); sunlight?.kill(); solarPulse?.kill(); current?.kill(); tl.kill();
          say(idleReadout)();
        };
      });

      return () => mm.revert();
    },
    { dependencies: [layout, percent, delivered, paused], scope: root }
  );

  const readout = state
    ? delivered
      ? 'Delivered'
      : paused
        ? `On hold · ${percent}%`
        : `${state.label} · ${percent}%`
    : idleReadout;

  return (
    <div className="w-full">
      <p
        ref={readoutEl}
        aria-live="polite"
        className="text-center font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--glass-muted)] mb-1"
      >
        {readout}
      </p>

      <div ref={root} aria-hidden className="relative h-40 sm:h-52 overflow-hidden select-none">
        {/* Press (origin) */}
        <div ref={press} className="absolute left-3 bottom-5 w-[148px] sm:w-[208px] text-[var(--glass-ink)]">
          <PressSilhouette />
        </div>

        {/* Client dock (destination) */}
        <div ref={dock} className="absolute right-3 bottom-5 w-[92px] sm:w-[120px] text-[var(--glass-ink)]">
          <DockSilhouette />
        </div>

        {/* Road */}
        <div className="absolute inset-x-0 bottom-0 border-t border-white/25 bg-black/25" style={{ height: ROAD_H }}>
          <div
            className="absolute inset-x-0 top-1/2 h-px"
            style={{ backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,.28) 0 18px, transparent 18px 34px)' }}
          />
        </div>

        {/* Charging cable: charger head → truck's rear port (only while parked at the press) */}
        <div
          className="charge-cable absolute text-[var(--glass-ink)]"
          style={{ left: chargerX, bottom: ROAD_H - 2, width: cableW, height: cableH, opacity: 0 }}
        >
          <svg viewBox={`0 0 ${cableW} ${cableH}`} className="block w-full h-full overflow-visible" preserveAspectRatio="none">
            <path
              d={`M0 ${cableH - (chargerTop - ROAD_H) - 2} Q ${cableW / 2} ${cableH + 2} ${cableW} ${cableH - (portY - ROAD_H) - 2}`}
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".7"
            />
            <path
              className="charge-flow"
              d={`M0 ${cableH - (chargerTop - ROAD_H) - 2} Q ${cableW / 2} ${cableH + 2} ${cableW} ${cableH - (portY - ROAD_H) - 2}`}
              fill="none" stroke="#7CF0BE" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="4 8"
            />
          </svg>
        </div>

        {/* Label rolls being loaded out of the press door */}
        {Array.from({ length: LABEL_COUNT }).map((_, i) => (
          <div
            key={`load-${i}`}
            className="loading-label absolute text-[var(--glass-ink)]"
            style={{ left: doorX, bottom: ROAD_H + 2, width: LABEL_W, height: LABEL_W, opacity: 0 }}
          >
            <LabelRoll />
          </div>
        ))}

        {/* Label rolls delivered onto the platform */}
        {Array.from({ length: LABEL_COUNT }).map((_, i) => (
          <div
            key={i}
            className="delivered-label absolute text-[var(--glass-ink)]"
            style={{ left: labelsStartX + i * labelStep, bottom: labelBottom, width: LABEL_W, height: LABEL_W, opacity: 0 }}
          >
            <LabelRoll />
          </div>
        ))}

        {/* Truck */}
        <div
          ref={truck}
          className="absolute left-0 w-[116px] sm:w-[150px] will-change-transform"
          style={{ bottom: truckBottom, transform: 'translateX(-400px)' }}
        >
          <div className="truck-body">
            <TruckGlyph />
          </div>
          <div className="absolute inset-x-3 -bottom-1 h-2 rounded-full bg-black/40 blur-sm" />
        </div>
      </div>
    </div>
  );
}

function TruckGlyph() {
  const windowClip = useId();
  return (
    <svg viewBox="0 0 160 68" className="block w-full h-auto overflow-visible">
      <defs>
        <clipPath id={windowClip}>
          <path d="M104 22 H122 Q128 22 132 29 L137 38 H104 Z" />
        </clipPath>
      </defs>
      {/* cargo box */}
      <rect x="2" y="6" width="98" height="44" rx="4" fill="rgba(255,255,255,.10)" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="30" width="98" height="6" fill="#10553F" opacity=".95" />
      {/* EV livery: charged battery + a line that points back at the solar roof */}
      <g stroke="#7CF0BE" strokeWidth="1" strokeLinejoin="round">
        <rect x="8" y="13.5" width="17" height="9" rx="1.8" fill="rgba(124,240,190,.12)" />
        <rect x="25" y="16.2" width="1.8" height="3.6" rx=".5" fill="#7CF0BE" stroke="none" />
        <g fill="#7CF0BE" stroke="none">
          <rect className="ev-bar" x="9.8" y="15.3" width="3" height="5.4" rx=".5" />
          <rect className="ev-bar" x="13.6" y="15.3" width="3" height="5.4" rx=".5" />
          <rect className="ev-bar" x="17.4" y="15.3" width="3" height="5.4" rx=".5" />
          <path className="ev-bolt" d="M22.6 14.9 L20.6 18.3 H22.1 L21.6 21 L23.8 17.6 H22.3 Z" />
        </g>
      </g>
      <text
        x="30" y="19.2" fontSize="5.2" fontWeight="600" letterSpacing=".8" fill="#7CF0BE"
        style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace' }}
      >
        100% ELECTRIC
      </text>
      <text
        x="30" y="26" fontSize="3.4" letterSpacing=".3" fill="currentColor" opacity=".75"
        style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace' }}
      >
        CHARGED ON OUR SOLAR ROOF
      </text>
      <text
        x="51" y="45" textAnchor="middle" fontSize="6.5" letterSpacing="1.4" fill="currentColor" opacity=".8"
        style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace' }}
      >
        NOVELTY LABELS
      </text>
      {/* cab */}
      <path d="M100 18 H124 Q132 18 137 27 L146 42 V50 H100 Z" fill="rgba(255,255,255,.14)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M104 22 H122 Q128 22 132 29 L137 38 H104 Z" fill="rgba(234,255,245,.18)" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      {/* driver, seated behind the windscreen */}
      <g className="driver" clipPath={`url(#${windowClip})`} fill="rgba(255,255,255,.16)" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
        <path d="M109 40 Q109 32.5 116.5 32.5 Q124 32.5 124 40 Z" />
        <circle cx="116.5" cy="27.5" r="3.4" />
        <path d="M119 33.5 Q124 32 128 34" fill="none" strokeLinecap="round" />
        <path d="M127 37 L130.5 30.5" fill="none" strokeLinecap="round" opacity=".8" />
      </g>
      {/* EV badge on the cab door */}
      <rect x="106" y="41" width="11" height="6.5" rx="3.25" fill="rgba(124,240,190,.16)" stroke="#7CF0BE" strokeWidth=".8" opacity=".95" />
      <path d="M112.2 41.8 L109.6 44.8 H111.4 L110.8 47.2 L113.4 44.1 H111.6 Z" fill="#7CF0BE" />
      {/* rear charge port */}
      <rect x="0.5" y="37.5" width="4" height="5" rx="1" fill="#0A1F18" stroke="#7CF0BE" strokeWidth=".8" />
      <circle cx="2.5" cy="40" r=".9" fill="#7CF0BE" />
      {/* chassis + bumper */}
      <rect x="0" y="50" width="150" height="4" rx="1" fill="currentColor" opacity=".9" />
      <rect x="146" y="43" width="6" height="9" rx="1.5" fill="currentColor" opacity=".9" />
      <circle cx="147.5" cy="46.5" r="1.8" fill="#7CF0BE" />
      {/* hazard lamps (On Hold only) */}
      <rect className="hazard" x="3" y="53" width="5" height="3" rx="0.5" fill="#F59E0B" opacity="0" />
      <rect className="hazard" x="140" y="53" width="5" height="3" rx="0.5" fill="#F59E0B" opacity="0" />
      {/* wheels */}
      <Wheel cx={28} />
      <Wheel cx={122} />
    </svg>
  );
}

function Wheel({ cx }: { cx: number }) {
  const cy = 58;
  return (
    <g className="wheel">
      <circle cx={cx} cy={cy} r="9" fill="#0A1F18" stroke="currentColor" strokeWidth="2" />
      <path d={`M${cx} ${cy - 9} V${cy + 9} M${cx - 9} ${cy} H${cx + 9}`} stroke="currentColor" strokeWidth="1.2" opacity=".55" />
      <circle cx={cx} cy={cy} r="3" fill="currentColor" />
    </g>
  );
}

const ROOF_SLOPES = [4, 28, 52, 76];
const SUN_X = 52;
const SUN_Y = -16;

function PressSilhouette() {
  const glow = useId();
  return (
    <svg viewBox="0 -34 140 124" className="block w-full h-auto overflow-visible">
      <defs>
        <filter id={glow} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      {/* sun overhead */}
      <g stroke="#7CF0BE" strokeWidth="1" strokeLinecap="round" opacity=".9">
        <circle cx={SUN_X} cy={SUN_Y} r="5.5" fill="rgba(124,240,190,.35)" filter={`url(#${glow})`} />
        <circle cx={SUN_X} cy={SUN_Y} r="5.5" fill="rgba(124,240,190,.35)" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <path key={a} d={`M${SUN_X} ${SUN_Y - 8} V${SUN_Y - 11}`} transform={`rotate(${a} ${SUN_X} ${SUN_Y})`} />
        ))}
      </g>
      {/* sunlight streaming onto the panels */}
      <g fill="none" stroke="#7CF0BE" strokeWidth="1" strokeLinecap="round" strokeDasharray="3 11" opacity=".55">
        {ROOF_SLOPES.map((x) => (
          <path key={x} className="sun-ray" d={`M${SUN_X} ${SUN_Y + 7} L${x + 12} 31`} />
        ))}
      </g>
      <g fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.28)" strokeWidth="1" strokeLinejoin="round">
        <path d="M4 89 V40 L28 26 V40 L52 26 V40 L76 26 V40 L100 26 V89 Z" />
        <rect x="78" y="62" width="20" height="27" rx="1" />
        <path d="M78 75 H98" opacity=".6" />
      </g>
      {/* solar array on each sawtooth slope: soft glow underneath, panels on top */}
      <g className="solar-glow" fill="#7CF0BE" opacity=".4" filter={`url(#${glow})`}>
        {ROOF_SLOPES.map((x) => (
          <path key={x} d={`M${x + 2} 36 L${x + 22} 24.5 L${x + 22} 29 L${x + 2} 40.5 Z`} />
        ))}
      </g>
      <g fill="rgba(124,240,190,.42)" stroke="#7CF0BE" strokeWidth=".9" strokeLinejoin="round">
        {ROOF_SLOPES.map((x) => (
          <g key={x}>
            <path d={`M${x + 2} 36 L${x + 22} 24.5 L${x + 22} 29 L${x + 2} 40.5 Z`} />
            <path d={`M${x + 7} 33.1 L${x + 7} 37.6 M${x + 12} 30.25 L${x + 12} 34.75 M${x + 17} 27.4 L${x + 17} 31.9`} opacity=".8" />
          </g>
        ))}
      </g>
      {/* EV charger by the loading door */}
      <g fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.28)" strokeWidth="1" strokeLinejoin="round">
        <rect x="124" y="72" width="8" height="17" rx="1" />
        <rect x="126" y="75" width="4" height="3" fill="rgba(124,240,190,.45)" stroke="none" />
        <path d="M132 76 Q138 76 138 82 V89" fill="none" />
      </g>
      <path d="M128.3 79.5 L126.6 82.6 H128.1 L127.6 85 L129.6 81.8 H128.1 Z" fill="#7CF0BE" />
      <g fill="rgba(234,255,245,.30)">
        <rect x="46" y="48" width="8" height="6" />
        <rect x="60" y="48" width="8" height="6" />
        <rect x="74" y="48" width="8" height="6" />
        <rect x="88" y="48" width="6" height="6" />
      </g>
      <text
        x="41" y="72" textAnchor="middle" fontSize="5.6" fontWeight="600" letterSpacing="1" fill="rgba(234,255,245,.7)"
        style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace' }}
      >
        NOVELTY LABELS
      </text>
      <text
        x="42" y="81" textAnchor="middle" fontSize="4.6" letterSpacing=".8" fill="#7CF0BE" opacity=".9"
        style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace' }}
      >
        SOLAR · EV FLEET
      </text>
    </svg>
  );
}

function DockSilhouette() {
  return (
    <svg viewBox="0 0 130 90" className="block w-full h-auto">
      <g fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.28)" strokeWidth="1" strokeLinejoin="round">
        <rect x="40" y="22" width="88" height="67" />
        <rect x="48" y="52" width="30" height="37" rx="1" />
        <path d="M40 46 H82" />
        <rect x="0" y="78" width="48" height="11" />
      </g>
      {/* receiving lamp: dim until the rolls land */}
      <circle className="dock-lamp" cx="63" cy="40" r="2.2" fill="#7CF0BE" opacity=".18" />
      <circle cx="63" cy="40" r="2.2" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth=".8" />
      <g fill="rgba(234,255,245,.30)">
        <rect x="88" y="32" width="8" height="6" />
        <rect x="102" y="32" width="8" height="6" />
        <rect x="116" y="32" width="6" height="6" />
      </g>
      <text
        x="104" y="66" textAnchor="middle" fontSize="6.5" letterSpacing="1.4" fill="rgba(234,255,245,.55)"
        style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace' }}
      >
        RECEIVING
      </text>
    </svg>
  );
}

function LabelRoll() {
  return (
    <svg viewBox="0 0 16 16" className="block w-full h-full">
      <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,.14)" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      <path d="M8 1 A7 7 0 0 1 15 8" fill="none" stroke="#10553F" strokeWidth="2.2" />
    </svg>
  );
}
