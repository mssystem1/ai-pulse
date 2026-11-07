import type { ButtonHTMLAttributes, ReactNode } from "react";

/** A consistent affordance for actions that open the contextual AI drawer. */
export function AskPulseButton({ children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return <button type="button" {...props} className={`terminal-ai-action ${className}`} data-ask-pulse title="Open Ask PULSE with this question"><span aria-hidden="true">✦</span> {children}<small>Ask PULSE</small></button>;
}
