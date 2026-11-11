import { formatDay } from "../../lib/leagueFormat";

export default function NewsSourceNote({ updatedAt }: { updatedAt: string | null }) {
  return (
    <p className="footnote">
      Headlines and links only, from the publishers' own sites. News index:{" "}
      <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener noreferrer">
        GDELT Project
      </a>
      ; RBI items from the RBI's press releases. The "why it may matter" lines are Stackly's own, matched by topic, not
      a summary of the article.{updatedAt ? ` Updated ${formatDay(updatedAt, true)}.` : ""}
    </p>
  );
}
