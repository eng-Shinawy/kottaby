"use client";

import { useEffect, useState } from "react";

export function useScrollSpy(sectionIds: readonly string[]): string {
  const [activeId, setActiveId] = useState("");
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveId(id);
        },
        { threshold: 0.2, rootMargin: "-80px 0px -50% 0px" }
      );
      obs.observe(el);
      observers.push(obs);
    }
    return () => {
      for (const o of observers) o.disconnect();
    };
  }, [sectionIds]);
  return activeId;
}
