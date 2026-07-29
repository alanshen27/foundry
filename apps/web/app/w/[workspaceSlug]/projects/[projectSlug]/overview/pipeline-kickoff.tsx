"use client";

import { useEffect, useRef } from "react";
import { useCopilot } from "@/components/copilot/copilot-provider";
import { PROJECT_KICKOFF_KEY } from "@/components/project-create-bar";

/**
 * After create-from-projects-page, fire the pending prompt once into the
 * sidebar copilot. No visible embed — overview stays stage/status only.
 */
export function PipelineKickoffListener({ hasBrief }: { hasBrief: boolean }) {
  const { send, status } = useCopilot();
  const kickedOff = useRef(false);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (hasBrief || kickedOff.current || busy) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PROJECT_KICKOFF_KEY);
      if (pending) sessionStorage.removeItem(PROJECT_KICKOFF_KEY);
    } catch {
      return;
    }
    if (!pending?.trim()) return;
    kickedOff.current = true;
    send(
      `@AI Bootstrap this project end-to-end: ${pending.trim()}\n\nFill the brief, requirements, BOM, circuit, 3D model, and validation checks.`,
    );
  }, [hasBrief, busy, send]);

  return null;
}
