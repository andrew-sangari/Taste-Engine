"use client";

import { useState } from "react";

export function FilterDisclosure({ children, count = 0 }: { children: React.ReactNode; count?: number }) {
  const [open, setOpen] = useState(false);
  return <div className={`filterDisclosure ${open ? "isOpen" : ""}`}>
    <button aria-expanded={open} className="filterDisclosureToggle" onClick={() => setOpen((value) => !value)} type="button">
      Filters{count ? ` (${count})` : ""} <span aria-hidden="true">＋</span>
    </button>
    <div className="filterDisclosureBody">{children}</div>
  </div>;
}
