"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself while its form's action runs, so a
// double tap can't log twice.
export function SubmitButton({
  children,
  pendingText,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className} {...rest}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
