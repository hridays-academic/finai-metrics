import SiteFooter from "./SiteFooter";

// The Privacy Policy and Terms of Use (#/privacy, #/terms), approved by
// Hriday 2026-11-05. Placeholders in [BRACKETS] are his to fill in. If
// either page changes materially, bump auth_service.TERMS_VERSION so every
// account is asked to agree again. Never add a claim of legal compliance.

export const LEGAL_UPDATED = "5 November 2026";

type Block = string | { list: string[] };
interface Section {
  heading: string;
  body: Block[];
}

const PRIVACY: Section[] = [
  {
    heading: "",
    body: [
      "Stackly is an educational forecasting game run by [YOUR NAME]. This page explains what we collect, why we collect it, and what you can do about it.",
    ],
  },
  {
    heading: "What we collect",
    body: [
      {
        list: [
          "Account: your email address and name. If you sign up with a password, we store only a scrambled (hashed) version of it, never the password itself. If you sign in with Google, we store your Google account ID.",
          "League profile: your handle (a public nickname), your age band (under 18, or 18 and over), your school if you choose to give it, and, for under-18 players, a record of a parent or guardian's consent: their name, how they gave it and the date.",
          "Forecasts: the ranges you submit, any reason tags or short note, when you submitted them, and the scores they earn.",
          "Sign-in sessions: a random code that keeps you signed in for up to 30 days.",
          "Activity: when you sign up or sign in, and which companies you look up on the Research page while signed in. You can see this list in your account panel.",
          "Password resets: a one-time link that works for 30 minutes.",
          "Abuse protection: a scrambled (hashed) form of your IP address, kept for about an hour so we can limit how many requests one connection makes.",
          "Visit counts: how many times each page is opened per day, as totals only. These aren't linked to you.",
        ],
      },
      "We don't collect your phone number, home address, date of birth, location or payment details.",
    ],
  },
  {
    heading: "Why we collect it",
    body: [
      "To run your account, keep you signed in, run and score the league, show your results, protect the site from abuse, handle consent for under-18 players, and answer your questions.",
    ],
  },
  {
    heading: "Where it's stored",
    body: [
      {
        list: [
          "Our database: Neon, in the United States.",
          "The website and server: Vercel, in the United States. Vercel keeps short-lived technical logs, such as IP addresses and the pages requested, as part of hosting the site.",
          "Password-reset emails: sent through Gmail.",
          "Google: every page loads fonts and the Sign in with Google button from Google, so Google receives your IP address and browser details, and may set its own cookies. Google's privacy policy covers that.",
        ],
      },
      "This means your data is stored and processed outside India.",
    ],
  },
  {
    heading: "Your browser",
    body: [
      "We save your sign-in code and display settings in your browser's local storage. We don't use advertising or tracking cookies.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      {
        list: [
          "Account and profile: until you delete your account.",
          "Activity: 12 months, then deleted automatically.",
          "Sign-in sessions: 30 days, or until you sign out.",
          "Password-reset links: 30 minutes.",
          "Scrambled IP addresses for abuse protection: about an hour.",
          "Your forecasts after you delete your account: kept without your name or anything that links them to you, so scores and group results stay correct. Any notes you wrote are deleted.",
        ],
      },
    ],
  },
  {
    heading: "No ads, tracking or selling",
    body: [
      "We don't show ads, we don't use analytics or tracking tools, and we never sell, rent or trade your data. We share it only with the services listed above that run the site, or when the law requires us to.",
    ],
  },
  {
    heading: "Who can see what",
    body: [
      {
        list: [
          "Other players: your handle and scores may appear on results and leaderboards. Group (\"crowd\") figures combine many people's forecasts and only appear once at least 5 people have forecast. Other players never see your email, name, age band or school.",
          "The people who run Stackly: they can see account details to run the league, record consent and deal with abuse.",
        ],
      },
    ],
  },
  {
    heading: "If you're under 18",
    body: [
      {
        list: [
          "You choose your age band once, when you join the league.",
          "You can browse and research, but you can't submit league forecasts until we have a parent or guardian's consent, by signed form or by email from the parent, recorded by us.",
          "A parent or guardian can withdraw consent at any time by emailing [CONTACT EMAIL]. We'll then stop forecast submissions and, if they ask, delete the account.",
        ],
      },
    ],
  },
  {
    heading: "Your choices",
    body: [
      {
        list: [
          "See your data: your account panel shows it, or you can email us for a copy.",
          "Correct your data: email us.",
          "Delete your account: Settings, then Delete my account.",
          "Questions or complaints: email [CONTACT EMAIL]. We aim to reply within 14 days.",
        ],
      },
    ],
  },
  {
    heading: "Changes",
    body: [
      "If we update this page, we'll change the date at the top, and we'll tell signed-in players on the site about any big changes.",
    ],
  },
];

