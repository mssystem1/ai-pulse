import { parseAbi } from "viem";

// DAG signatures from the verified Robinhood router. Arc's live Swap API
// returns the same selector; its calldata must independently pass decoding.
// https://sourcify.dev/server/v2/contract/4663/0x6e2a35a7ad683cf634d91492d73bb7ff774c6919?fields=abi
export const OKX_DAG_ABI = parseAbi([
  "function dagSwapByOrderId(uint256 orderId, (uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest, (address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths) payable returns (uint256 returnAmount)",
  "function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest, (address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths) payable returns (uint256 returnAmount)",
  "function uniswapV3SwapTo(uint256 receiver,uint256 amount,uint256 minReturn,uint256[] pools) payable returns (uint256 returnAmount)",
]);
