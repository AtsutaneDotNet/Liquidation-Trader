# 🚀 Liquidation-Trader Bot

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Exchange Support](https://img.shields.io/badge/Exchanges-Binance%20%7C%20Bybit%20%7C%20BitMEX%20%7C%20OKX%20%7C%20Lighter-orange.svg)](https://ccxt.pro/)

Liquidation-Trader is a high-performance, automated cryptocurrency trading bot designed to capitalize on market liquidations. By monitoring real-time liquidation streams across multiple exchanges, the bot identifies potential volatility spikes and executes trades using sophisticated technical indicators.

---

## ✨ Key Features

-   **Multi-Exchange Support**: Real-time liquidation monitoring and trading on **Binance**, **Bybit**, **BitMEX**, **OKX**, and **Lighter** using the unified **CCXT Pro** engine.
-   **Dynamic Liquidation Thresholds**: Integration with [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-report) [Liquidation Report](https://liquidation.report) to fetch per-pair mean liquidation values, allowing the bot to ignore noise and focus on high-impact events.
-   **Advanced Strategies**:
    -   **VWAP Offset**: Trade based on price deviations from the Volume Weighted Average Price.
    -   **RSI (Relative Strength Index)**: Identify overbought or oversold conditions.
    -   **ADX (Average Directional Index)**: Detect trend strength and potential reversals/exhaustion.
    -   **Confluence Mode**: Require multiple signals (VWAP, RSI, ADX) to align before executing a trade for higher precision.
    -   **DCA Martingale**: Position-based order sizing that scales based on unrealized PnL percentages.
-   **Intelligent Filtering**:
    -   **CMC Filter**: Automatically restrict trading to the Top N coins ranked by market cap via CoinMarketCap API.
    -   **Coin Blacklist**: Prevent the bot from trading on specific symbols (e.g., highly volatile or low-liquidity assets).
    -   **Value Threshold**: Filter liquidations by USD or BTC value.
-   **Robust Risk Management**:
    -   Dynamic **Take Profit** and **Stop Loss** placement.
    -   **Native Trailing Stop**: Lock in gains during strong trends with exchange-native trailing stops and activation prices.
    -   Configurable **Leverage** and **Trade Size** (as a percentage of wallet balance).
    -   **Max Positions Limit**: Control exposure by limiting the number of simultaneous trades.
-   **Premium Web UI**:
    -   **Glassmorphism Design**: A modern, sleek, and responsive interface.
    -   **Real-time Dashboard**: Live liquidation feeds, active positions, and PnL tracking.
    -   **Trade Decisions Page**: A dedicated log of every trade evaluation, showing indicator values and the logic behind entry decisions.
    -   **Toast Notifications**: Instant visual feedback for order executions.
    -   **Live Logs**: View bot terminal output directly in the browser.
-   **Reliability**:
    -   **SQLite-backed persistence**: Positions and historical data are stored safely.
    -   **Stale Position Sync**: Automatically checks and recovers positions from the exchange if the WebSocket stream is interrupted.
    -   **AES-256-GCM Encryption**: Sensitive API keys are encrypted at rest in the database.

---

## 🛠️ Technical Stack

-   **Backend**: Node.js & Express.
-   **Database**: SQLite (via `better-sqlite3`) with encryption.
-   **API Integration**: [CCXT Pro](https://ccxt.pro/) for unified exchange WebSocket and REST connectivity.
-   **Frontend**: Vanilla HTML/JS with a premium CSS design system (Glassmorphism).
-   **Indicator Source**: [RapidAPI Liquidation Report](https://rapidapi.com/AtsutaneDotNet/api/liquidation-report) for dynamic thresholds.

---

## 🚀 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or higher recommended)
-   API Keys for your preferred exchanges.
-   (Optional) [CoinMarketCap API Key](https://coinmarketcap.com/api/) for symbol filtering.
-   (Optional) [RapidAPI Key](https://rapidapi.com/AtsutaneDotNet/api/liquidation-report) for Dynamic Thresholds (**Pro Plan and above recommended**).

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/AtsutaneDotNet/Liquidation-Trader.git
    cd Liquidation-Trader
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure environment variables**:
    Copy the example file and fill in your details:
    ```bash
    cp .env.example .env
    ```

    > [!IMPORTANT]
    > **Encryption Key**: You **must** generate and set an `ENCRYPTION_KEY` in your `.env` file before the first run. This key is used to encrypt sensitive data in the SQLite database.
    >
    > To generate a valid 32-byte hex key, run:
    > ```bash
    > node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    > ```

4.  **Run the application**:
    ```bash
    node src/index.js
    ```

The bot will start its engine and host the web interface (default: `http://localhost:3000`).

---

## ⚙️ Configuration Reference

The bot is primarily configured through the **Web UI Settings** panel. Below are the key configuration options:

### General & Security
| Variable | Description |
| :--- | :--- |
| `WEBUI_AUTH_ENABLED` | Enable/Disable login protection for the dashboard. |
| `API_KEY` / `API_SECRET` | Your exchange credentials (stored encrypted). |
| `ENCRYPTION_KEY` | Hex key for database encryption (set in `.env`). |

### Trading Strategy
| Variable | Description | Default |
| :--- | :--- | :--- |
| `TRADE_EXCHANGE` | Exchange used for executing trades. | `bybit` |
| `LIQUIDATION_EXCHANGES` | Exchanges to monitor for liquidation signals. | `bybit,binance` |
| `TRADE_LEVERAGE` | Leverage used for orders. | `10` |
| `TRADE_AMOUNT_PERCENTAGE` | % of wallet balance used per trade. | `5%` |
| `ENABLE_VWAP_STRATEGY` | Toggle VWAP-based entry signal. | `true` |
| `OFFSET_PERCENTAGE` | Price deviation from VWAP required for entry. | `0.5%` |
| `ENABLE_RSI_STRATEGY` | Toggle RSI-based entry signal. | `false` |
| `RSI_TIMEFRAME` | Timeframe for RSI calculation (e.g., `1m`, `5m`). | `1m` |
| `ENABLE_ADX_STRATEGY` | Toggle ADX-based entry signal. | `false` |
| `ADX_THRESHOLD` | ADX value threshold for entry. | `25` |
| `ENABLE_DCA_MARTINGALE` | Scale order size based on position PnL. | `false` |

### Filters & Dynamic Thresholds
| Variable | Description | Default |
| :--- | :--- | :--- |
| `LIQUIDATION_VALUE_THRESHOLD` | Min liquidation value to trigger trade. | `1000` |
| `LIQUIDATION_VALUE_CURRENCY` | Currency for threshold (`USD` or `BTC`). | `USD` |
| `ENABLE_DYNAMIC_THRESHOLDS` | Use API-driven [Liquidation Report](https://liquidation.report) values. | `false` |
| `LIQUIDATIONREPORT_KEY` | Your [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-report) Key. | |
| `CMC_FILTER_ENABLED` | Restrict trading to high-liquidity coins. | `false` |
| `CMC_RANK_LIMIT` | Top N coins to include in the whitelist. | `100` |
| `COIN_BLACKLIST` | Comma-separated list of symbols to ignore. | |

### Risk Management
| Variable | Description | Default |
| :--- | :--- | :--- |
| `TAKE_PROFIT_PERCENTAGE` | Target profit for closing positions. | `1.0%` |
| `STOP_LOSS_PERCENTAGE` | Max loss before closing positions. | `0.5%` |
| `ENABLE_TRAILING_PROFIT` | Use native exchange trailing stops. | `false` |
| `TRAILING_PROFIT_PERCENTAGE` | Trailing distance for the stop loss. | `0.2%` |
| `MAX_OPEN_POSITIONS` | Maximum number of simultaneous trades. | `3` |

---

## 📊 Directory Structure

```text
├── src/
│   ├── exchanges/      # Unified exchange adapters (Bybit, Binance, OKX, etc.)
│   ├── bot.js          # Core trading engine and strategy logic
│   ├── server.js       # Express server and API routes
│   ├── db.js           # SQLite management with encryption support
│   ├── config.js       # Dynamic configuration loader
│   ├── cmc.js          # CoinMarketCap API integration
│   ├── logger.js       # Winston-based logging system
│   └── index.js        # Main entry point
├── public/             # Web UI assets (HTML, CSS, JS)
├── bot_data.sqlite     # Local encrypted database
└── package.json        # Dependencies and scripts
```

---

## ⚠️ Disclaimer

Trading cryptocurrencies involves significant risk. This software is provided "as is" for educational and informational purposes. Always test your strategies with small amounts or in a testnet environment before deploying significant capital. The developers are not responsible for any financial losses incurred.

---

## 📄 License

This project is licensed under the **ISC License**.
