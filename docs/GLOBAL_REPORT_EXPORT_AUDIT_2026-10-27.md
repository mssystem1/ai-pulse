# Global report export audit — October 27, 2026

This change addresses mobile PNG/TXT saving, image quality and the crowded header. The image title is followed directly by the timeframe row. Snapshot time, captured quote and completed primary close remain in the evidence section, app and TXT.

## Corrections

The old TXT path clicked a detached Blob link and revoked it after one second. PNG saving first waited for image/canvas conversion, then used the same short-lived link. This could lose the user gesture required by mobile save interfaces; conversion failures had no visible feedback.

Both buttons now prepare a file in a responsive dialog. A separate **Save file** or **Share / Save to Files** tap opens the device interface directly. Supported Telegram clients use native HTTPS downloads. Older clients can open the secure file in their browser. PNG previews support touch-and-hold saving; TXT is selectable. Cancellation leaves the preview available. Blob URLs remain available for 60 seconds after dialog closure.

Secure exports retain existing wallet/history/share authority or verify signed Telegram account and order ownership. Encrypted links expire after five minutes and recheck access when opened. They bind format, language, appearance and studies, and accept neither arbitrary SVG nor filesystem paths. Telegram responses include its required attachment and CORS headers. The browser uses the public API path even when the server has a different internal origin. Exporting creates no additional purchase, market fetch, model call, public share or order. Server preparation has a 30-second deadline, local fallback and visible failure feedback.

PNG rendering uses bundled Inter and Chinese fonts. Target width is 3,900 pixels, bounded by 16 million pixels, an 8,192-pixel side and mobile canvas perimeter limits. Long images scale proportionally. Body text is larger, repeated setup paragraphs are consolidated, and Clarity uses the same contrast mapping as the interactive chart. Saved setup prices, candles, timestamps and selected studies remain unchanged.

## Validation

- Domain: 40 tests. Complete web suite: 208 tests. Focused API suite: 25 tests.
- API and production web builds.
- Final browser matrix: 40 combinations of 15m/1H/4H/1D/1W, English/Chinese, 1454/390-pixel layouts and Clarity/dark themes. All passed with zero runtime errors or unexpected mutations.
- 90 export checks: 40 actual desktop file downloads, 40 simulated Telegram native HTTPS downloads, four direct file shares, four offline local-file shares and two expected canvas-error checks. All PNG/TXT signatures, filenames and saved plan prices passed. The earlier HTTP audit also exercised the older-client browser fallback.
- Visually inspected weekly English and Chinese PNGs and both appearances. The clean-header weekly preview is 3399 x 4704 pixels (about 16 megapixels), compared with the supplied 2600-pixel-wide image. Source snapshot: October 25; no live-price claim.
- API checks cover PNG/TXT bytes, MIME and attachment headers, report immutability, unauthorized accounts, tampering, surface isolation, expiration and revoked access. Telegram export cannot enqueue another report.
- Browser checks exercise actual downloads, sharing from the final gesture, secure-download failure, local fallback and a visible canvas-error state. Existing viewport and price-parity checks also run.

The browser harness serves a production bundle and a real local export router. Remote requests are intercepted or blocked. Its HTTPS public API address deliberately differs from the server's configured origin to check proxy behavior. Reused reports are historical October 25 snapshots; this audit does not refresh their analysis. Strategy backtests remain stopped.

Physical iOS/Android devices and live Telegram native prompts have **not** been tested. Chrome mobile emulation and simulated Telegram/Web Share interfaces establish software behavior, not an operating-system acceptance test. After manual rollout, verify PNG and TXT saving in Safari, Chrome and supported Telegram clients, including cancel/retry and Save to Files.

## Reproduction and rollout

Run API tests with `NODE_ENV=test` and `PULSE_SKIP_DOTENV=1` to avoid loading local production configuration. Build API and web, then run `node scripts/audit-global-mobile-exports.mjs --report-dir=<saved-JSON-directory> --themes=base,xlayer --output-dir .tmp/global-mobile-exports-final`. Supply canonical saved reports named `15m.json`, `1H.json`, `4H.json`, `1Dutc.json` and `1Wutc.json`.

Deploy both API and web manually. No push, deployment or service configuration change is included. The English/Chinese in-app chart guide, chart documentation and README describe the save flow.

Platform references: [Telegram Mini App downloads](https://core.telegram.org/bots/webapps#downloadfileparams), [Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), [browser download links](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#download).
