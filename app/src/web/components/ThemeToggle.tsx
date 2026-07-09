import { Laptop, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const storageKey = "paopao-theme-v1";
const labels: Record<ThemePreference, string> = {
  system: "\u8ddf\u968f\u8bbe\u5907",
  light: "\u6d45\u8272",
  dark: "\u6df1\u8272",
};

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(storageKey);
  return isThemePreference(stored) ? stored : "system";
}

function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
  const theme = resolvedTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#111827" : "#ffffff");
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    applyTheme(preference);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    if (preference !== "system") return;
    const update = () => applyTheme("system");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preference]);

  const change = (value: ThemePreference) => {
    window.localStorage.setItem(storageKey, value);
    setPreference(value);
  };

  const Icon = preference === "light" ? Sun : preference === "dark" ? Moon : Laptop;
  return (
    <label className={`theme-toggle ${className}`}>
      <Icon size={18} aria-hidden="true" />
      <span className="sr-only">{"\u4e3b\u9898\u6a21\u5f0f"}</span>
      <select
        aria-label={"\u4e3b\u9898\u6a21\u5f0f"}
        value={preference}
        onChange={(event) => change(event.target.value as ThemePreference)}
      >
        {(Object.keys(labels) as ThemePreference[]).map((value) => (
          <option key={value} value={value}>{labels[value]}</option>
        ))}
      </select>
    </label>
  );
}

