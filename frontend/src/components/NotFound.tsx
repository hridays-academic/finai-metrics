import SiteFooter from "./SiteFooter";

// T16 (master plan): any address that isn't a page. Wording approved at Stop 2 (vault:
// "Decisions for Hriday (master plan)").
export default function NotFound() {
  return (
    <div className="page not-found">
      <h1 className="hero-title">
        Page not <span className="hero-title-gold">found</span>
      </h1>
      <p className="page-lede">There is no page at this address. It may have moved, or the link may be mistyped.</p>
      <nav className="not-found-links" aria-label="Where to go">
        <a className="btn btn-primary" href="#/">
          Home
        </a>
        <a className="btn btn-secondary" href="#/practice">
          Practice
        </a>
        <a className="btn btn-secondary" href="#/learn">
          How to play
        </a>
      </nav>
      <SiteFooter />
    </div>
  );
}
