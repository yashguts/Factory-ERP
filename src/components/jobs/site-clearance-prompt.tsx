"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getJobSiteClearances, getSiteClearancesByJobNumber } from "@/lib/actions/dispatch";
import {
  SITE_CLEARANCE_PROMPT_TITLE,
  siteClearancePromptMessage,
  siteClearanceStatusOf,
  warnBeforeDispatch,
  type SiteClearanceStatus,
} from "@/lib/site-clearance";

/**
 * The soft "site clearance pending" question asked right before a dispatch is
 * saved (owner 2026-09-30). `confirmSiteClearance` resolves true straight away
 * when Construction has a clearance in force for the job; otherwise (pending,
 * revoked, or the check failed) it shows a Yes/No pop-up and resolves with the
 * answer. It never blocks a dispatch. Render `clearanceDialog` OUTSIDE any
 * other Modal's box (as a sibling): the Modal box is transformed, which would
 * trap a nested fixed overlay inside it.
 */
export function useSiteClearancePrompt() {
  // The question being asked; null = no pop-up open.
  const [ask, setAsk] = useState<{ jobNumber: string; status: SiteClearanceStatus } | null>(null);
  const resolverRef = useRef<((go: boolean) => void) | null>(null);

  // Unmounting mid-question counts as "No" so nothing is left waiting.
  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  const confirmSiteClearance = useCallback(
    async (target: { jobId?: string | null; jobNumber: string }): Promise<boolean> => {
      let status: SiteClearanceStatus;
      try {
        status = siteClearanceStatusOf(
          target.jobId
            ? await getJobSiteClearances(target.jobId)
            : await getSiteClearancesByJobNumber(target.jobNumber),
        );
      } catch {
        status = { state: "unknown" }; // network hiccup: ask, don't block
      }
      if (!warnBeforeDispatch(status)) return true;
      return new Promise<boolean>((resolve) => {
        resolverRef.current?.(false); // a newer question replaces an open one
        resolverRef.current = resolve;
        setAsk({ jobNumber: target.jobNumber, status });
      });
    },
    [],
  );

  const answer = useCallback((go: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setAsk(null);
    resolve?.(go);
  }, []);

  const clearanceDialog =
    ask !== null ? (
      <ConfirmDialog
        title={SITE_CLEARANCE_PROMPT_TITLE}
        message={siteClearancePromptMessage(ask.jobNumber, ask.status)}
        confirmLabel="Yes"
        cancelLabel="No"
        initialFocus="cancel"
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
    ) : null;

  return { confirmSiteClearance, clearanceDialog, clearancePromptOpen: ask !== null };
}
