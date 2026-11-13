import { useState } from "react";
import { getForecastDraft, requestFormJump, setForecastDraft, type Range } from "../../lib/forecastDrafts";
import { navigate } from "../../lib/router";
import type { BaseFigure, EventDetail, WorksheetData } from "../../lib/types";
import {
  FORMULA_TEXT, SECTOR_INPUTS, type Result, type Sector, operatingMargin, rangeFrom, revenueGrowth, sectorKpi,
  startingMargin, unitsGrowth,
} from "../../lib/worksheet";

// Wording approved 2026-11-13 (Areas/Research workspace wording).
const PERCENT_HINT = "Change against the same quarter last year, in %. Use a minus sign for a fall.";
const MARGIN_PLAIN =
  "Costs take up (100% - margin) of every rupee of sales. If cost per unit rises faster than price per unit, costs " +
  "take a bigger share and the margin shrinks. If prices rise faster, the margin grows. The formula assumes every " +
  "cost moves with the number of units sold; use \"Other changes\" for anything that doesn't.";
const EXAMPLE =
  "Example: volume +10%, price +2% → (1 + 10%) x (1 + 2%) - 1 = 12.2%. Starting margin 15%, cost +4%, price +2% → " +
  "1 - 85% x 1.04 / 1.02 = 13.3%.";

function toNumber(text: string): number | null {
  if (text.trim() === "" || text.trim() === "-") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function initialText(ws: WorksheetData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(ws.inputs)) if (v !== null && v !== undefined) out[`in:${k}`] = String(v);
  for (const [k, v] of Object.entries(ws.unsure)) if (v !== null && v !== undefined) out[`unsure:${k}`] = String(v);
  if (ws.own_base !== null && ws.own_base !== undefined) out.own_base = String(ws.own_base);
  ws.units?.this_year.forEach((v, i) => v !== null && (out[`now:${i}`] = String(v)));
  ws.units?.last_year.forEach((v, i) => v !== null && (out[`then:${i}`] = String(v)));
  return out;
}

