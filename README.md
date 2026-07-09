# Stabilizer Finance Direct On-Chain Bot

This is a direct contract-based bot that automatically interacts with the Stabilizer Finance testnet contracts on Ethereum Sepolia. It operates **entirely on-chain without any browser** (no Playwright, no Chromium). 

It automatically claims faucet mock tokens if your balance is zero, and performs a token swap using your **MAX balance** every 30 seconds back and forth between:
- **Mock USDT** (`0xee0418Bd560613fbcF924C36235AB1ec301D4933`)
- **USDZ** (`0x55Cc481D28Db3f1ffc9347745AA6fbB940505BdD`)

---

## Key Features

1. **No Browser Required**: Bypasses the overhead and instability of browser automation. Runs as a lightweight Node.js CLI script.
2. **Auto RPC Recovery**: If the RPC in `.env` is unauthorized or rate-limited, the bot automatically falls back to a list of reliable, high-performance public Sepolia RPCs.
3. **Dynamic ABI Probing**: Since contract ABIs can be unverified, the bot dynamically probes the target contracts at runtime using gas estimation to identify which faucet and swap signatures are supported.
4. **Max Balance Swap**: Always swaps the full available token balance.
5. **Auto Token Approval**: Automatically checks allowance and signs ERC-20 approvals prior to swaps.

---

## Setup & Installation

1. Open your terminal in this directory and install the project dependencies:
   ```bash
   npm install
   ```

2. Open the `.env` file in a text editor and fill in your private key:
   ```env
   PRIVATE_KEY=your_wallet_private_key_here
   ```
   *Note: Ensure your wallet has a small amount of Sepolia ETH to cover network gas fees.*

3. (Optional) Supply a custom RPC URL in `.env` if you have one. If omitted, the bot will automatically fall back to public Sepolia nodes.

---

## Running the Bot

To launch the bot:
```bash
npm start
```

### Expected Output Log
- The bot logs your wallet address and validates network connectivity.
- It checks your Mock USDT balance. If it is 0, it claims faucet tokens.
- It enters the swap cycle, checking allowances, approving tokens, and swapping USDT to USDZ.
- Every 30 seconds, it flips the swap direction (USDZ to USDT) and executes using the MAX balance.
- Terminal outputs show confirmed block numbers, transaction hashes, gas used, and real-time balance updates.
