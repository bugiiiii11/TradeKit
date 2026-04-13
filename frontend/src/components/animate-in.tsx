"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type AnimateInProps = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section";
};

export function AnimateIn({
  children,
  className,
  delay = 0,
  as: Tag = "div",
}: AnimateInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Check if element is already in viewport on mount
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      const t = setTimeout(() => setVisible(true), delay);
      return () => clearTimeout(t);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setVisible(true), delay);
          observer.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={cn(
        "transition-all duration-500 ease-out",
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
