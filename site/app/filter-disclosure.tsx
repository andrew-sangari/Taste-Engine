"use client";

import { useId, useState } from "react";

export function FilterDisclosure({ children, count = 0, onClear }: { children: React.ReactNode; count?: number; onClear?: () => void }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return <div className={`filterDisclosure ${open ? "isOpen" : ""}`}>
    <button aria-controls={bodyId} aria-expanded={open} className="filterDisclosureToggle" onClick={() => setOpen((value) => !value)} type="button">
      Filters{count ? ` (${count})` : ""} <span aria-hidden="true">＋</span>
    </button>
    <div className="filterDisclosureBody" id={bodyId}>{children}{count && onClear ? <button className="clearFilters" onClick={onClear} type="button">Clear filters</button> : null}</div>
  </div>;
}
