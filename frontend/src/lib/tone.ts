export type Tone = "good" | "warning" | "bad" | "neutral";

const VERDICT_TONE: Record<string, Tone> = {
  "Strong Fundamentals": "good",
  "Mixed Fundamentals": "warning",
  "Weak Fundamentals": "bad",
  "Not Enough Data": "neutral",
};

export function healthVerdictTone(verdict: string): Tone {
  return VERDICT_TONE[verdict] ?? "neutral";
}

export function consensusTone(label: string): Tone {
  if (label === "Buy") return "good";
  if (label === "Sell") return "bad";
  return "neutral";
}
