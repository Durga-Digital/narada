import type { CSSProperties } from "react";
import {
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      closeButton
      duration={4500}
      visibleToasts={3}
      offset={24}
      mobileOffset={16}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-primary" />,
        error: <CircleXIcon className="size-4 text-destructive" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--color-border)",
          "--border-radius": "var(--radius-lg)",
        } as CSSProperties
      }
    />
  );
}
