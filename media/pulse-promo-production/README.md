# PULSE — Arc Mainnet demo

The final local films are exactly **4:00**, **1920 × 1080**, **30 fps**, H.264 with 48-kHz stereo AAC.

- `PULSE-Arc-Mainnet-Demo-4min.mp4`: female AI narration with the original electronic score.
- `PULSE-Arc-Mainnet-Demo-4min-music-only.mp4`: the same cut, on-screen explanations and music, without narration.
- Open `index.html` for the local player, chapter navigation and both versions.

| Time | Chapter |
|---|---|
| 00:00–00:16 | Meet PULSE |
| 00:16–00:40 | Your command center |
| 00:40–01:04 | Fund your research |
| 01:04–01:44 | Global Market research |
| 01:44–02:20 | Spot Trading |
| 02:20–02:52 | Prediction Market intelligence |
| 02:52–03:44 | Guarded Autopilot |
| 03:44–04:00 | Find your PULSE |

## Production notes

Original music: **PULSE — Signal to Action**, 120 BPM, written and synthesized for this film. No third-party songs or external music samples were used. Female narration: **Microsoft en-US-AriaNeural**, synthetic English speech accessed through edge-tts. Fonts: **Syne** and **IBM Plex Mono**, with their OFL licenses in `fonts/`. The supplied PULSE recordings remain unchanged.

The Spot demonstration shows a WETH/USDC limit order, pending before owner cancellation. Prediction is a research demonstration. The running BTC Autopilot has zero confirmed fills; the separate paused ETH account has historical fills. Gateway shows a confirmed deposit, not a completed withdrawal. The film does not invent transactions or returns.

Titles and chapter names occupy the upper band. Action captions and descriptions stay below the footage. Soft radial color gradients, gentle reframing and 0.3/0.6-second dissolves guide attention without annotation boxes. Long loading waits and repetitive scrolling are cut.

## Validation

Both exports were decoded completely: 7,200 video frames each, no decode errors or unexpected black intervals. Exact export loudness, true peak, checksums and dimensions are in `export-validation.json`. `review-frames/` contains 30 frames from the final film. `final-edit-decisions.json` records every cut and camera treatment.

No upload or deployment was performed.
