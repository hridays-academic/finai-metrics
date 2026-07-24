import type { Theme } from "../hooks/useTheme";

interface SettingsPanelProps {
  theme: Theme;
  onToggleTheme: () => void;
  onClose: () => void;
}

export default function SettingsPanel({ theme, onToggleTheme, onClose }: SettingsPanelProps) {
  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <div className="settings-panel" role="dialog" aria-label="Settings">
        <div className="settings-panel-header">
          <h2>Settings</h2>
          <button className="icon-button" aria-label="Close settings" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Dark mode</div>
            <div className="settings-row-sub">Preference is saved on this device</div>
          </div>
          <button
            className="theme-toggle"
            data-active={theme === "dark"}
            role="switch"
            aria-checked={theme === "dark"}
            aria-label="Toggle dark mode"
            onClick={onToggleTheme}
          >
            <span className="knob" />
          </button>
        </div>
      </div>
    </>
  );
}
