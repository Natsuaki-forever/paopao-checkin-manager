(() => {
  try {
    const saved = localStorage.getItem("paopao-theme-v1");
    const preference = saved === "light" || saved === "dark" ? saved : "system";
    const theme = preference === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch {}
})();
