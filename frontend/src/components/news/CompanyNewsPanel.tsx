import { useEffect, useState } from "react";
import { ApiError, fetchCompanyNews } from "../../lib/api";
import type { CompanyNews, Filing } from "../../lib/types";
import { formatDay } from "../../lib/leagueFormat";
import NewsSourceNote from "./NewsSourceNote";
import NewsCards from "./NewsCards";
import WorldEvents from "./WorldEvents";
import MacroCharts from "./MacroCharts";
import VideoCards from "./VideoCards";
import { useWhyItMatters, WhySummary } from "./WhyItMatters";

function FilingRow({ f }: { f: Filing }) {
  const why = useWhyItMatters<HTMLButtonElement>({ title: "Why it matters", chain: f.chain, explanation: f.explanation });
  return (
    <li className="news-row reveal-row">
      <a className="news-headline" href={f.url} target="_blank" rel="noopener noreferrer">
        {f.subject}
        <span className="visually-hidden"> (opens the filing on NSE)</span>
      </a>
      <div className="news-meta">
        NSE · {formatDay(f.filed_at, true)}
        {f.type_label && <span className="chip chip-static">{f.type_label}</span>}
      </div>
      {f.why && <WhySummary summary={f.why} triggerProps={why.triggerProps} has={why.has} />}
      {why.overlay}
    </li>
  );
}

// A company's exchange filings and news on the Research page. Filings and
// company headlines exist only for the league's companies for now.
export default function CompanyNewsPanel({ symbol, name }: { symbol: string; name: string }) {
  const [data, setData] = useState<CompanyNews | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchCompanyNews(symbol)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't load the news."));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (error) return <div className="form-error">{error}</div>;
  if (!data) return null;

  return (
    <>
      <section className="glass panel reveal news-panel company-news" aria-labelledby="company-news-title">
        <h2 className="panel-title" id="company-news-title">
          News and announcements
        </h2>

        <h3 className="subsection-title">Exchange filings</h3>
        {data.filings.length > 0 ? (
          <>
            <ul className="group news-list">
              {data.filings.map((f) => (
                <FilingRow key={f.url} f={f} />
              ))}
            </ul>
            <p className="footnote">
              Filings we captured from NSE's announcements feed
              {data.filings_since ? ` since ${formatDay(data.filings_since, true)}` : ""}.{" "}
              <a href={data.nse_url} target="_blank" rel="noopener noreferrer">
                See every filing on NSE
              </a>
              .
            </p>
          </>
        ) : (
          <p className="empty-note">
            {data.tracked ? "No filings captured yet. " : ""}
            <a href={data.nse_url} target="_blank" rel="noopener noreferrer">
              See the latest filings for {name} on NSE
            </a>
            .
          </p>
        )}

        {data.tracked && (
          <>
            <h3 className="subsection-title">In the news</h3>
            {data.company_news.length > 0 ? (
              <NewsCards items={data.company_news} topStory={false} />
            ) : (
              <p className="empty-note">No recent headlines about {name} on results, orders, prices, plants or management.</p>
            )}
          </>
        )}

        <h3 className="subsection-title">{data.sector ? `${data.sector_label} and the economy` : "The economy"}</h3>
        {data.sector_news.length > 0 ? (
          <NewsCards items={data.sector_news} topStory={false} />
        ) : (
          <p className="empty-note">No recent headlines on these topics yet.</p>
        )}
        <NewsSourceNote updatedAt={data.updated_at} />
      </section>

      <VideoCards videos={data.videos ?? []} />
      <WorldEvents events={data.world_events} title={`World events for ${data.sector ? data.sector_label : "the economy"}`} />
      {data.macro.length > 0 && <MacroCharts series={data.macro} title={`Macro context for ${data.sector_label}`} />}
    </>
  );
}
