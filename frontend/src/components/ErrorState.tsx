// K6 (master plan; wording approved 2026-11-24, decisions 2.20): a load error
// is one line on what happened and one button for what to do next.
export default function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry ?? (() => window.location.reload())}>
        Try again
      </button>
    </div>
  );
}
