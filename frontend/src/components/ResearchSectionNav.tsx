import { useEffect, useRef, useState } from "react";

// The Research company page's section bar (2026-11-16): sticks under the top
// bar, highlights the section in view and jumps to a section on click. The
// sections are elements with these ids; ones not on the page are left out.
export interface ResearchSection {
  id: string;
  label: string;
}

function scroller(): HTMLElement | null {
  return document.querySelector(".app-shell-content");
}

export default function ResearchSectionNav({ sections }: { sections: ResearchSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const navRef = useRef<HTMLElement>(null);
  const ids = sections.map((s) => s.id).join(",");

  useEffect(() => {
    const box = scroller();
    if (!box) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const nav = navRef.current;
      if (!nav || nav.offsetParent === null) return;
      // The section whose top has passed just under the bar is the one in view;
      // at the very bottom of the page, the last one.
      const line = nav.getBoundingClientRect().bottom + 24;
      let current = ids.split(",")[0];
      for (const id of ids.split(",")) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) current = ids.split(",").pop() ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    box.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      box.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  // Keep the highlighted tab visible when the bar scrolls sideways (phones).
  useEffect(() => {
    const tab = navRef.current?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    const strip = tab?.parentElement;
    if (!tab || !strip || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollTo({ left: tab.offsetLeft - strip.clientWidth / 2 + tab.offsetWidth / 2, behavior: "smooth" });
  }, [active]);

  function jump(id: string) {
    const box = scroller();
    const el = document.getElementById(id);
    const nav = navRef.current;
    if (!box || !el || !nav) return;
    // Where the bar sits once stuck: under the top bar.
    const topbar = parseFloat(getComputedStyle(nav).top) || 0;
    const offset = topbar + nav.offsetHeight + 16;
    const top = box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - offset;
    box.scrollTo({ top, behavior: "smooth" });
    setActive(id);
  }

  return (
    <nav className="research-sections" aria-label="Sections" ref={navRef}>
      <div className="research-sections-strip">
        {sections.map((s) => (
          <button
            type="button"
            key={s.id}
            data-section={s.id}
            className={`research-section-tab ${active === s.id ? "is-current" : ""}`}
            aria-current={active === s.id ? "true" : undefined}
            onClick={() => jump(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
