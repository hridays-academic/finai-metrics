import { useState } from "react";
import type { CompanyProfile } from "../lib/types";
import { formatDay } from "../lib/leagueFormat";

// Distinct, theme-aware shades for up to six segments (tokens in app.css).
const SEGMENT_CLASSES = ["seg-1", "seg-2", "seg-3", "seg-4", "seg-5", "seg-6"];

function crore(v: number): string {
  return `₹${Math.round(v).toLocaleString("en-IN")} cr`;
}

// What the company does, its segments as one bar, and official documents.
export default function CompanyProfilePanel({ profile, name }: { profile: CompanyProfile; name: string }) {
  const [more, setMore] = useState(false);
  const long = (profile.description?.length ?? 0) > 420;
  const text = profile.description && long && !more ? `${profile.description.slice(0, 400).trimEnd()}...` : profile.description;
  const bar = profile.segments.filter((s) => s.revenue_cr > 0);

  return (
    <section className="glass panel reveal news-panel company-profile" aria-labelledby="profile-title">
      <h2 className="panel-title" id="profile-title">
        About {name}
      </h2>
      {text && (
        <p className="profile-description">
          {text}{" "}
          {long && (
            <button type="button" className="link-button" onClick={() => setMore((v) => !v)}>
              {more ? "Show less" : "Read more"}
            </button>
          )}
        </p>
      )}
      {profile.description_source && (
        <p className="footnote">
          {profile.description_source === "Stackly" ? "Description written by Stackly." : "Description from Yahoo Finance."}
        </p>
      )}

      <dl className="profile-facts">
        <div>
          <dt>Headquarters</dt>
          <dd>{profile.headquarters ?? "N/A"}</dd>
        </div>
        <div>
          <dt>Employees</dt>
          <dd>{profile.employees ? profile.employees.toLocaleString("en-IN") : "N/A"}</dd>
        </div>
        <div>
          <dt>Next results</dt>
          <dd>{profile.next_results_date ? formatDay(profile.next_results_date, true) : "Not scheduled on Stackly"}</dd>
        </div>
        <div>
          <dt>Website</dt>
          <dd>
            {profile.website ? (
              <a href={profile.website} target="_blank" rel="noopener noreferrer">
                {profile.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            ) : (
              "N/A"
            )}
          </dd>
        </div>
      </dl>

      {(profile.single_business || profile.segments.length > 0) && (
        <>
          <h3 className="subsection-title">Where revenue comes from</h3>
          {profile.single_business ? (
            <p className="section-text">Single business. {profile.segment_note}</p>
          ) : (
            <>
              <div className="segment-bar" role="img" aria-label={profile.segments.map((s) => `${s.label} ${s.share_pct}%`).join(", ")}>
                {bar.map((s, i) => (
                  <span key={s.label} className={`segment-bar-part ${SEGMENT_CLASSES[i % 6]}`} style={{ flexGrow: s.revenue_cr }} />
                ))}
              </div>
              <ul className="segment-legend">
                {profile.segments.map((s, i) => (
                  <li key={s.label}>
                    <span className={`segment-swatch ${s.revenue_cr > 0 ? SEGMENT_CLASSES[i % 6] : "seg-neg"}`} aria-hidden="true" />
                    <span className="segment-label">{s.label}</span>
                    <span className="segment-value">
                      {s.share_pct}% · {crore(s.revenue_cr)}
                    </span>
                  </li>
                ))}
              </ul>
              {profile.segment_note && <p className="section-text">{profile.segment_note}</p>}
            </>
          )}
          <p className="footnote">
            {profile.segment_period}, from the company's{" "}
            {profile.segment_source_url ? (
              <a href={profile.segment_source_url} target="_blank" rel="noopener noreferrer">
                audited results
              </a>
            ) : (
              "audited results"
            )}
            .
          </p>
        </>
      )}

      <h3 className="subsection-title">Official documents</h3>
      <ul className="group doc-list">
        {profile.documents.map((d) => (
          <li key={d.url}>
            <a href={d.url} target="_blank" rel="noopener noreferrer">
              {d.label}
            </a>
            <span className="doc-meta">
              {d.source}
              {d.date ? ` · ${formatDay(d.date, true)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
