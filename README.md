# 🚀 Liquidation-Trader Bot

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Exchange Support](https://img.shields.io/badge/Exchanges-Binance%20%7C%20Bybit%20%7C%20BitMEX%20%7C%20OKX%20%7C%20Lighter-orange.svg)](https://ccxt.pro/)

Liquidation-Trader is a high-performance, automated cryptocurrency trading bot designed to capitalize on market liquidations. By monitoring real-time liquidation streams across multiple exchanges, the bot identifies potential volatility spikes and executes trades using sophisticated technical indicators.

---

## ✨ Key Features

-   **Multi-Exchange Support**: Real-time liquidation monitoring and trading on **Binance**, **Bybit**, **BitMEX**, **OKX**, and **Lighter** using the unified **CCXT Pro** engine.
-   **Dynamic Liquidation Thresholds**: Integration with [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) to fetch per-pair mean liquidation values, allowing the bot to ignore noise and focus on high-impact events.
-   **Advanced Strategies**:
    -   **Dual VWAP Offset**: Trade based on price deviations from the Volume Weighted Average Price, utilizing independent long and short offset percentages (`OFFSET_LONG_PERCENTAGE` and `OFFSET_SHORT_PERCENTAGE`) to fine-tune entries.
    -   **RSI (Relative Strength Index)**: Identify overbought or oversold conditions.
    -   **ADX (Average Directional Index)**: Detect trend strength and potential reversals/exhaustion.
    -   **Fear & Greed**: Trade alongside or against market sentiment using CoinMarketCap's index. Fear gives SHORT, Greed gives LONG, Extreme states halt trading.
    -   **Confluence Mode**: Require multiple signals (VWAP, RSI, ADX, Fear & Greed) to align before executing a trade for higher precision.
    -   **DCA Martingale**: **<font color="red">(EXPERIMENTAL)</font>** Position-based order sizing that scales based on unrealized PnL percentages. Multiplier = `ceil(abs(PnL% / Leverage))`.
-   **Intelligent Filtering**:
    -   **CMC Filter**: Automatically restrict trading to the Top N coins ranked by market cap via CoinMarketCap API.
    -   **Fear & Greed Index**: Integrate real-time market sentiment into decision-making and dashboard visibility.
    -   **Coin Blacklist**: Prevent the bot from trading on specific symbols (e.g., highly volatile or low-liquidity assets).
    -   **Value Threshold**: Filter liquidations by USD or BTC value.
-   **Robust Risk Management**:
    -   Dynamic **Take Profit** and **Stop Loss** placement.
    -   **Native Trailing Stop**: Lock in gains during strong trends with exchange-native trailing stops and activation prices.
    -   **Unified PnL Tracking**: Calculate and display daily, weekly, monthly, yearly, and total PnL statistics across Bybit, Binance, OKX, BitMEX, and Lighter exchanges.
    -   Configurable **Leverage** and **Trade Size** (as a percentage of wallet balance).
    -   **Max Positions Limit**: Control exposure by limiting the number of simultaneous trades.
-   **Premium Web UI**:
    -   **Glassmorphism Design**: A modern, sleek, and responsive interface.
    -   **Real-time Dashboard**: Live liquidation feeds, active positions, and PnL tracking.
    -   **Position Metrics**: Real-time tracking of current vs max positions and used margin percentage.
    -   **Trade Decisions Page**: A dedicated log of every trade evaluation, showing indicator values and the logic behind entry decisions.
    -   **Desktop & Browser Notifications**: Real-time system-level notifications for instant updates on executed orders and trade entries.
    -   **Toast Notifications & Auto-Sync**: Toast alerts for order executions with automated database cleanups that instantly clear closed positions from the SQLite state, keeping the dashboard highly responsive.
    -   **Live Logs**: View bot terminal output directly in the browser.
-   **Reliability & Security**:
    -   **Auto-Stop Safeguard**: Automatically stops the engine if 15 consecutive errors occur within 60 seconds, protecting capital from API or network failures.
    -   **SQLite-backed persistence**: Positions, historical PnL, and trade data are stored safely.
    -   **Stale Position Sync**: Automatically checks and recovers positions from the exchange if the WebSocket stream is interrupted.
    -   **AES-256-GCM Encryption**: Sensitive API keys are encrypted at rest in the database.


---

## 🛠️ Technical Stack

-   **Backend**: Node.js & Express.
-   **Database**: SQLite (via `better-sqlite3`) with encryption.
-   **API Integration**: [CCXT Pro](https://ccxt.pro/) for unified exchange WebSocket and REST connectivity.
-   **Frontend**: Vanilla HTML/JS with a premium CSS design system (Glassmorphism).
-   **Indicator Source**: [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) for dynamic thresholds & Fear & Greed Index.

---

## 🚀 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or higher recommended)
-   API Keys for your preferred exchanges.
-   (Optional) [CoinMarketCap API Key](https://coinmarketcap.com/api/) for symbol filtering.
-   (Optional) [RapidAPI Key](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) for Dynamic Thresholds & Fear & Greed Index.

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
| `OFFSET_LONG_PERCENTAGE` | Price deviation from VWAP required for LONG entry. | `0.5%` |
| `OFFSET_SHORT_PERCENTAGE` | Price deviation from VWAP required for SHORT entry. | `0.5%` |
| `ENABLE_RSI_STRATEGY` | Toggle RSI-based entry signal. | `false` |
| `RSI_TIMEFRAME` | Timeframe for RSI calculation (e.g., `1m`, `5m`). | `1m` |
| `RSI_PERIOD` | Number of candles for RSI calculation. | `14` |
| `RSI_OVERBOUGHT` | RSI upper bound representing overbought levels. | `70` |
| `RSI_OVERSOLD` | RSI lower bound representing oversold levels. | `30` |
| `ENABLE_ADX_STRATEGY` | Toggle ADX-based entry signal. | `false` |
| `ADX_TIMEFRAME` | Timeframe for ADX calculation (e.g., `1m`, `5m`). | `1m` |
| `ADX_PERIOD` | Number of candles for ADX calculation. | `14` |
| `ADX_THRESHOLD` | ADX strength threshold to trigger trade signals. | `25` |
| `ENABLE_FEARGREED_STRATEGY` | Toggle Fear & Greed entry signal. | `false` |
| `ENABLE_DCA_MARTINGALE` | Scale order size based on position PnL. **<font color="red">(EXPERIMENTAL)</font>** | `false` |

### Filters & Dynamic Thresholds
| Variable | Description | Default |
| :--- | :--- | :--- |
| `LIQUIDATION_VALUE_THRESHOLD` | Min liquidation value to trigger trade. | `1000` |
| `LIQUIDATION_VALUE_CURRENCY` | Currency for threshold (`USD` or `BTC`). | `USD` |
| `ENABLE_DYNAMIC_THRESHOLDS` | Use API-driven [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) values. | `false` |
| `RAPIDAPI_KEY` | Your [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) Key. | |
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
| `TRAILING_ACTIVATION_PERCENTAGE` | Price deviation to activate trailing stop. | `0.0%` |
| `MAX_OPEN_POSITIONS` | Maximum number of simultaneous trades. | `3` |
| `ENABLE_RUNAWAY_HELPER` | Rescue stale positions with deep negative PnL% via averaging. **<font color="red">(EXPERIMENTAL)</font>** | `false` |
| `RUNAWAY_HELPER_THRESHOLD` | The unrealized PnL% threshold (negative) to trigger rescue. | `-10` |

---

## 📊 Directory Structure

```text
├── src/
│   ├── exchanges/      # Unified exchange adapters (Bybit, Binance, OKX, Lighter, BitMEX)
│   ├── bot.js          # Core trading engine and strategy logic
│   ├── server.js       # Express server and API routes
│   ├── db.js           # SQLite management with encryption support
│   ├── config.js       # Dynamic configuration loader
│   ├── crypto.js       # AES-256-GCM encryption utilities
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
