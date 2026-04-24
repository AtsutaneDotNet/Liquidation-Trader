# 🚀 Liquidation-Trader Bot

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Exchange Support](https://img.shields.io/badge/Exchanges-Binance%20%7C%20Bybit%20%7C%20BitMEX%20%7C%20OKX%20%7C%20Lighter-orange.svg)](https://ccxt.pro/)

Liquidation-Trader is a high-performance, automated cryptocurrency trading bot designed to capitalize on market liquidations. By monitoring real-time liquidation streams across multiple exchanges, the bot identifies potential volatility spikes and executes trades using sophisticated technical indicators like **VWAP** and **RSI**.

---

## ✨ Key Features

-   **Multi-Exchange Support**: Real-time liquidation monitoring and trading on **Binance**, **Bybit**, **BitMEX**, **OKX**, and **Lighter**.
-   **Advanced Strategies**:
    -   **VWAP Offset**: Trade based on price deviations from the Volume Weighted Average Price.
    -   **RSI (Relative Strength Index)**: Identify overbought or oversold conditions.
    -   **Confluence Mode**: Require both VWAP and RSI signals to match before executing a trade for higher precision.
-   **Intelligent Filtering**:
    -   **CMC Filter**: Automatically restrict trading to the Top N coins ranked by market cap via CoinMarketCap API.
    -   **Value Threshold**: Filter liquidations by USD or BTC value to focus on high-impact market moves.
-   **Robust Risk Management**:
    -   Dynamic **Take Profit** and **Stop Loss** placement.
    -   Support for **Trailing Profit** to lock in gains during strong trends.
    -   Configurable **Leverage** and **Trade Size** (as a percentage of wallet balance).
    -   **Max Positions Limit**: Control exposure by limiting the number of simultaneous trades.
-   **Premium Web UI**:
    -   Real-time dashboard with live liquidation feeds and active positions.
    -   Integrated PnL tracking and account balance updates.
    -   On-the-fly configuration management with a sleek, responsive interface.
-   **Reliability**:
    -   SQLite-backed persistence for positions and historical data.
    -   Automatic error tracking and safety shutdown mechanism.
    -   Graceful state restoration on restart.

---

## 🛠️ Technical Stack

-   **Backend**: Node.js & Express.
-   **Database**: SQLite (via `better-sqlite3`).
-   **API Integration**: [CCXT Pro](https://ccxt.pro/) for unified exchange WebSocket and REST connectivity.
-   **Frontend**: Vanilla HTML/JS with a premium CSS design system.
-   **Logging**: Custom logger with rotation and console/file output.

---

## 🚀 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or higher recommended)
-   API Keys for your preferred exchanges.
-   (Optional) [CoinMarketCap API Key](https://coinmarketcap.com/api/) for symbol filtering.

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
    > **Encryption Key**: You **must** generate and set an `ENCRYPTION_KEY` in your `.env` file before the first run. This key is used to encrypt sensitive data in the SQLite database. If you change this key later, the bot will be unable to decrypt existing data.
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

## ⚙️ Configuration

The bot can be configured either via the `.env` file or directly through the Web UI Settings panel.

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Port for the web interface | `3000` |
| `TRADE_EXCHANGE` | Exchange used for executing trades | `bybit` |
| `LIQUIDATION_EXCHANGES` | Comma-separated list of exchanges to monitor | `bybit,binance` |
| `TRADE_LEVERAGE` | Leverage used for orders | `5` |
| `ENABLE_VWAP_STRATEGY` | Toggle VWAP-based entry signal | `true` |
| `ENABLE_RSI_STRATEGY` | Toggle RSI-based entry signal | `false` |
| `CMC_FILTER_ENABLED` | Enable CoinMarketCap ranking filter | `false` |

---

## 📊 Directory Structure

```text
├── src/
│   ├── exchanges/      # Exchange-specific adapters
│   ├── bot.js          # Core trading engine logic
│   ├── server.js       # Express server and API routes
│   ├── db.js           # Database management
│   ├── config.js       # Configuration loader
│   └── index.js        # Entry point
├── public/             # Web UI assets (HTML, CSS, JS)
├── bot_data.sqlite     # Local database file
└── package.json        # Dependencies and scripts
```

---

## ⚠️ Disclaimer

Trading cryptocurrencies involves significant risk. This software is provided "as is" for educational and informational purposes. Always test your strategies with small amounts or in a testnet environment before deploying significant capital. The developers are not responsible for any financial losses incurred.

---

## 📄 License

This project is licensed under the **ISC License**. See the `LICENSE` file (if available) or `package.json` for details.
