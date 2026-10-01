# Agent 8355 marketplace update and acceptance check

## Marketplace change

The owner authorized removing only **Start Autopilot 24h**, **Start Autopilot 7d** and **Start Autopilot 30d** from the existing OKX.AI agent 8355 listing. The authenticated Codespace terminal submitted deletion deltas for service IDs 40591, 40592 and 40593. OKX returned `SUCCESS` with transaction:

`0x1cf129312ae2a4f5a0bd203d8095af0e95c9dcab2abe4797d928a7246e4ddc76`

The five research/risk services and agent profile were not modified. The update response did not report a new review status; no approval or resubmission result is inferred.

This is a marketplace-only change. The proposed `FEATURE_AUTOPILOT_PASSES` flag was removed at the owner's request, including its local environment entry. Product Autopilot purchases, renewals, vault controls and runtime are unchanged. API metadata can still advertise the product's full eight-service catalog; it is distinct from the selected marketplace services.

## Observed issues and verification limits

- The authenticated marketplace feedback explicitly identifies the three Autopilot services as having failed delivery after payment. Endpoint reachability alone does not resolve that complaint.
- The Codespace wallet's read-only X Layer account and strategy queries returned no configured vaults or registered strategies. No Autopilot purchase, vault creation or trade was performed during this check.
- September 29 deployed unpaid REST/MCP acceptance: 178 checks passed, zero failed; 30 valid-input probes were skipped because they required an active prediction market or registered vault. This is not paid-delivery evidence.
- The published Global Pro schema marked only `instId` required and included an invalid timeframe example, `12:00`. Its description treated timeframe and language as optional, contrary to the deployed endpoint.
- After interactive login successfully saved the Copilot credential, Copilot still reported `No supported model available` before reaching PULSE.
- An initial fresh Codex conversation stopped at its account usage limit. After the indicated retry time, another fresh Codespace Codex conversation completed service discovery and reproduced incomplete onboarding: it requested pair and timeframe but omitted language. This is a Codex test, not a Copilot test.

## Global Pro metadata correction

The Global Pro description now requires pair, timeframe and language together without silently defaulting missing answers. It explicitly requires polling the paid job and delivering every section of `reportMarkdown`, with partial-completion and retry handling. Price (0.30 USDT), endpoint and service identity are unchanged. CLI listing validation passed without findings.

The Codespace submitted the update successfully with transaction `0x9ddd463f64e7c5f1cd7575b502cdc4feaece4acf7c7b7c535a4d56764326ee1e`. A prior attempt was explicitly rejected before execution because the local OKX daemon was stopped; it was restarted before this successful submission. The derived marketplace schema was not separately rechecked, but the later Codespace conversation found the updated listing and asked for all three inputs.

A new Codespace Codex conversation discovered the updated listing and asked for pair, candle interval and report language together. Grouped onboarding passed in that conversation. The BTC-USDT / 4H / English fixture then reached a separate marketplace prerequisite: `task-create-prepare` requires a buyer User identity, which this seller wallet lacks. No identity was created. Subsequent direct-endpoint testing must be distinguished from completing the marketplace buyer flow.

The same conversation's unpaid direct POST for BTC-USDT / 4H / English returned HTTP 402 with an exact charge of 0.30 USDT0 (300000 atomic units) on X Layer, payable to `0xa05b83c9a2228b1f4e32952a71e5b189df4f3973`. CLI quote persistence initially failed because the resumed Codex turn did not retain home-directory write access; that harness configuration was corrected before retrying quote preparation. The HTTP challenge alone is not evidence of paid delivery.

CLI quote preparation subsequently succeeded with no missing parameters and `needsConfirm: true`. Its initial balance check reported zero available for the quoted token and a 0.30 USDT shortfall; the owner then funded the wallet. Quote IDs and the resumable conversation are retained only in ignored local test logs.

## Funded delivery attempt

After the user funded the wallet and authorized continuation, the first payment replay failed with HTTP 400 (`instId` missing), despite the quote retaining all three business parameters. The CLI did not automatically replay quote-time parameters. Read-only reconciliation found the original 0.30 USDT0 balance, no recent transaction and no settlement receipt; no job was created. The resumed Codex conversation then hit its usage limit before retrying. This means the fresh conversation did not achieve unattended full delivery.

The authenticated Codespace terminal refreshed the identical quote and explicitly repeated `--param instId=BTC-USDT --param timeframe=4H --param lang=en` on a single payment replay. OKX reported a successful payment transaction `0x3e401adfe9b639ce21b5b8a6c5abd8da4468e11afece821c816b8a1a38dce1d0`; the response created job `80c847ed-8982-48e6-9899-f668eeb4fb56`. Authenticated polling reached `completed`, and the report endpoint returned a 14,825-byte `reportMarkdown` with the requested pair, interval, language and premium tier. The complete Markdown was saved locally at `.codex-ui-review/8355-global-pro-report.md` for review; its recovery token was kept private.

The agent 8355 Global Pro listing now explicitly instructs OKX CLI callers to repeat all three user-selected inputs on `payment pay`. Listing validation passed with no findings and the update succeeded in transaction `0x8709f618aa1d73243533594888dffb281f133cc0254083f4a506b1f407785312`. The matching API metadata guidance is updated in source and passes the API TypeScript build; it requires deployment before the live metadata changes. No trade or buyer identity creation occurred.

The completed report was then copied into the Codespace and the original fresh Codex conversation resumed. Its final response presented all nine report headings and all report line content (with list indentation changed on 22 lines). The conversation's earlier unattended payment path had failed and required the terminal correction above; this presentation validates delivery of the saved report, not an entirely unattended first-run purchase. Copilot CLI still could not run because it reported no supported model.
