# Technical Review: `pulse_review.sh`

## Executive summary

The Bash script expresses the intended PULSE flow, but it is not a safe or
reliable Windows automation. The rewrite is a functional redesign rather than a
literal syntax conversion.

The replacement `pulse-review-windows.mjs`:

- runs from the VS Code PowerShell terminal on Windows;
- uses current Onchain OS registration commands;
- reuses an existing User Agent;
- handles first-time consent;
- obtains live x402 terms from each endpoint;
- requires successful task state transitions;
- writes a structured JSON report;
- keeps feedback manual, truthful, and disabled by default.

## Findings

| Severity | Finding | Impact | Replacement behavior |
|---|---|---|---|
| Critical | `onchainos agent register --name` is outdated | New-user registration can fail | Uses `agent get-my-agents`, `agent pre-check`, consent, then `agent create --role user` |
| High | `create-task` omits `--description-summary` | Current CLI requires the field | Supplies a valid summary for every task |
| High | Payment, direct-accept, complete, and feedback use `|| true` | Failures are hidden; later actions can run against an invalid task | Every stage is checked; feedback is blocked unless the task reaches `complete` |
| High | 402 `accepts` data is hardcoded | A changed amount, recipient, asset, or network could be signed incorrectly | Fetches the live `PAYMENT-REQUIRED` challenge and validates amount, asset, network, and recipient |
| High | Fixed score `5.00` and canned review text | Does not reflect the logged-in user's actual experience | Feedback is opt-in and entered interactively after completion |
| Medium | JSON is parsed with `grep`, `cut`, and `awk` | Breaks on pretty JSON, extra logs, escaping, or output changes | Uses a tolerant JSON parser with field extraction |
| Medium | Unix-only commands and paths | Fails in native Windows PowerShell | Uses Node child processes, Windows executable discovery, and Windows-safe paths |
| Medium | `pkill -f okx-a2a` kills unrelated processes | Can terminate another active session | Starts its own daemon without killing existing processes |
| Medium | Fixed `sleep 5` and `sleep 8` delays | Both slow and unreliable | Uses status polling and process checks |
| Medium | Creates a new agent without checking for an existing User Agent | Registration can fail because the role is unique per wallet | Reuses the existing User Agent first |
| Medium | Feedback can run after failed payment or completion | Review may not be connected to a completed task | Requires confirmed `complete` status |
| Low | Logout only occurs on the success path | Credentials can remain active after a failure | Cleanup runs in `finally` |
| Low | No durable execution report | Troubleshooting requires copying terminal output | Writes `pulse-review-report.json` throughout the run |

## Important current-CLI observations

1. Wallet login still uses `init`, `open`, and `poll` phases.
2. Current task creation requires `description`, `budget`, `max-budget`,
   `currency`, `title`, `description-summary`, and `provider`.
3. `task-402-pay` accepts the job ID, provider ID, live `accepts` JSON,
   endpoint, token symbol, token amount, and optional body.
4. Current source code defines feedback scores as `0.00–5.00`, even though one
   task reference page still displays an older `0–100` example. The rewrite
   follows the current CLI source and passes `0.00–5.00`.

## Behavioral differences from the Bash script

### Removed

- Bash associative arrays
- Unix PATH modification
- `/tmp` log path
- `rm -rf` daemon lock removal
- `pkill`
- fixed sleeps
- `grep`/`cut` JSON parsing
- suppressed failures
- automatic fixed 5-star reviews
- unconditional `direct-accept`
- unconditional `complete`

### Added

- Windows executable discovery through `where.exe`
- optional `ONCHAINOS_BIN` and `OKX_A2A_BIN`
- existing-login detection
- User Agent lookup and reuse
- registration consent handling
- live service-ID resolution
- live 402 challenge validation
- state-aware completion
- opt-in manual feedback
- dry-run mode
- JSON execution report
- guaranteed cleanup

## Recommended first run

1. Install Onchain OS with the official PowerShell installer.
2. Copy `.env.example` to `.env`.
3. Set `DRY_RUN=YES`.
4. Run `node --check`.
5. Run the script and verify all four live 402 terms.
6. Change `DRY_RUN=NO`.
7. Run one service first:

```env
SERVICES_TO_RUN=scan
```

8. After one successful end-to-end task, add the other services.

## Validation performed

- The uploaded Bash script was reviewed line by line.
- The MJS file passed `node --check`.
- No live wallet login, transaction, payment, task creation, completion, or
  feedback submission was performed during this review.

## Primary references

- Uploaded source: `pulse_review.sh`
- Onchain OS repository:
  `https://github.com/okx/onchainos-skills`
- Wallet CLI reference:
  `https://github.com/okx/onchainos-skills/blob/main/skills/okx-agentic-wallet/references/wallet-cli-reference.md`
- Task CLI reference:
  `https://github.com/okx/onchainos-skills/blob/main/skills/okx-ai/references/task-cli-reference.md`
- Identity CLI arguments:
  `https://github.com/okx/onchainos-skills/blob/main/cli/src/commands/agent_commerce/identity/args.rs`