function NumberField({
  id, label, hint, unit, value, onChange, integer = false,
}: {
  id: string;
  label: string;
  hint?: string;
  unit?: string;
  value: string;
  onChange: (text: string) => void;
  integer?: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="input-wrap">
        <input
          id={id}
          className="input"
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          step={integer ? "1" : "0.1"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {unit && <span className="input-suffix">{unit}</span>}
      </div>
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function ResultRow({ label, result, formulaText }: { label: string; result: Result | null; formulaText: string }) {
  return (
    <div className="worksheet-result">
      <div className="worksheet-result-head">
        <span className="worksheet-result-label">{label}</span>
        <span className="worksheet-result-value">{result ? `${result.value.toFixed(1)}%` : "N/A"}</span>
      </div>
      <p className="worksheet-formula-caption">How this was worked out</p>
      <p className="worksheet-formula">{formulaText}</p>
      <p className="worksheet-formula worksheet-formula-numbers">
        {result ? result.formula : "Fill in the boxes above to see the result."}
      </p>
    </div>
  );
}

interface WorksheetProps {
  sector: Sector;
  event: EventDetail;
  worksheet: WorksheetData;
  onChange: (ws: WorksheetData) => void;
  lastYear: BaseFigure[];
  lastQuarter: BaseFigure[];
}

export default function Worksheet({ sector, event, worksheet, onChange, lastYear, lastQuarter }: WorksheetProps) {
  const [text, setText] = useState(() => initialText(worksheet));
  const [confirmReplace, setConfirmReplace] = useState(false);
  const spec = SECTOR_INPUTS[sector];
  const formulas = FORMULA_TEXT[sector];
  const hasKpi = event.metrics.some((m) => m.key === "sector_kpi");
  const pid = `ws-${event.id}`;

  function update(key: string, value: string, apply: (n: number | null, ws: WorksheetData) => WorksheetData) {
    setText((t) => ({ ...t, [key]: value }));
    onChange(apply(toNumber(value), worksheet));
  }
  const setInput = (k: string) => (v: string) =>
    update(`in:${k}`, v, (n, ws) => ({ ...ws, inputs: { ...ws.inputs, [k]: n } }));
  const setUnsure = (k: string) => (v: string) =>
    update(`unsure:${k}`, v, (n, ws) => ({ ...ws, unsure: { ...ws.unsure, [k]: n === null ? null : Math.abs(n) } }));
  const setUnits = (which: "this_year" | "last_year", i: number) => (v: string) =>
    update(`${which === "this_year" ? "now" : "then"}:${i}`, v, (n, ws) => {
      const units = ws.units ?? { this_year: [null, null, null], last_year: [null, null, null] };
      const list = [...units[which]];
      list[i] = n === null ? null : Math.round(n);
      return { ...ws, units: { ...units, [which]: list } };
    });

  const lyMargin = lastYear.find((f) => f.metric_key === "operating_margin");
  const lqMargin = lastQuarter.find((f) => f.metric_key === "operating_margin");
  const base = startingMargin(worksheet, lastYear, lastQuarter);
  const revenue = revenueGrowth(sector, worksheet);
  const margin = operatingMargin(sector, worksheet, base);
  const kpi = hasKpi ? sectorKpi(sector, worksheet) : null;
  const units = sector === "autos" ? unitsGrowth(worksheet.units) : null;

  const results: { key: string; label: string; result: Result | null; formula: string }[] = event.metrics.map((m) => ({
    key: m.key,
    label: m.label,
    result: m.key === "revenue_growth_yoy" ? revenue : m.key === "operating_margin" ? margin : kpi,
    formula: m.key === "revenue_growth_yoy" ? formulas.revenue : m.key === "operating_margin" ? formulas.margin : formulas.kpi,
  }));
  const ranges = results
    .map((r) => ({ key: r.key, range: rangeFrom(r.result, worksheet.unsure[r.key]) }))
    .filter((r): r is { key: string; range: { low: number; high: number } } => r.range !== null);

  function startFromWorksheet() {
    const existing = getForecastDraft(event.id);
    const unsaved = existing && Object.values(existing.ranges).some((r) => r.low !== "" || r.high !== "");
    if (unsaved && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    const filled: Record<string, Range> = { ...(existing?.ranges ?? {}) };
    for (const r of ranges) filled[r.key] = { low: String(r.range.low), high: String(r.range.high) };
    setForecastDraft(event.id, { ...existing, ranges: filled, fromWorksheet: true });
    setConfirmReplace(false);
    requestFormJump(event.id);
    navigate(`#/event/${event.id}`);
  }

  return (
    <section className="glass panel news-panel worksheet" aria-labelledby={`${pid}-title`}>
      <h2 className="panel-title" id={`${pid}-title`}>
        Driver worksheet
      </h2>
      <p className="section-text">
        Type your own assumptions. Stackly works out what they mean for revenue growth and the margin, and shows the
        formula. It never fills in a number for you.
      </p>

      <h3 className="subsection-title">Revenue</h3>
      <div className="worksheet-grid">
        {spec.revenue.map((f) => (
          <NumberField key={f.key} id={`${pid}-${f.key}`} label={f.label} unit="%" hint={PERCENT_HINT}
            value={text[`in:${f.key}`] ?? ""} onChange={setInput(f.key)} />
        ))}
      </div>

      {sector === "autos" && (
        <div className="worksheet-units">
          <h3 className="subsection-title">Units sold each month, from the company's sales releases</h3>
          <div className="worksheet-units-grid" role="group" aria-label="Units sold each month">
            <span />
            <span className="worksheet-units-head">This year</span>
            <span className="worksheet-units-head">Same months last year</span>
            {[0, 1, 2].map((i) => (
              <div className="worksheet-units-row" key={i}>
                <span className="worksheet-units-month">Month {i + 1}</span>
                <input className="input" type="number" inputMode="numeric" step="1" min="0"
                  aria-label={`Month ${i + 1}, this year`} value={text[`now:${i}`] ?? ""} onChange={(e) => setUnits("this_year", i)(e.target.value)} />
                <input className="input" type="number" inputMode="numeric" step="1" min="0"
                  aria-label={`Month ${i + 1}, same month last year`} value={text[`then:${i}`] ?? ""} onChange={(e) => setUnits("last_year", i)(e.target.value)} />
              </div>
            ))}
          </div>
          <p className="worksheet-formula">Units growth = (this year's total / last year's total) - 1</p>
          <p className="worksheet-formula worksheet-formula-numbers">
            {units ? units.formula : "Fill in the boxes above to see the result."}
          </p>
          {units && (
            <button type="button" className="btn btn-secondary btn-compact"
              onClick={() => setInput("volume")(units.value.toFixed(1))}>
              Use this as units growth
            </button>
          )}
        </div>
      )}

      <h3 className="subsection-title">Margin</h3>
      <fieldset className="field">
        <legend className="field-label">Start the margin from</legend>
        <div className="worksheet-base-options">
          {lyMargin && (
            <label className="checkbox-row">
              <input type="radio" name={`${pid}-base`} checked={worksheet.base === "last_year"}
                onChange={() => onChange({ ...worksheet, base: "last_year" })} />
              Last year's same quarter ({lyMargin.value.toFixed(1)}%, league figure)
            </label>
          )}
          {lqMargin && (
            <label className="checkbox-row">
              <input type="radio" name={`${pid}-base`} checked={worksheet.base === "last_quarter"}
                onChange={() => onChange({ ...worksheet, base: "last_quarter" })} />
              Last quarter ({lqMargin.value.toFixed(1)}%, league figure)
            </label>
          )}
          <label className="checkbox-row">
            <input type="radio" name={`${pid}-base`} checked={worksheet.base === "own"}
              onChange={() => onChange({ ...worksheet, base: "own" })} />
            My own number
          </label>
        </div>
        <p className="field-hint">
          {lqMargin
            ? "Pick a starting point. Last year's same quarter is the base growth is measured against; last quarter is the most recent."
            : "Pick a starting point. Last year's same quarter is the base growth is measured against."}
        </p>
      </fieldset>
      {worksheet.base === "own" && (
        <NumberField id={`${pid}-own`} label="My own starting margin" unit="%" value={text.own_base ?? ""}
          onChange={(v) => update("own_base", v, (n, ws) => ({ ...ws, own_base: n }))} />
      )}
      <div className="worksheet-grid">
        {spec.margin.map((f) => (
          <NumberField key={f.key} id={`${pid}-${f.key}`} label={f.unit === "points" ? `${f.label}, in percentage points` : f.label}
            unit={f.unit === "%" ? "%" : "pts"} hint={f.unit === "%" ? PERCENT_HINT : "Use a minus sign for a fall."}
            value={text[`in:${f.key}`] ?? ""} onChange={setInput(f.key)} />
        ))}
        <NumberField id={`${pid}-other`} label="Other changes to the margin, in percentage points" unit="pts"
          hint="Anything the formula leaves out, such as costs that don't grow with volume (rent, head-office salaries) or one-off items."
          value={text["in:other"] ?? ""} onChange={setInput("other")} />
      </div>

      <h3 className="subsection-title">Results</h3>
      <div className="worksheet-results">
        {results.map((r) => (
          <div className="worksheet-result-block" key={r.key}>
            <ResultRow label={r.label} result={r.result} formulaText={r.formula} />
            {r.key === "operating_margin" && sector !== "it" && <p className="footnote">{MARGIN_PLAIN}</p>}
            <NumberField id={`${pid}-unsure-${r.key}`} label="How unsure are you? ± percentage points" unit="pts"
              hint="Half the width of your range." value={text[`unsure:${r.key}`] ?? ""} onChange={setUnsure(r.key)} />
          </div>
        ))}
      </div>
      <p className="footnote">{EXAMPLE}</p>

      {confirmReplace && (
        <div className="callout worksheet-confirm" role="alertdialog" aria-label="Replace unsaved numbers">
          <p>
            This replaces the unsaved numbers in your forecast form. Your saved forecast doesn't change until you press
            Save.
          </p>
          <div className="worksheet-confirm-actions">
            <button type="button" className="btn btn-primary btn-compact" onClick={startFromWorksheet}>
              Replace
            </button>
            <button type="button" className="btn btn-tertiary btn-compact" onClick={() => setConfirmReplace(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {!confirmReplace && (
        <div className="worksheet-actions">
          <button type="button" className="btn btn-secondary" disabled={ranges.length === 0} onClick={startFromWorksheet}
            aria-describedby={ranges.length === 0 ? `${pid}-copy-hint` : undefined}>
            Use as a starting point
          </button>
          {ranges.length === 0 && (
            <p className="field-hint" id={`${pid}-copy-hint`}>
              Fill in a result and how unsure you are first.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
