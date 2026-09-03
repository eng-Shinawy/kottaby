"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { isDigitChar, isNumericChar } from "@/frontend/views/landing/utils";

/** Parse a stat string like "120+" or "8,500+" into { num, suffix }.
 * Linear scan instead of regex — avoids super-linear backtracking. */
function parseStatValue(raw: string): { num: number; suffix: string } {
  if (raw.length === 0 || !isDigitChar(raw[0])) return { num: 0, suffix: raw };
  let end = 1;
  while (end < raw.length && isNumericChar(raw[end])) {
    end += 1;
  }
  const numPart = raw.slice(0, end);
  const suffixPart = raw.slice(end);
  return { num: parseInt(numPart.replace(/,/g, ""), 10) || 0, suffix: suffixPart };
}

// ─── Animated counter ────────────────────────────────────────────────

export function AnimatedCounter({ raw }: { readonly raw: string }): ReactNode {
  const { num, suffix } = parseStatValue(raw);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = spanRef.current;
    let observer: IntersectionObserver | undefined;
    if (el) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !started) {
            setStarted(true);
            observer?.unobserve(el);
          }
        },
        { threshold: 0.3 }
      );
      observer.observe(el);
    }
    return () => observer?.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const duration = 2000;
    const startTime = performance.now();

    function easeOutCubic(x: number): number {
      return 1 - (1 - x) ** 3;
    }

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      setCount(Math.floor(eased * num));
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        setCount(num);
      }
    }

    requestAnimationFrame(tick);
  }, [started, num]);

  return (
    <span ref={spanRef}>
      {count.toLocaleString()}
      {suffix}
    </span>
  );
}
