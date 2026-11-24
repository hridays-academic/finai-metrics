import { type RefObject, useEffect, useRef } from "react";

// T19, T20, A3 (master plan phase 1): a sheet (Settings, sign-in) closes on
// Escape (and on a tap outside, via its backdrop), keeps keyboard focus
// inside itself, makes the page behind inert with its scrolling locked and its
// animations paused, and gives focus back to whatever opened it.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let open = 0; // sheets open right now (the page stays inert until the last closes)

export function useSheet(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const page = document.querySelector<HTMLElement>(".app-shell-content");
    open += 1;
    page?.setAttribute("inert", "");
    page?.classList.add("is-behind-sheet");

    const panel = ref.current;
    const shown = (el: HTMLElement) => (typeof el.checkVisibility === "function" ? el.checkVisibility() : true);
    const focusables = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(shown);
    const first = focusables()[0];
    if (panel && !panel.contains(document.activeElement)) (first ?? panel).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (at <= 0 || !panel.contains(document.activeElement))) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && (at === list.length - 1 || !panel.contains(document.activeElement))) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      open = Math.max(0, open - 1);
      if (open === 0) {
        page?.removeAttribute("inert");
        page?.classList.remove("is-behind-sheet");
      }
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}
