"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to Postgres change events on the given tables and invoke `onChange`
 * (debounced) whenever any of them change — so a list re-fetches itself when
 * ANOTHER user edits data, giving real-time sync across the team.
 *
 * Fail-safe by design: if Realtime can't connect (network, quota, config), the
 * page is unaffected — its reads are already live/fresh on any interaction, we
 * just don't get the automatic push. We never throw from here.
 *
 * `onChange` is read through a ref so the latest callback always runs without
 * forcing a re-subscribe; we only (re)subscribe when the table list changes.
 */
export function useRealtimeRefresh(tables: string[], onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  const key = tables.join(",");

  useEffect(() => {
    if (!key) return;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const ping = () => {
      if (timer) clearTimeout(timer);
      // Coalesce bursts (e.g. a transaction that touches several rows) into one refresh.
      timer = setTimeout(() => cb.current(), 400);
    };

    try {
      const supabase = createClient();
      channel = supabase.channel(`rt-${key}-${Date.now()}`);
      for (const table of key.split(",")) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          ping,
        );
      }
      channel.subscribe();
    } catch {
      // Realtime unavailable — silently fall back to interaction-driven freshness.
    }

    return () => {
      if (timer) clearTimeout(timer);
      try {
        if (channel) createClient().removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [key]);
}
