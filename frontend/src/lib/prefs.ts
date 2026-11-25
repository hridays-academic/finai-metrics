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

// Phase 6 cosmetics (unlocked by level; services/progress.py UNLOCKS). Chosen
// on each device; theme-init.js applies them before the first paint.
export type BallFinish = "pearl" | "silver" | "copper" | "glass";
export type SlabColour = "dark" | "blue" | "green";
export const BALLS: { value: BallFinish; label: string; unlock: string | null }[] = [
  { value: "pearl", label: "Pearl", unlock: null },
  { value: "silver", label: "Silver", unlock: "ball_silver" },
  { value: "copper", label: "Copper", unlock: "ball_copper" },
  { value: "glass", label: "Glass", unlock: "ball_glass" },
];
export const SLABS: { value: SlabColour; label: string; unlock: string | null }[] = [
  { value: "dark", label: "Standard", unlock: null },
  { value: "blue", label: "Blue", unlock: "slab_blue" },
  { value: "green", label: "Green", unlock: "slab_green" },
];
export const getBall = (): BallFinish => (read("stackly-ball") as BallFinish | null) ?? "pearl";
export const getSlab = (): SlabColour => (read("stackly-slab") as SlabColour | null) ?? "dark";
export function setBall(b: BallFinish): void {
  write("stackly-ball", b);
  if (b === "pearl") document.documentElement.removeAttribute("data-ball");
  else document.documentElement.setAttribute("data-ball", b);
}
export function setSlab(s: SlabColour): void {
  write("stackly-slab", s);
  if (s === "dark") document.documentElement.removeAttribute("data-slab");
  else document.documentElement.setAttribute("data-slab", s);
}
