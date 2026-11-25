// K5 (master plan): the Settings menu's on-this-device preferences. Sound is
// off by default (classrooms); vibration on; motion follows the device unless
// the student picks "Reduced". Stored in localStorage (try/catch: blocked
// storage just means the defaults).
export type MotionPref = "full" | "reduced";

const KEYS = { sound: "stackly-sound", vibration: "stackly-vibration", motion: "stackly-motion" } as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: applies for this visit only
  }
}

export const getSound = (): boolean => read(KEYS.sound) === "on";
export const setSound = (on: boolean): void => write(KEYS.sound, on ? "on" : "off");
export const getVibration = (): boolean => read(KEYS.vibration) !== "off";
export const setVibration = (on: boolean): void => write(KEYS.vibration, on ? "on" : "off");
export const getMotion = (): MotionPref => (read(KEYS.motion) === "reduced" ? "reduced" : "full");
export function setMotion(m: MotionPref): void {
  write(KEYS.motion, m);
  if (m === "reduced") document.documentElement.setAttribute("data-motion", "reduced");
  else document.documentElement.removeAttribute("data-motion");
}
