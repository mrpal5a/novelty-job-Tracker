'use client';
// src/components/track/DeliverySceneContext.tsx
// Lets the job page steer the layout-level delivery scene: the truck's
// position on the road mirrors the open job's real pipeline progress.

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type DeliveryState = {
  /** 0–100 share of the pipeline completed. */
  percent: number;
  /** Labels have left the press — truck parks at the dock and unloads. */
  delivered: boolean;
  /** Stage name shown in the readout, e.g. "In Printing". */
  label: string;
  /** Job is paused — truck stops where it is with hazards on. */
  paused: boolean;
};

type Ctx = {
  state: DeliveryState | null;
  setState: (s: DeliveryState | null) => void;
};

const DeliverySceneCtx = createContext<Ctx | null>(null);

export function DeliverySceneProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DeliveryState | null>(null);
  const value = useMemo(() => ({ state, setState }), [state]);
  return <DeliverySceneCtx.Provider value={value}>{children}</DeliverySceneCtx.Provider>;
}

export function useDeliveryScene() {
  return useContext(DeliverySceneCtx);
}

/** Publish a job's progress to the scene for as long as the caller is mounted. */
export function useDriveDeliveryScene(state: DeliveryState | null) {
  const ctx = useContext(DeliverySceneCtx);
  const setState = ctx?.setState;
  const { percent, delivered, label, paused } = state ?? { percent: 0, delivered: false, label: '', paused: false };
  const hasState = state !== null;

  useEffect(() => {
    if (!setState) return;
    setState(hasState ? { percent, delivered, label, paused } : null);
    return () => setState(null);
  }, [setState, hasState, percent, delivered, label, paused]);
}
