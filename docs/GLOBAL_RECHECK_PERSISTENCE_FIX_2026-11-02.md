# Global recheck result persistence

Local fix verified 2 November 2026. Deployment remains operator-managed.

The recheck result could appear and disappear seconds later because `GlobalSetupAssessment` reset its state whenever the `report` object reference changed. The normal report reader parses a fresh, equivalent object on parent refreshes. An inline Telegram assessment resolver could also be recreated without changing the actual report/session.

The assessment panel now uses the saved report content and private access scope as its identity. Equivalent reparses preserve the latest result. A changed report, technical review, capability or explicitly scoped Telegram session remounts only the assessment panel. Capability values remain in memory and are excluded from DOM/export/URL output.

A synchronous request guard blocks duplicate in-flight requests and prevents late results or errors from publishing after a report/session switch or unmount. Quote actions remain disabled while refreshing or when the assessment is stale. Expiry changes eligibility; it does not remove the visible assessment.

Validation:

- Web tests: **219 passed**, including nine assessment scope/request/privacy regressions.
- Web TypeScript check: passed.
- Isolated Chrome test of the actual production component: result persisted across more than twenty parent clock-driven reparses and two child timer ticks; scoped callback recreation retained it; owner/protection changes cleared it; late replies were rejected; stale results stayed visible with both quote actions disabled.
- Browser checks used synthetic fixtures and local mock responses. No external API, payment, wallet, trade or Telegram message was used.

The Global Market layout, report/chart data, setup rules, existing recheck pricing and expiry rules are unchanged.
