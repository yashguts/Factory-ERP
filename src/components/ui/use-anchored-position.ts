"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Computes a viewport (`position: fixed`) anchor for a popover relative to a
 * trigger element, so the panel escapes any `overflow:hidden/auto` ancestor
 * (e.g. the inventory table's scroll wrapper) that would clip an `absolute`
 * one. Flips above the trigger when there isn't room below, and clamps the
 * left edge so the panel always stays on screen. Mirrors the proven logic in
 * inline-stock-adjust.tsx.
 */
export function useAnchoredPosition(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
  width: number,
  estHeight = 280,
): { top: number; left: number } {
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < estHeight && rect.top > estHeight;
    const top = flipUp ? Math.max(8, rect.top - estHeight - 4) : rect.bottom + 4;
    const left = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - width - 8),
    );
    setPos({ top, left });
  }, [open, triggerRef, width, estHeight]);

  return pos;
}
