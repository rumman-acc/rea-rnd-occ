import { MessageCircle } from "lucide-react";
import { appConfig } from "@/config/branding";

/**
 * Inert placeholder for the assistant entry point (SPEC FR-007, decision D2).
 * It opens no panel and issues no request; the original's chat behavior and
 * endpoint are out of scope.
 */
export function AssistantButton() {
  return (
    <button type="button" className="assistant" aria-label="Open Ask Fluid assistant">
      <MessageCircle size={16} aria-hidden="true" /> {appConfig.assistantLabel}
    </button>
  );
}
