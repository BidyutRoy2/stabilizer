// bot.js - Direct smart contract-based Stabilizer Finance automation bot (Refined)
require('dotenv').config();
const { ethers } = require('ethers');

// Colors for beautiful logging
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  gray: "\x1b[90m"
};

function log(color, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${colors.gray}[${timestamp}]${color} ${message}${colors.reset}`);
}

// Token & Router contract addresses on Sepolia
const TOKEN_A_ADDR = "0xee0418Bd560613fbcF924C36235AB1ec301D4933"; // Mock USDT
const TOKEN_B_ADDR = "0x55Cc481D28Db3f1ffc9347745AA6fbB940505BdD"; // USDZ
const ROUTER_ADDR = "0xFa6419a3d3503a016dF3A59F690734862CA2A78D"; // Swap Router / Pool

// Standard ERC-20 ABI with common Faucet/Mint functions
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  // Faucet/Mint methods to try
  "function faucet() external",
  "function mint(address to, uint256 amount) external",
  "function mint(uint256 amount) external",
  "function claim() external",
  "function claimTokens() external"
];

// Swap Router ABI containing possible swap signatures (V2, custom V2, custom AMM)
const ROUTER_ABI = [
  // Uniswap V2 Swap
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  // Custom Swap 1
  "function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address to) external returns (uint256 amountOut)",
  // Custom Swap 2 (overloaded signature)
  "function swap(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external",
  // Custom Swap 3
  "function swap(address tokenIn, uint256 amountIn, uint256 amountOutMin, address to) external",
  // Custom Swap 4
  "function swap(address tokenIn, address tokenOut, uint256 amountIn, address to) external",
  // Custom Swap 5
  "function swap(uint256 amountIn, address tokenIn, address tokenOut, address to) external",
  // Custom Swap 6
  "function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin) external",
  // Custom Swap 7 (for PSM style deposit/redeem)
  "function deposit(address token, uint256 amount) external",
  "function mint(address token, uint256 amount) external",
  "function redeem(address token, uint256 amount) external"
];

// Reliable fallback RPC endpoints in case the one in .env fails or requires authentication
const FALLBACK_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.gateway.tenderly.co",
  "https://rpc2.sepolia.org",
  "https://rpc.sepolia.org"
];

async function initializeProvider(userRpcUrl) {
  const rpcsToTry = [];
  if (userRpcUrl && userRpcUrl !== "https://rpc.ankr.com/eth_sepolia") {
    rpcsToTry.push(userRpcUrl);
  }
  rpcsToTry.push(...FALLBACK_RPCS);

  for (const rpc of rpcsToTry) {
    try {
      log(colors.cyan, `Attempting connection to RPC: ${rpc}`);
      const prov = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
      // Validate connection
      const block = await prov.getBlockNumber();
      log(colors.green, `Connected successfully! Current block: ${block}`);
      return prov;
    } catch (err) {
      log(colors.yellow, `RPC ${rpc} failed: ${err.message.substring(0, 100)}`);
    }
  }
  throw new Error("Could not connect to any Sepolia RPC provider.");
}

async function handleFaucetClaim(tokenContract, walletAddress, provider) {
  // Try EIP-1559 gas pricing logic
  let feeData = {};
  try {
    feeData = await provider.getFeeData();
  } catch (e) {}

  const txOptions = {};
  if (feeData.maxFeePerGas) {
    txOptions.maxFeePerGas = (feeData.maxFeePerGas * 125n) / 100n; // 25% premium
    txOptions.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas 
      ? (feeData.maxPriorityFeePerGas * 125n) / 100n 
      : undefined;
  }

  // Faucet methods candidates to try
  const faucetCandidates = [
    {
      signature: "faucet()",
      args: []
    },
    {
      signature: "mint(address,uint256)",
      args: [walletAddress, ethers.parseUnits("1000", 6)] // USDT has 6 decimals, USDZ has 18
    },
    {
      signature: "mint(uint256)",
      args: [ethers.parseUnits("1000", 6)]
    },
    {
      signature: "claim()",
      args: []
    },
    {
      signature: "claimTokens()",
      args: []
    }
  ];

  for (const candidate of faucetCandidates) {
    try {
      log(colors.cyan, `Testing Faucet signature: ${candidate.signature}...`);
      const fn = tokenContract.getFunction(candidate.signature);
      const gasEstimate = await fn.estimateGas(...candidate.args);
      log(colors.green, `Faucet signature ${candidate.signature} works! Sending transaction...`);
      const tx = await fn(...candidate.args, { ...txOptions, gasLimit: (gasEstimate * 120n) / 100n });
      return tx;
    } catch (err) {
      log(colors.gray, `Faucet signature ${candidate.signature} failed: ${err.message.substring(0, 80)}`);
    }
  }
  return null;
}

async function handleSwap(routerContract, fromToken, toToken, amount, walletAddress, provider) {
  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes deadline
  const path = [fromToken, toToken];

  // Try EIP-1559 gas pricing logic
  let feeData = {};
  try {
    feeData = await provider.getFeeData();
  } catch (e) {
    log(colors.gray, `Failed to retrieve fee data: ${e.message}`);
  }

  const txOptions = {};
  if (feeData.maxFeePerGas) {
    txOptions.maxFeePerGas = (feeData.maxFeePerGas * 125n) / 100n; // 25% premium
    txOptions.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas 
      ? (feeData.maxPriorityFeePerGas * 125n) / 100n 
      : undefined;
  }

  // List of possible swap signatures to try
  const swapCandidates = [
    {
      signature: "swap(address,address,uint256,uint256,address)",
      args: [fromToken, toToken, amount, 0n, walletAddress]
    },
    {
      signature: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
      args: [amount, 0n, path, walletAddress, deadline]
    },
    {
      signature: "swap(uint256,uint256,address[],address,uint256)",
      args: [amount, 0n, path, walletAddress, deadline]
    },
    {
      signature: "swap(address,uint256,uint256,address)",
      args: [fromToken, amount, 0n, walletAddress]
    },
    {
      signature: "swap(address,address,uint256,address)",
      args: [fromToken, toToken, amount, walletAddress]
    },
    {
      signature: "swap(uint256,address,address,address)",
      args: [amount, fromToken, toToken, walletAddress]
    },
    {
      signature: "swap(address,address,uint256,uint256)",
      args: [fromToken, toToken, amount, 0n]
    },
    {
      signature: "deposit(address,uint256)",
      args: [fromToken, amount]
    },
    {
      signature: "mint(address,uint256)",
      args: [fromToken, amount]
    },
    {
      signature: "redeem(address,uint256)",
      args: [toToken, amount]
    }
  ];

  for (const candidate of swapCandidates) {
    try {
      log(colors.cyan, `Testing Swap signature: ${candidate.signature}...`);
      const fn = routerContract.getFunction(candidate.signature);
      const gasEstimate = await fn.estimateGas(...candidate.args);
      log(colors.green, `Signature ${candidate.signature} works! Sending transaction...`);
      const tx = await fn(...candidate.args, { ...txOptions, gasLimit: (gasEstimate * 120n) / 100n });
      return tx;
    } catch (err) {
      log(colors.gray, `Signature ${candidate.signature} failed: ${err.message.substring(0, 80)}`);
    }
  }

  throw new Error("All known swap method signatures failed. Please verify router address or RPC connectivity.");
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function start() {
  log(colors.blue, "=== Stabilizer Finance Direct On-Chain Bot ===");

  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const userRpcUrl = process.env.RPC_URL;

  if (!PRIVATE_KEY || PRIVATE_KEY === 'your_private_key_here') {
    log(colors.red, "ERROR: Please specify a valid PRIVATE_KEY in the .env file.");
    process.exit(1);
  }

  // Initialize network provider
  let prov;
  try {
    prov = await initializeProvider(userRpcUrl);
  } catch (err) {
    log(colors.red, `CRITICAL ERROR: ${err.message}`);
    process.exit(1);
  }

  const wallet = new ethers.Wallet(PRIVATE_KEY, prov);
  log(colors.green, `Wallet initialized: ${wallet.address}`);

  // Instantiate contracts
  const tokenA = new ethers.Contract(TOKEN_A_ADDR, ERC20_ABI, wallet);
  const tokenB = new ethers.Contract(TOKEN_B_ADDR, ERC20_ABI, wallet);
  const router = new ethers.Contract(ROUTER_ADDR, ROUTER_ABI, wallet);

  // Fetch token details
  let tokenASymbol = "USDT";
  let tokenBSymbol = "USDZ";
  let tokenADecimals = 6;
  let tokenBDecimals = 18;

  try {
    tokenASymbol = await tokenA.symbol();
    tokenADecimals = await tokenA.decimals();
    log(colors.gray, `Token A: ${tokenASymbol} (Decimals: ${tokenADecimals})`);
  } catch (e) {
    log(colors.yellow, "Could not fetch details for Token A, using defaults (USDT, 6 decimals).");
  }

  try {
    tokenBSymbol = await tokenB.symbol();
    tokenBDecimals = await tokenB.decimals();
    log(colors.gray, `Token B: ${tokenBSymbol} (Decimals: ${tokenBDecimals})`);
  } catch (e) {
    log(colors.yellow, "Could not fetch details for Token B, using defaults (USDZ, 18 decimals).");
  }

  // 1st Step: Check USDT Balance and claim Faucet if zero
  log(colors.cyan, `Checking ${tokenASymbol} balance...`);
  let balanceA = 0n;
  try {
    balanceA = await tokenA.balanceOf(wallet.address);
    log(colors.green, `Current ${tokenASymbol} Balance: ${ethers.formatUnits(balanceA, tokenADecimals)}`);
  } catch (err) {
    log(colors.red, `Error checking Token A balance: ${err.message}`);
  }

  if (balanceA === 0n) {
    log(colors.yellow, `${tokenASymbol} balance is zero. Attempting to claim from faucet...`);
    const claimTx = await handleFaucetClaim(tokenA, wallet.address, prov);
    if (!claimTx) {
      log(colors.red, "Failed to claim faucet tokens. Continuing to swap cycle anyway in case balance updates.");
    } else {
      log(colors.green, `Faucet claim tx submitted: ${claimTx.hash}`);
      log(colors.blue, "Waiting for confirmation...");
      await claimTx.wait();
      // Re-verify balance
      await sleep(5000);
      try {
        balanceA = await tokenA.balanceOf(wallet.address);
        log(colors.green, `New ${tokenASymbol} Balance: ${ethers.formatUnits(balanceA, tokenADecimals)}`);
      } catch (e) {}
    }
  } else {
    log(colors.green, `${tokenASymbol} balance is positive. Skipping faucet claim.`);
  }

  // 2nd Step: Start Swap Loop
  log(colors.magenta, "Starting automated swap cycles back and forth using MAX balance every 30 seconds.");
  let isForward = true; // true: A -> B, false: B -> A
  let cycle = 1;

  while (true) {
    log(colors.cyan, `\n--- SWAP CYCLE #${cycle} ---`);
    const fromToken = isForward ? tokenA : tokenB;
    const toToken = isForward ? tokenB : tokenA;
    const fromSymbol = isForward ? tokenASymbol : tokenBSymbol;
    const toSymbol = isForward ? tokenBSymbol : tokenASymbol;
    const fromDecimals = isForward ? tokenADecimals : tokenBDecimals;

    try {
      // Refresh balance
      const balance = await fromToken.balanceOf(wallet.address);
      log(colors.blue, `Available ${fromSymbol} Balance: ${ethers.formatUnits(balance, fromDecimals)}`);

      if (balance === 0n) {
        log(colors.yellow, `Balance of ${fromSymbol} is 0. Skipping this cycle to wait for token balance.`);
      } else {
        // Approve router if allowance is insufficient
        log(colors.cyan, `Checking router allowance for ${fromSymbol}...`);
        const allowance = await fromToken.allowance(wallet.address, ROUTER_ADDR);
        if (allowance < balance) {
          log(colors.yellow, `Insufficient allowance. Approving Router...`);
          const approveTx = await fromToken.approve(ROUTER_ADDR, ethers.MaxUint256);
          log(colors.blue, `Approval tx submitted: ${approveTx.hash}. Waiting for confirmation...`);
          await approveTx.wait();
          log(colors.green, `Approval confirmed!`);
        } else {
          log(colors.green, `Allowance is sufficient.`);
        }

        // Execute Swap using MAX balance
        log(colors.yellow, `Swapping MAX ${fromSymbol} -> ${toSymbol} (${ethers.formatUnits(balance, fromDecimals)} ${fromSymbol})...`);
        const swapTx = await handleSwap(
          router,
          await fromToken.getAddress(),
          await toToken.getAddress(),
          balance,
          wallet.address,
          prov
        );
        log(colors.green, `Swap Tx Submitted: ${swapTx.hash}`);
        log(colors.blue, "Waiting for confirmation...");
        const receipt = await swapTx.wait();
        log(colors.green, `Swap cycle #${cycle} confirmed in block ${receipt.blockNumber}!`);
      }
      
      // Flip swap direction for next cycle
      isForward = !isForward;
      cycle++;
    } catch (err) {
      log(colors.red, `Error in swap cycle #${cycle}: ${err.message}`);
    }

    log(colors.blue, "Waiting 10 seconds before next swap cycle...");
    await sleep(10000);
  }
}

// Start the on-chain bot
start().catch(err => {
  log(colors.red, `Critical Startup Error: ${err.message}`);
});
