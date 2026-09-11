import CoinIcon from "./CoinIcon";
import { formatCoinPrice, formatCoins, formatSignedCoinPrice, formatSignedCoins } from "../lib/coins";

interface CoinAmountProps {
  value: number;
  // Adds a +/- sign for gains/losses (P&L figures).
  signed?: boolean;
  // 2-decimal per-share precision instead of a rounded whole amount --
  // for live prices/avg buy price, not aggregate totals.
  price?: boolean;
}

// Icon + number rendered together as one inline unit, with real spacing
// between them (see app.css's .coin-amount) -- replaces the old pattern of
// gluing a 🪙 emoji directly onto the formatted string, which read as
// cluttered rather than a clean currency label.
export default function CoinAmount({ value, signed, price }: CoinAmountProps) {
  const text = price
    ? signed
      ? formatSignedCoinPrice(value)
      : formatCoinPrice(value)
    : signed
      ? formatSignedCoins(value)
      : formatCoins(value);

  return (
    <span className="coin-amount">
      <CoinIcon />
      {text}
    </span>
  );
}
