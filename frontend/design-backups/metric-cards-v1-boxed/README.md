Backup of the metric-card design before the "less overwhelming" redesign
(2026-07-14) -- the original heavier boxed cards (border + status dot +
redundant colored text badge, larger grid gap/padding).

To restore:

```bash
cp design-backups/metric-cards-v1-boxed/app.css src/styles/app.css
cp design-backups/metric-cards-v1-boxed/MetricCard.tsx src/components/MetricCard.tsx
```

Note: app.css also contains other unrelated styling added after this
backup was taken (e.g. show-more pill, recommended companies). Restoring
the whole file will revert those too -- if you only want the metric-card
look back, copy just the relevant CSS rules (`.metric-card*`, `.metric-group*`,
`.metric-badge*`, `.status-dot*`) from this file instead of overwriting
app.css wholesale.
