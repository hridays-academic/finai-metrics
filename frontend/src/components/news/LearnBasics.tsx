import { useState } from "react";

// RW8/T8/X1 (master plan phase 7): Zerodha Varsity's reading list and two
// teaching videos, as approved by Hriday at Stop 1 (decisions item 9; all
// links checked live 24 Nov). Links only; videos use YouTube's official
// youtube-nocookie player and load only when clicked. FMCG has no Varsity
// chapter, so it has no sector link. Heading and intro are DRAFT wording.

export const VARSITY: { concept: string; links: { label: string; url: string }[] }[] = [
  { concept: "What fundamental analysis is", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/introduction-fundamental-analysis/" }] },
  { concept: "Reading the annual report", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/read-annual-report-company/" }] },
  { concept: "Revenue and the P&L, part 1", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/understanding-pl-statement-part1/" }] },
  { concept: "The P&L, part 2 (costs, profit)", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/understanding-pl-statement-part2/" }] },
  { concept: "Margins (EBITDA margin)", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/financial-ratio-analysis/" }] },
  { concept: "Operating ratios", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/financial-ratios-part-2/" }] },
  { concept: "Sector analysis overview", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/sector-analysis-overview/" }] },
  { concept: "Cement", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/cement/" }] },
  {
    concept: "Autos",
    links: [
      { label: "Part 1", url: "https://zerodha.com/varsity/chapter/automobiles-part-1/" },
      { label: "Part 2", url: "https://zerodha.com/varsity/chapter/automobiles-part-2/" },
    ],
  },
  { concept: "IT services (dollar revenue, the rupee)", links: [{ label: "Read", url: "https://zerodha.com/varsity/chapter/information-technology/" }] },
];

export const VIDEOS = [
  { id: "8rUc0MaMzik", title: "Zerodha Varsity | 1. Introduction to fundamental analysis" },
  { id: "fTIOzRPOXsk", title: "Zerodha | How to read an annual report with Karthik Rangappa" },
];

function Video({ id, title }: { id: string; title: string }) {
  const [on, setOn] = useState(false);
  return (
    <figure className="learn-video">
      {on ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      ) : (
        <button type="button" className="learn-video-start" onClick={() => setOn(true)}>
          <span className="learn-video-play" aria-hidden="true" />
          <span>Play: {title}</span>
        </button>
      )}
      <figcaption>Zerodha Varsity on YouTube</figcaption>
    </figure>
  );
}

export default function LearnBasics() {
  return (
    <section className="glass panel learn-basics" aria-labelledby="learn-basics-title">
      <h2 className="panel-title" id="learn-basics-title">
        Learn the basics
      </h2>
      <p className="section-text">Short chapters from Zerodha Varsity, a free course, on the ideas behind the league's numbers.</p>
      <ul className="learn-list">
        {VARSITY.map((v) => (
          <li key={v.concept}>
            <span>{v.concept}</span>
            <span className="learn-links">
              {v.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.label}
                  <span className="visually-hidden"> {v.concept} on Zerodha Varsity (opens in a new tab)</span>
                </a>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="footnote">Reading list: Zerodha Varsity.</p>
      <div className="learn-videos">
        {VIDEOS.map((v) => (
          <Video key={v.id} {...v} />
        ))}
      </div>
    </section>
  );
}
