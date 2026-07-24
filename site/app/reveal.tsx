"use client";

import { useEffect } from "react";

export function Reveal() {
  useEffect(() => {
    const root = document.documentElement;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const revealed = new WeakSet<Element>();
    const counted = new WeakSet<Element>();

    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("on");
        revealObserver.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

    const countObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        countUp(entry.target as HTMLElement);
        countObserver.unobserve(entry.target);
      }
    });

    function countUp(element: HTMLElement) {
      const target = Number(element.dataset.count);
      if (!Number.isFinite(target) || reducedMotion) {
        element.textContent = String(target);
        return;
      }
      const duration = 900;
      const start = performance.now();
      const digits = String(target).length;
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = String(Math.round(target * eased)).padStart(digits, "0");
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    function scan(scope: ParentNode) {
      const revealTargets = scope instanceof Element && scope.matches(".rv,.methodStep,.srcBar")
        ? [scope]
        : Array.from(scope.querySelectorAll(".rv,.methodStep,.srcBar"));
      for (const target of revealTargets) {
        if (revealed.has(target)) continue;
        revealed.add(target);
        if (reducedMotion) target.classList.add("on");
        else revealObserver.observe(target);
      }

      const countTargets = scope instanceof HTMLElement && scope.matches("[data-count]")
        ? [scope]
        : Array.from(scope.querySelectorAll<HTMLElement>("[data-count]"));
      for (const target of countTargets) {
        if (counted.has(target)) continue;
        counted.add(target);
        if (reducedMotion) target.textContent = target.dataset.count ?? target.textContent;
        else {
          target.textContent = "0".padStart(String(target.dataset.count ?? "0").length, "0");
          countObserver.observe(target);
        }
      }

      const staggerGroups = scope instanceof HTMLElement && scope.matches("[data-stagger]")
        ? [scope]
        : Array.from(scope.querySelectorAll<HTMLElement>("[data-stagger]"));
      for (const group of staggerGroups) {
        Array.from(group.children).forEach((child, index) => {
          if (child instanceof HTMLElement) child.style.setProperty("--rv-delay", `${index * 70}ms`);
        });
      }
    }

    root.classList.add("motion-ready");
    scan(document);
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) scan(node);
        }
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      revealObserver.disconnect();
      countObserver.disconnect();
      root.classList.remove("motion-ready");
    };
  }, []);

  return null;
}