const TERMS: Section[] = [
  { heading: "", body: ["By creating an account, you agree to these terms."] },
  {
    heading: "1. It's an educational game",
    body: ["Stackly helps you practise forecasting company results. It isn't a trading platform or a financial service."],
  },
  {
    heading: "2. It's not investment advice",
    body: [
      "Nothing on Stackly tells you to buy, sell or hold any share. Stackly isn't registered with SEBI or any other regulator as an investment adviser or research analyst. Don't make real investment decisions based on anything you see here.",
    ],
  },
  {
    heading: "3. No money and no prizes",
    body: ["You can't deposit, win or withdraw money. Points and scores have no cash value."],
  },
  {
    heading: "4. Data may be delayed, incomplete or wrong",
    body: [
      "Company data comes from third parties such as Yahoo Finance, and from company filings that we enter by hand. Share prices are at least 30 days old. We correct mistakes when we find them, which can change scores.",
    ],
  },
  {
    heading: "5. No warranty",
    body: [
      "Stackly is provided as it is. It may have errors, be unavailable at times, or change. As far as the law allows, we aren't liable for any loss from using it.",
    ],
  },
  {
    heading: "6. Fair use",
    body: [
      "You agree to:",
      {
        list: [
          "have one account per person;",
          "not use automated tools to scrape the site or flood it with requests;",
          "not try to break into or disrupt the site;",
          "not cheat, for example with extra accounts;",
          "not use offensive handles or notes, or pretend to be someone else.",
        ],
      },
    ],
  },
  {
    heading: "7. Removing accounts",
    body: [
      "We may suspend or remove accounts that break these terms or abuse the site. You can delete your own account at any time.",
    ],
  },
  {
    heading: "8. Under 18",
    body: [
      "You need a parent or guardian's consent, by signed form or by email from the parent, recorded by us, before you can take part in the league.",
    ],
  },
  {
    heading: "9. Changes",
    body: [
      "We may update these terms, and we'll change the date at the top when we do. If you keep using Stackly after a change, you accept the new terms.",
    ],
  },
  {
    heading: "10. Law",
    body: ["These terms are governed by the laws of India, and the courts in [CITY] have jurisdiction."],
  },
  { heading: "11. Contact", body: ["[CONTACT EMAIL]"] },
];

export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const title = kind === "privacy" ? "Privacy Policy" : "Terms of Use";
  const sections = kind === "privacy" ? PRIVACY : TERMS;
  return (
    <div className="league-page">
      <article className="legal-page">
        <header className="league-page-header">
          <h1>{title}</h1>
          <p className="calculator-subtitle">Last updated {LEGAL_UPDATED}</p>
        </header>
        {sections.map((section, i) => (
          <section key={i}>
            {section.heading && <h2>{section.heading}</h2>}
            {section.body.map((block, j) =>
              typeof block === "string" ? (
                <p key={j}>{block}</p>
              ) : (
                <ul key={j}>
                  {block.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )
            )}
          </section>
        ))}
      </article>
      <SiteFooter />
    </div>
  );
}
