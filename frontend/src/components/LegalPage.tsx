import { useEffect, useState } from "react";
import { fetchConsentOptions } from "../lib/api";
import SiteFooter from "./SiteFooter";

// The Privacy Policy and Terms of Use (#/privacy, #/terms), approved by
// Hriday 2026-11-05. Placeholders in [BRACKETS] are his to fill in. If
// either page changes materially, bump auth_service.TERMS_VERSION so every
// account is asked to agree again. Never add a claim of legal compliance.

export const LEGAL_UPDATED = "25 November 2026";

type Block = string | { list: string[] };
interface Section {
  heading: string;
  body: Block[];
}

const PRIVACY: Section[] = [
  {
    heading: "",
    body: [
      "Stackly is an educational forecasting game run by Hriday Sharma. This page explains what we collect, why we collect it, and what you can do about it.",
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
          "Research workspace: if you're signed in, the notes you write, the steps you tick and the numbers you type into the driver worksheet, for each company. They're linked to your account so you can see them on any device.",
          "Practice: if you're signed in, the ranges you enter for past quarters and the scores they get. Your first try at each company is your practice score; later tries are kept too, marked as replays. If you're not signed in, our server scores your answers and doesn't keep them.",
          "Whether you've seen or skipped the welcome guide, linked to your account if you're signed in, so it doesn't show again on another device.",
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
          "Password-reset and parent-approval emails: sent through Gmail.",
          "Google: only when you open sign-in or use Sign in with Google, your browser loads Google's sign-in button, so Google receives your IP address and browser details and may set its own cookies. Google's privacy policy covers that.",
          "YouTube (owned by Google): news and teaching videos on the Research page show the video's picture, which our server copies from YouTube and shows from Stackly's own site, so nothing loads from YouTube until you press play. When you do, your browser loads YouTube's player in its privacy-enhanced mode (youtube-nocookie.com), so YouTube receives your IP address and browser details and may store information in your browser. YouTube's and Google's privacy policies cover that. To find the videos and their pictures, our server asks YouTube for recent videos from a few news channels; it sends nothing about you.",
          "Apart from sign-in and videos you choose to play, pages load nothing from Google or YouTube.",
        ],
      },
      "This means your data is stored and processed outside India.",
    ],
  },
  {
    heading: "Your browser",
    body: [
      "We save your sign-in code, display settings, whether you've seen the welcome guide and your Mystery mode setting in your browser's local storage. We don't use advertising or tracking cookies.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      {
        list: [
          "Account and profile: until you delete your account.",
          "Workspace notes, ticks and worksheet numbers are kept until you clear that company's workspace or delete your account. Deleting your account deletes them.",
          "Practice ranges and scores are kept until you delete your account. Deleting your account deletes them.",
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
    // Master plan phase 2, approved by Hriday 2026-11-24 (decisions item 8).
    heading: "What we count",
    body: [
      "We count how many times pages are opened and how many rounds are played each day, as totals. These counts have no name, account, IP address or cookie attached.",
      "If the site shows an error, we record the error message, the page and the version of the site, nothing about you.",
      "If you use 'Something wrong? Tell us', we keep your message, and your email only if you give it, for up to 12 months, to fix the problem and reply.",
    ],
  },
  {
    // Master plan phase 6, approved by Hriday 2026-11-24 (decisions item 8, "levels" not "points").
    heading: "Your progress",
    body: [
      "If you're signed in, we save your quick rounds, daily challenges, level and badges so you can see your progress. Leaderboards show your handle only, never your name or school, and you can hide yourself in Settings. Students waiting for parental consent are never on a leaderboard and nothing they play is saved.",
    ],
  },
  {
    // Master plan phase 8, DRAFT wording (decisions item 8 asked for these lines).
    heading: "Classes and parent approval",
    body: [
      {
        list: [
          "If you join a class with your teacher's code, your teacher sees your handle, rounds played, scores and the companies you forecast. Your name is shown only if your school has asked for it.",
          "If you're under 18 and ask a parent to approve by email, we keep their email address only until they answer or for 14 days, whichever comes first. We then keep their name, how they approved and the date, as with a paper form.",
          "In a class round, your teacher sees the class's average range, not each student's.",
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
          "Your workspace is private. Other students can't see it, and it isn't shown on the admin pages.",
          "Your practice scores are private. Other students can't see them, and they never appear on results pages, season scores or leaderboards.",
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
          "A parent or guardian can withdraw consent at any time by emailing stackly.user.support@gmail.com. We'll then stop forecast submissions and, if they ask, delete the account.",
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
          "Questions or complaints: email stackly.user.support@gmail.com. We aim to reply within 14 days.",
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
    body: [
      "You can't deposit, win or withdraw money. Scores have no cash value.",
      // Master plan phase 6, approved by Hriday 2026-11-24 (decisions item 8, levels only).
      "Levels and badges have no money value, can't be bought, sold or swapped, and may be corrected if a result is corrected.",
    ],
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
    body: ["These terms are governed by the laws of India, and the courts in Bengaluru, India have jurisdiction."],
  },
  { heading: "11. Contact", body: ["stackly.user.support@gmail.com"] },
];

// Phase 12, DRAFT until after the lawyer check (decision 6): shown only while
// the AI guide is switched on for anyone. When it goes live for students,
// bump auth_service.TERMS_VERSION. Version without zero data retention.
const GUIDE_PRIVACY: Section = {
  heading: "The AI guide",
  body: [
    "When you ask the guide a question, your question and the page you are on are sent to Anthropic, in the United States, to write the answer. Stackly keeps only how many questions you asked each day, never what you asked. Anthropic deletes them within 30 days and does not use them to train its AI; it may keep a conversation for up to 2 years if its safety systems flag it. The guide sees only what any visitor can see on Stackly. Under-18s can use it only after a parent or guardian agrees to it.",
  ],
};
const GUIDE_TERMS: Section = {
  heading: "The AI guide",
  body: [
    "The AI guide explains how Stackly works and what figures mean. It can be wrong. It never gives the answer to a round, never suggests a range, and never gives advice on buying or selling shares. Don't tell it personal details.",
  ],
};

function withGuide(sections: Section[], extra: Section, after: string): Section[] {
  const at = sections.findIndex((s) => s.heading === after);
  return at < 0 ? [...sections, extra] : [...sections.slice(0, at + 1), extra, ...sections.slice(at + 1)];
}

export default function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const title = kind === "privacy" ? "Privacy Policy" : "Terms of Use";
  const [guideLive, setGuideLive] = useState(false);
  useEffect(() => {
    fetchConsentOptions()
      .then((o) => setGuideLive(Boolean(o.guide_live)))
      .catch(() => setGuideLive(false));
  }, []);
  const base = kind === "privacy" ? PRIVACY : TERMS;
  const sections = !guideLive
    ? base
    : kind === "privacy"
      ? withGuide(base, GUIDE_PRIVACY, "Classes and parent approval")
      : withGuide(base, GUIDE_TERMS, "4. Data may be delayed, incomplete or wrong");
  return (
    <div className="page">
      <article className="legal-page glass panel">
        <header className="page-header">
          <h1 className="page-title">{title}</h1>
          <p className="page-meta">Last updated {LEGAL_UPDATED}</p>
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
