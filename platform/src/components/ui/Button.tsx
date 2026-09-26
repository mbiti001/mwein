// Adapted from shadcn/ui's MIT-licensed Button. See THIRD_PARTY_NOTICES.md.
import type { ComponentProps } from "react";

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  pending?: boolean;
  pendingLabel?: string;
};

export function Button({
  className = "", variant = "primary", type = "button",
  pending = false, pendingLabel = "Saving…", disabled, children, ...props
}: ButtonProps) {
  return <button {...props} type={type} data-slot="button" data-variant={variant}
    className={`actionButton ${variant} ${className}`}
    disabled={disabled || pending} aria-busy={pending || undefined}>
    {pending && <span className="actionSpinner" aria-hidden="true" />}
    {pending ? pendingLabel : children}
  </button>;
}
