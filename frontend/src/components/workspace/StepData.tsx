// What Stackly already has for each workspace step, using the same panels as
// the company and Research pages. Missing data says so and where to look.
import type { ReactNode } from "react";
import { formatDay } from "../../lib/leagueFormat";
import type {
  BaseFigure, CompanyFinancialsResponse, CompanyNews, EventDetail, LeagueConfig, ResearchHistory, Workspace,
} from "../../lib/types";
import AnalysisPanel from "../AnalysisPanel";
import CompanyProfilePanel, { DocumentList } from "../CompanyProfilePanel";
import { selfSummary } from "../MetricsDashboard";
import PeersPanel, { usePeers } from "../PeersPanel";
import SectorExplainer from "../league/SectorExplainer";
import { QuartersTable } from "../league/ResearchPanel";
import MacroCharts from "../news/MacroCharts";
import NewsCards from "../news/NewsCards";
import WorldEvents from "../news/WorldEvents";

export interface StepDataProps {
  step: string;
  event: EventDetail;
  config: LeagueConfig;
  workspace: Workspace;
  history: ResearchHistory | null;
  historyError: string | null;
  company: CompanyFinancialsResponse | null;
  news: CompanyNews | null;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass panel news-panel workspace-data">
      <h2 className="panel-title">{title}</h2>
      {children}
    </section>
  );
}

function Missing({ name, where }: { name: string; where: string }) {
  return (
    <p className="empty-note">
      Stackly doesn't have this for {name}. {where}
    </p>
  );
}

function FiguresTable({ event, figures }: { event: EventDetail; figures: BaseFigure[] }) {
  const label = (key: string) => event.metrics.find((m) => m.key === key)?.label ?? key;
  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>
                {figures[0].fiscal_year_label} Q{figures[0].fiscal_quarter}
              </th>
            </tr>
          </thead>
          <tbody>
            {figures.map((f) => (
              <tr key={f.metric_key}>
                <td>{label(f.metric_key)}</td>
                <td>
                  <a href={f.source_url} target="_blank" rel="noopener noreferrer">
                    {f.value.toFixed(1)}%<span className="visually-hidden"> (opens the source filing)</span>
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        From the company's filings under this league's definitions (links open the source). These are the same
        definitions your forecast is scored on.
      </p>
    </>
  );
}

function NewsStep({ event, workspace, company, news }: StepDataProps) {
  const peers = company?.profile?.peers ?? [];
  const rows = usePeers(peers);
  const since = workspace.news_since;
  const recent = (items: CompanyNews["company_news"]) => (since ? items.filter((i) => i.published_at.slice(0, 10) >= since) : items);
  const items = news ? [...recent(news.company_news), ...recent(news.sector_news)] : [];
  const name = event.company.name;
  return (
    <>
      <Panel title={since ? `News since ${formatDay(since, true)}` : "Recent news"}>
        {!news ? (
          <p className="empty-note">Loading...</p>
        ) : items.length > 0 ? (
          <NewsCards items={items} topStory={false} />
        ) : (
          <Missing name={name} where="Check the company's own announcements and a business newspaper." />
        )}
      </Panel>
      {news && news.world_events.length > 0 && (
        <WorldEvents events={news.world_events} title={`World events for ${news.sector_label}`} />
      )}
      {company && peers.length > 0 && <PeersPanel self={selfSummary(company)} peers={peers} rows={rows} />}
    </>
  );
}

export default function StepData(props: StepDataProps) {
  const { step, event, config, workspace, history, historyError, company, news } = props;
  const name = event.company.name;
  const explainer = config.sector_explainers.find((e) => e.sector === event.company.sector);
  const kpiTemplate = config.kpi_templates.find((t) => t.sector === event.company.sector);
  const kpi = event.metrics.find((m) => m.key === "sector_kpi");

  switch (step) {
    case "business":
      return (
        <>
          {explainer && <SectorExplainer explainer={explainer} />}
          {company?.profile && <CompanyProfilePanel profile={company.profile} name={name} showDocuments={false} />}
          <Panel title="The numbers you forecast">
            <dl className="workspace-definitions">
              {event.metrics.map((m) => (
                <div key={m.key}>
                  <dt>{m.label}</dt>
                  <dd>{m.definition}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </>
      );
    case "base":
      return (
        <Panel title="Last year's same quarter">
          {workspace.last_year.length > 0 ? (
            <FiguresTable event={event} figures={workspace.last_year} />
          ) : (
            <Missing name={name} where="The company's results filing for that quarter has it." />
          )}
        </Panel>
      );
    case "trend":
      return (
        <>
          <Panel title="The recent trend">
            <QuartersTable event={event} history={history} historyError={historyError} />
          </Panel>
          {company?.analysis && (
            <AnalysisPanel
              analysis={{
                ...company.analysis,
                sections: company.analysis.sections.filter((s) => s.key === "growth" || s.key === "margins"),
                questions: [],
              }}
              peers={{}}
              fetchedAt={company.fundamentals_as_of}
            />
          )}
        </>
      );
    case "said": {
      const filings = news?.filings ?? [];
      const documents = company?.profile?.documents ?? [];
      return (
        <Panel title="Filings and documents">
          {filings.length > 0 && (
            <ul className="group doc-list">
              {filings.slice(0, 8).map((f) => (
                <li key={f.url}>
                  <a href={f.url} target="_blank" rel="noopener noreferrer">
                    {f.subject}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {documents.length > 0 && <DocumentList documents={documents} />}
          {filings.length === 0 && documents.length === 0 && (
            <Missing name={name} where="The company's investor relations page has its results and presentations." />
          )}
          {news && (
            <p className="footnote">
              <a href={news.nse_url} target="_blank" rel="noopener noreferrer">
                See every filing on NSE
              </a>
              .
            </p>
          )}
        </Panel>
      );
    }
    case "clues":
      return kpi ? (
        <Panel title={kpi.label}>
          <p className="section-text">{kpi.definition}</p>
          {kpiTemplate && <p className="field-hint">{kpiTemplate.source_hint}</p>}
          {news && (
            <p className="footnote">
              <a href={news.nse_url} target="_blank" rel="noopener noreferrer">
                See every filing on NSE
              </a>
              .
            </p>
          )}
        </Panel>
      ) : null;
    case "prices": {
      const term = workspace.glossary.find((g) => g.term === "Price and mix");
      const priced = (news?.company_news ?? []).filter((n) => /\bprice/i.test(n.title));
      return (
        <>
          {term && (
            <aside className="callout callout-tip">
              <div>
                <div className="callout-label">{term.term}</div>
                <p>{term.definition}</p>
              </div>
            </aside>
          )}
          {priced.length > 0 && (
            <Panel title="Headlines about prices">
              <NewsCards items={priced} topStory={false} />
            </Panel>
          )}
        </>
      );
    }
    case "costs":
      return news && news.macro.length > 0 ? <MacroCharts series={news.macro} title={`Costs and prices for ${news.sector_label}`} /> : null;
    case "news":
      return <NewsStep {...props} />;
    default:
      return null;
  }
}
