import SiteFooter from "../SiteFooter";
import { HeroWaves } from "../league/CardArt";

// #/schools (phase 8: SC6, SC7, H15). "For schools" approved (2.41); the rest
// is DRAFT wording for Hriday's approval.

const LESSON: { minutes: string; step: string; detail: string }[] = [
  { minutes: "0 to 8", step: "How it works", detail: "Open the 10-page guide on the projector (How to play). Ask: what is a range, and why would a narrow one score more?" },
  { minutes: "8 to 25", step: "Three quick rounds", detail: "Start classroom mode from your class page. Students answer on their phones; you reveal each card. Before each reveal, look at the class's average range together." },
  { minutes: "25 to 35", step: "Discussion", detail: "Use the questions below. Pick one card the class missed and ask what they would look at next time." },
  { minutes: "35 to 40", step: "The season", detail: "Show Home's season calendar. Each student picks one company to forecast before its results date, and joins the class board." },
];

const QUESTIONS = [
  "Why did last year's figure make a good starting point? When did it mislead you?",
  "Which number was hardest to forecast, and why?",
  "Your ranges should catch the result about 8 times in 10. Did the class's ranges do that? Too wide or too narrow?",
  "What happened in the world this quarter that might change a company's numbers?",
];

const DOMAINS: { domain: string; why: string }[] = [
  { domain: "stackslymetrics.com", why: "The site and its data (everything else is optional)" },
  { domain: "accounts.google.com", why: "Only for Sign in with Google" },
  { domain: "www.youtube-nocookie.com", why: "Only when a student presses play on a video" },
  { domain: "zerodha.com", why: "Only for the Zerodha Varsity reading list (links)" },
];

export default function SchoolsPage() {
  return (
    <div className="page schools-page">
      <header className="page-hero">
        <HeroWaves />
        <h1 className="hero-title">For schools</h1>
        <p className="hero-lede">Stackly is free. Students forecast real Indian companies' results as ranges and learn how revenue and margins move.</p>
      </header>

      <section className="glass panel" aria-labelledby="schools-start">
        <h2 className="section-title" id="schools-start">
          Getting started
        </h2>
        <ol className="schools-steps">
          <li>Create an account, then email stackly.user.support@gmail.com from your school address to ask for a teacher account.</li>
          <li>On your Classes page, create a class. You get a 6-character code to share with students.</li>
          <li>Students join with the code. Under-18s need a parent's approval before anything they play is saved. For the January pilot, print the parent approval form, collect the signed copies, and mark each one received on your class page; Stackly then records it.</li>
          <li>Your class page shows who has played, rounds played, average scores and the companies forecast. Students appear by handle only.</li>
        </ol>
        <p className="section-text">
          <a href="#/consent-form">Printable parent approval form</a> · <a href="#/classes">Your classes</a>
        </p>
      </section>

      <section className="glass panel" aria-labelledby="schools-lesson">
        <h2 className="section-title" id="schools-lesson">
          A 40-minute lesson
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Minutes</th>
                <th scope="col">Step</th>
                <th scope="col">What to do</th>
              </tr>
            </thead>
            <tbody>
              {LESSON.map((l) => (
                <tr key={l.step}>
                  <td>{l.minutes}</td>
                  <th scope="row">{l.step}</th>
                  <td>{l.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="me-group-title">Discussion questions</h3>
        <ul>
          {QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </section>

      <section className="glass panel" aria-labelledby="schools-it">
        <h2 className="section-title" id="schools-it">
          For your school's IT team
        </h2>
        <p className="section-text">Stackly has no ads or trackers and loads its fonts from its own site. Please allow:</p>
        <ul>
          {DOMAINS.map((d) => (
            <li key={d.domain}>
              <code>{d.domain}</code>: {d.why}
            </li>
          ))}
        </ul>
        <p className="section-text">It works on a basic Chromebook and a slow connection.</p>
      </section>
      <SiteFooter />
    </div>
  );
}
