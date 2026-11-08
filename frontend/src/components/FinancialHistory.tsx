import type { HistoryRow, HistoryTable } from "../lib/types";
import { formatDay } from "../lib/leagueFormat";
import { formatAmount } from "../lib/format";
import QuarterSparkline from "./league/QuarterSparkline";

const NA = <span className="cell-na">N/A</span>;

// Rupee amounts in crore; the rare company Yahoo reports in another currency in millions.
function amount(value: number, currency: string): string {
  if (currency !== "INR") return formatAmount(value, currency);
  return `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr`;
}

function pct(value: number | null) {
  return value === null ? NA : `${value.toFixed(1)}%`;
}

function monthYear(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

// Indian companies mostly close their year in March: "FY26" is April 2025 to March 2026.
function fiscalYear(iso: string): string {
  return iso.slice(5, 7) === "03" ? `FY${iso.slice(2, 4)}` : `Year to ${monthYear(iso)}`;
}

interface PeriodProps {
  rows: HistoryRow[];
  title: string;
  label: (iso: string) => string;
  currency: string;
}

function Period({ rows, title, label, currency }: PeriodProps) {
  const money = (v: number | null) => (v === null ? NA : amount(v, currency));
  const oldestFirst = [...rows].reverse();
  const labels = oldestFirst.map((r) => label(r.period_end_date));
  return (
    <>
      <h3 className="subsection-title">{title}</h3>
      <div className="quarters-layout">
        <div className="quarters-trends">
          <QuarterSparkline label="Revenue" values={oldestFirst.map((r) => r.revenue)} quarterLabels={labels} format={(v) => amount(v, currency)} />
          <QuarterSparkline
            label="EBITDA margin"
            values={oldestFirst.map((r) => r.ebitda_margin_pct)}
            quarterLabels={labels}
            format={(v) => `${v.toFixed(1)}%`}
          />
        </div>
        <div className="table-wrap">
          <table className="data-table league-history-table">
            <thead>
              <tr>
                <th>{title.includes("year") ? "Year" : "Quarter"}</th>
                <th>Revenue</th>
                <th>EBITDA</th>
                <th>EBITDA margin</th>
                <th>Net profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period_end_date}>
                  <td>{label(r.period_end_date)}</td>
                  <td>{money(r.revenue)}</td>
                  <td>{money(r.ebitda)}</td>
                  <td>{pct(r.ebitda_margin_pct)}</td>
                  <td>{money(r.net_income)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// Five years and eight quarters of revenue, EBITDA, margin and profit, from
// the same Yahoo download as the ratios. Periods Yahoo lacks show as N/A.
interface FinancialHistoryProps {
  history: HistoryTable;
  fetchedAt: string | null | undefined;
  currency: string;
}

export default function FinancialHistory({ history, fetchedAt, currency }: FinancialHistoryProps) {
  return (
    <section className="glass panel reveal financial-history" aria-labelledby="history-title">
      <h2 className="panel-title" id="history-title">
        Financial history
      </h2>
      {history.annual.length > 0 ? (
        <Period rows={history.annual} title="Last 5 years" label={fiscalYear} currency={currency} />
      ) : (
        <p className="empty-note">Yahoo Finance has no yearly figures for this company.</p>
      )}
      <Period rows={history.quarterly} title="Last 8 quarters" label={monthYear} currency={currency} />
      <p className="footnote">
        Yahoo Finance, consolidated figures as Yahoo reports them, fetched {formatDay(fetchedAt ?? new Date().toISOString(), true)}.
        EBITDA is operating profit plus depreciation and amortisation, so it leaves out other income. Yahoo's revenue can
        be up to about 3% below the revenue from operations in the company's own filing, which makes margins look slightly
        higher. N/A means Yahoo doesn't have that period.
        {currency !== "INR" && ` Yahoo reports this company's accounts in ${currency}, so amounts are in ${currency}.`}
      </p>
    </section>
  );
}
