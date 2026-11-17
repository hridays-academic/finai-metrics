// Sets Light/Dark before the page draws, so a Dark visitor never sees a
// flash of the light page. Mirrors hooks/useTheme.ts: a saved
// choice wins, else the device setting, else Light. A separate file
// because the CSP allows no inline scripts.
(function () {
  var mode = null;
  try {
    var v = localStorage.getItem("finai-metrics-mode");
    if (v === "light" || v === "dark") mode = v;
  } catch (e) {}
  if (!mode) {
    try {
      mode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) {
      mode = "light";
    }
  }
  document.documentElement.setAttribute("data-mode", mode);
})();

// Mouse devices get PageScrollbar.tsx instead of the browser's scrollbar;
// hide the browser's from the first paint so the page doesn't shift.
(function () {
  try {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      document.documentElement.classList.add("custom-scrollbar");
    }
  } catch (e) {}
})();
