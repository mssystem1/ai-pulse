/** Actual X Layer registrations verified on 7 November 2026. Status is pinned to the recorded blocks; these are not claims about exchange data or creator originality. */
import type {VerifiedIndicatorDeployment} from "./indicatorTapeout.js";
export const BUILTIN_INDICATOR_DEPLOYMENTS: Readonly<Record<string,VerifiedIndicatorDeployment>> = {
  "pulse.executed-cvd": {
    "version": "pulse-indicator-xlayer-v1",
    "chainId": 196,
    "factory": "0x1f09daefa827f02cbb40967cc91b259763760761",
    "processor": "0x9e2849c04a513fe64db07521cbe52d078d905c0e",
    "circuitId": "1",
    "blockNumber": "75306038",
    "blockHash": "0xa430502c36e741ad7312dcfd1e137acdf8055e0f81545b8f69c5f19f9450f3ab",
    "codeHash": "sha256:8046bbe63afaeb16bab5e6c969753e0bd42f57b2e7f5faeb7fdc98e765faf934",
    "beacon": "0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c",
    "implementation": "0x977f217887e085d298cb3819cdad5a0ee35f29b2",
    "implementationCodeHash": "sha256:0a5259a8b5a69197cde6dce70a4446fe807b622277bdae9e79919d5d8e9828a5",
    "observedAt": 1794075070549,
    "netlistHash": "sha256:76025ad2f710e6373f3f4d14ef1dea6c1a93eb6d4e38e63fe3aac66573da65dc",
    "vectorCount": 6,
    "verified": true,
    "transactionHash": "0xb76e235f963aae58a87a986a05ce3235d1cb343477431c28ebe1109a5674b5b0"
  },
  "pulse.buy-participation": {
    "version": "pulse-indicator-xlayer-v1",
    "chainId": 196,
    "factory": "0x1f09daefa827f02cbb40967cc91b259763760761",
    "processor": "0x9e2849c04a513fe64db07521cbe52d078d905c0e",
    "circuitId": "2",
    "blockNumber": "75306050",
    "blockHash": "0x70d67d92b33e4377888037e5ddb9e5d922047546a63858acab6b32e535568e11",
    "codeHash": "sha256:8046bbe63afaeb16bab5e6c969753e0bd42f57b2e7f5faeb7fdc98e765faf934",
    "beacon": "0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c",
    "implementation": "0x977f217887e085d298cb3819cdad5a0ee35f29b2",
    "implementationCodeHash": "sha256:0a5259a8b5a69197cde6dce70a4446fe807b622277bdae9e79919d5d8e9828a5",
    "observedAt": 1794075083064,
    "netlistHash": "sha256:aa7f6c6ed46795e81899c1ba458fd5b49beb48a671d466c40c25afa2907edcd1",
    "vectorCount": 6,
    "verified": true,
    "transactionHash": "0x93ed43b65c7e35111da2d2ab291e907e74910405b36c8dd9ddb020a6c1b37287"
  },
  "pulse.weighted-flow": {
    "version": "pulse-indicator-xlayer-v1",
    "chainId": 196,
    "factory": "0x1f09daefa827f02cbb40967cc91b259763760761",
    "processor": "0x9e2849c04a513fe64db07521cbe52d078d905c0e",
    "circuitId": "3",
    "blockNumber": "75306061",
    "blockHash": "0x61b65ee327f13d8f9106faa0183ccf2c7298b17574140a91a400f876e02f9ddc",
    "codeHash": "sha256:8046bbe63afaeb16bab5e6c969753e0bd42f57b2e7f5faeb7fdc98e765faf934",
    "beacon": "0xf70d1ed4f62cf3780157b0b421b7e2f45bd0991c",
    "implementation": "0x977f217887e085d298cb3819cdad5a0ee35f29b2",
    "implementationCodeHash": "sha256:0a5259a8b5a69197cde6dce70a4446fe807b622277bdae9e79919d5d8e9828a5",
    "observedAt": 1794075094190,
    "netlistHash": "sha256:25bf4290dd1219fbf9425a430e00d3348b86bd8efcda021f9c0888dc505b7cd8",
    "vectorCount": 6,
    "verified": true,
    "transactionHash": "0x992e2490d42e45560e3205d640d2c41598fcf10dde5664910adde83beb1f3c8d"
  }
};
