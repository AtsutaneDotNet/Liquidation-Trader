# 🚀 Liquidation-Trader Bot

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Exchange Support](https://img.shields.io/badge/Exchanges-Binance%20%7C%20Bybit%20%7C%20OKX-orange.svg)](https://ccxt.pro/)

Liquidation-Trader is a high-performance, automated cryptocurrency trading bot designed to capitalize on market liquidations. By monitoring real-time liquidation streams across multiple exchanges, the bot identifies potential volatility spikes and executes trades using sophisticated technical indicators and advanced risk management rules.

---

## 🖥️ Web UI Dashboard Showcase

Here is a visual preview of the premium, responsive Glassmorphism Web interface built for **Liquidation-Trader**:

### 1. Bot Overview & Controls
Manage engine states dynamically and monitor real-time indicators (Market Sentiment, active/max positions, margin utilization, loaded trading pairs) alongside the high-value liquidation stream.
![Bot Overview](assets/bot_overview.png)

### 2. Active Positions & Risk Tracking
Live tracking of active linear contracts, entry/mark/liquidation prices, take-profit/stop-loss zones, and unrealized PnL.
![Open Positions](assets/open_positions.png)

### 3. Dynamic Thresholds Mapping
Displays per-pair Mean Liquidation Value threshold overrides fetched dynamically from the API compared to static configurations.
![Dynamic Thresholds](assets/dynamic_thresholds.png)

### 4. Account Performance & PnL History
Wallet overview tracking Total Wallet Value, Margin Available/Used, alongside Daily/Weekly/Monthly/Yearly/Total PnL metrics and historical PnL charts.
![Account Performance](assets/account_performance.png)

### 5. Live Liquidation Stream
Global real-time feed of raw WebSockets liquidation events from configured exchanges with color-coded side indicators.
![Liquidation History](assets/liquidation_history.png)

---

## ✨ Key Features

- **Full-Featured Paper Trading Engine**: Test strategies securely without risking real capital! The paper engine accurately simulates live trading logic including local Take-Profit, Stop-Loss, Trailing Stops, real-time market entries, Runaway Helper rescues, and true Realized/Unrealized PnL wallet balance isolation. Includes a one-click reset for paper trading history and balance.
- **Multi-Exchange Support**: Real-time liquidation monitoring and trading on **Binance**, **Bybit**, and **OKX** using the unified **CCXT Pro** engine.
- **Dynamic Liquidation Thresholds**: Integration with [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) to fetch per-pair mean liquidation values, allowing the bot to ignore noise and focus on high-impact events. Includes a dynamic minimum safeguard configuration (`REPLACE_BELOW_MIN_THRESHOLD`).
- **Advanced Strategies**:
  - **Circuit Breaker**: Detects extreme market volatility using ATR multiples, volume surges, and price movement percentage checks. Halts new trading entries during abnormal conditions to protect capital while allowing existing positions to be managed normally.
  - **Rolling & Session VWAP**: 
    - **Rolling VWAP**: Trade based on price deviations from a rolling Volume Weighted Average Price calculated dynamically from historical OHLCV data. Supports configurable timeframes (`VWAP_TIMEFRAME`) and period lengths (`VWAP_PERIOD`), with independent long and short offset percentages.
    - **Session VWAP**: Track price deviations against a session-anchored Volume Weighted Average Price (Daily, Weekly, Monthly) which resets cumulative calculations at the start of each session timeframe.
  - **RSI (Relative Strength Index)**: Identify overbought or oversold conditions. Configure advanced threshold directions (`above`/`under`) and custom signal actions, complete with guards requiring RSI values to align logically (e.g., oversold signals are restricted below 50, overbought above 50).
  - **DMI (Directional Movement Index)**: Detect trend strength and exhaustion. Generates entry signals based on customizable threshold direction (`above`/`under`) and DI crossover logic.
  - **Market Sentiment**: Trade alongside or against market sentiment using CoinMarketCap's index. Custom mapping for Bullish/Bearish and Extreme Fear/Greed signals.
  - **Confluence Mode**: Require all enabled strategies (VWAP, RSI, DMI, Market Sentiment) to align in the same direction before executing a trade for maximum precision.
  - **DCA Martingale**: **<font color="red">(EXPERIMENTAL)</font>** Position-based order sizing that scales based on unrealized PnL percentages. Multiplier = `ceil(abs(PnL% / Leverage))`.
- **Intelligent Filtering**:
  - **CMC Filter**: Automatically restrict trading to the Top N coins ranked by market cap via CoinMarketCap API.
  - **Market Sentiment**: Integrate real-time market sentiment into decision-making and dashboard visibility.
  - **Coin Blacklist**: Prevent the bot from trading on specific symbols (e.g., highly volatile or low-liquidity assets).
  - **Value Threshold**: Filter liquidations by USD or BTC value.
- **Robust Risk Management**:
  - Dynamic **Take Profit** and **Stop Loss** placement utilizing precise `reduceOnly` market orders and exact size targeting.
  - **Native Trailing Stop**: Lock in gains during strong trends with exchange-native trailing stops and activation prices.
  - **Unified PnL Tracking**: Calculate and display daily, weekly, monthly, yearly, and total PnL statistics across all supported exchanges, including **Max Drawdown** tracking for both live and paper trading.
  - Configurable **Leverage** and **Trade Size** (as a percentage of wallet balance).
  - **Max Leverage Safeguard**: Automatically checks the maximum allowed leverage on the exchange for the specific symbol (via market limit cache or `fetchLeverageTiers` API) and skips the trade if the configured `TRADE_LEVERAGE` exceeds it, preventing API errors and protecting account health.
  - **Max Positions Limit**: Control exposure by limiting the number of simultaneous trades.
  - **Isolation Trading System**: Automatically stop opening new positions when margin usage exceeds a safe threshold, reserving capital to manage current open positions. Optionally, automatically halve TP, trailing distance, and trailing activation values to quickly secure profits.
- **Fund Management**:
  - **Automatic Internal Transfer**: Automatically takes profit by transferring a specified percentage of profit from the trading account to the funding account when the wallet value exceeds a predefined threshold.
- **Premium Web UI**:
  - **Modern 6-Tab Interface**: A fully responsive, premium 6-tab configuration system with detailed descriptions, desktop drag-to-scroll swipe gestures, and glassmorphism design.
  - **Share Statistics**: Export and share visual performance statistics via a built-in screenshot tool.
  - **Import/Export Settings**: Seamlessly backup and restore your strategy configurations without exposing sensitive API keys.
  - **Real-time Dashboard**: Live liquidation feeds, active positions, and PnL tracking.
  - **Position Metrics**: Real-time tracking of current vs max positions and used margin percentage.
  - **Trade Decisions Page**: A dedicated log of every trade evaluation, showing detailed indicators and values via interactive tooltips (timeframe, formatted bands matching selected display currencies and precision, RSI, DMI, DI).
  - **Desktop & Browser Notifications**: Real-time system-level notifications for instant updates on executed orders and trade entries.
  - **Toast Notifications & Auto-Sync**: Toast alerts for order executions with automated database cleanups that instantly clear closed positions from the SQLite state, keeping the dashboard highly responsive.
  - **Live Logs**: View bot terminal output directly in the browser.
- **Reliability & Security**:
  - **Auto-Stop Safeguard**: Automatically stops the engine if 15 consecutive errors occur within 60 seconds, protecting capital from API or network failures.
  - **SQLite-backed persistence**: Positions, historical PnL, and trade data are stored safely.
  - **Stale Position Sync**: Automatically checks and recovers positions from the exchange if the WebSocket stream is interrupted.
  - **AES-256-GCM Encryption**: Sensitive API keys are encrypted at rest in the database.

---

## 🛠️ Technical Stack

- **Backend**: Node.js & Express.
- **Database**: SQLite (via `better-sqlite3`) with encryption.
- **API Integration**: [CCXT Pro](https://ccxt.pro/) for unified exchange WebSocket and REST connectivity.
- **Frontend**: Vanilla HTML/JS with a premium CSS design system (Glassmorphism).
- **Indicator Source**: [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) for dynamic thresholds & Market Sentiment.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- API Keys for your preferred exchanges.
- (Optional) [CoinMarketCap API Key](https://coinmarketcap.com/api/) for symbol filtering.
- (Optional) [RapidAPI Key](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) for Dynamic Thresholds & Market Sentiment.

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/AtsutaneDotNet/Liquidation-Trader.git
   cd Liquidation-Trader
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
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

4. **Run the application**:
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
| `ENABLE_PAPER_TRADING` | Toggle virtual Paper Trading mode. Simulates trades, TP/SL, and PnL locally without real capital. | `false` |
| `TRADE_EXCHANGE` | Exchange used for executing trades (`bybit`, `binance`, `okx`, etc.). | `bybit` |
| `LIQUIDATION_EXCHANGES` | Exchanges to monitor for liquidation signals (comma-separated). | `bybit,binance` |
| `TRADE_LEVERAGE` | Leverage used for orders. | `10` |
| `TRADE_AMOUNT_PERCENTAGE` | % of wallet balance used per trade. | `5%` |
| `ENABLE_CIRCUIT_BREAKER` | Toggle Circuit Breaker to halt new trades during high volatility. | `false` |
| `CB_TIMEFRAME` | Timeframe for Circuit Breaker calculation. | `1m` |
| `CB_ATR_PERIOD` | Number of candles for ATR calculation. | `14` |
| `CB_ATR_MULTIPLIER` | ATR multiple threshold to detect volatility. | `3.0` |
| `CB_PRICE_LOOKBACK` | Number of candles to look back for price movement. | `5` |
| `CB_VOLUME_PERIOD` | Number of candles for Volume SMA calculation. | `20` |
| `CB_VOLUME_MULTIPLIER` | Volume spike multiplier threshold compared to SMA. | `2.0` |
| `CB_PRICE_MOVEMENT_PERCENT` | Price movement percentage threshold to trigger circuit breaker. | `10.0` |
| `CB_BYPASS_ON_POSITION` | Bypass the circuit breaker condition if there is an open position (`false`, `true`, `conditional`). | `false` |
| `ENABLE_VWAP_STRATEGY` | Toggle VWAP-based entry signal. | `true` |
| `VWAP_TYPE` | Type of VWAP strategy: `rolling` or `session`. | `rolling` |
| `VWAP_SESSION_TYPE` | Time anchor for session VWAP: `daily`, `weekly`, `monthly`. | `daily` |
| `VWAP_TIMEFRAME` | Timeframe for VWAP calculation (e.g., `1m`, `5m`). | `1m` |
| `VWAP_PERIOD` | Number of candles for VWAP calculation (for rolling type). | `14` |
| `OFFSET_LONG_PERCENTAGE` | Price deviation from VWAP required for LONG entry. | `0.5%` |
| `OFFSET_SHORT_PERCENTAGE` | Price deviation from VWAP required for SHORT entry. | `0.5%` |
| `VWAP_UPPER_SIGNAL` | Signal direction for price above VWAP offset. | `sell` |
| `VWAP_LOWER_SIGNAL` | Signal direction for price below VWAP offset. | `buy` |
| `ENABLE_RSI_STRATEGY` | Toggle RSI-based entry signal. | `false` |
| `RSI_TIMEFRAME` | Timeframe for RSI calculation (e.g., `1m`, `5m`). | `1m` |
| `RSI_PERIOD` | Number of candles for RSI calculation. | `14` |
| `RSI_OVERBOUGHT` | RSI upper bound representing overbought levels. | `70` |
| `RSI_OVERSOLD` | RSI lower bound representing oversold levels. | `30` |
| `RSI_OVERBOUGHT_DIR` | Condition for RSI overbought (`above`/`under`). | `above` |
| `RSI_OVERBOUGHT_SIGNAL` | Signal direction when overbought (`sell`, `buy`, `none`). | `sell` |
| `RSI_OVERSOLD_DIR` | Condition for RSI oversold (`above`/`under`). | `under` |
| `RSI_OVERSOLD_SIGNAL` | Signal direction when oversold (`buy`, `sell`, `none`). | `buy` |
| `ENABLE_DMI_STRATEGY` | Toggle DMI-based entry signal. | `false` |
| `DMI_TIMEFRAME` | Timeframe for DMI calculation (e.g., `1m`, `5m`). | `1m` |
| `DMI_PERIOD` | Number of candles for DMI calculation. | `14` |
| `DMI_THRESHOLD` | DMI strength threshold. | `25` |
| `DMI_THRESHOLD_DIR` | Condition for DMI threshold (`above`/`under`/`range`/`none`). | `under` |
| `DMI_THRESHOLD_UPPER` | Upper boundary for DMI range condition. | `30` |
| `DMI_PDI_SIGNAL` | Signal direction when +DI crosses -DI (`sell`, `buy`, `none`). | `sell` |
| `DMI_MDI_SIGNAL` | Signal direction when -DI crosses +DI (`buy`, `sell`, `none`). | `buy` |
| `ENABLE_MARKET_SENTIMENT_STRATEGY` | Toggle Market Sentiment entry signal. | `false` |
| `MS_BULLISH_SIGNAL` | Signal direction during Bullish + Fear/Greed. | `buy` |
| `MS_BEARISH_SIGNAL` | Signal direction during Bearish + Fear/Greed. | `sell` |
| `MS_EXTREME_FEAR_SIGNAL` | Signal direction during Extreme Fear. | `none` |
| `MS_EXTREME_GREED_SIGNAL` | Signal direction during Extreme Greed. | `none` |
| `ENABLE_DCA_MARTINGALE` | Scale order size based on position PnL. **<font color="red">(EXPERIMENTAL)</font>** | `false` |
| `DCA_MARTINGALE_THRESHOLD` | PnL threshold (%) below which the Martingale multiplier is applied. | `-5` |
| `DCA_MARTINGALE_MAX_MULTIPLIER` | Maximum multiplier limit to prevent excessive order sizes. | `5` |

### Filters & Dynamic Thresholds
| Variable | Description | Default |
| :--- | :--- | :--- |
| `LIQUIDATION_VALUE_THRESHOLD` | Min liquidation value to trigger trade. | `1000` |
| `LIQUIDATION_VALUE_CURRENCY` | Currency for threshold (`USD` or `BTC`). | `USD` |
| `ENABLE_DYNAMIC_THRESHOLDS` | Use API-driven [RapidAPI](https://rapidapi.com/AtsutaneDotNet/api/liquidation-trader) values. | `false` |
| `REPLACE_BELOW_MIN_THRESHOLD` | Override dynamic thresholds if they are below the minimum static threshold. | `true` |
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
| `ENABLE_ISOLATION_MODE` | Stop opening new positions if margin usage exceeds threshold. | `false` |
| `ISOLATION_MARGIN_THRESHOLD` | The maximum used margin percentage before isolation mode activates. | `10` |
| `REDUCE_TP_TRAILING_BY_HALF_IN_ISOLATION` | Halves TP, trailing distance, and trailing activation values during Isolation Mode. | `false` |
| `ENABLE_RUNAWAY_HELPER` | Rescue stale positions with deep negative PnL% via averaging. **<font color="red">(EXPERIMENTAL)</font>** | `false` |
| `RUNAWAY_HELPER_THRESHOLD` | The unrealized PnL% threshold (negative) to trigger rescue. | `-10` |

### Fund Management
| Variable | Description | Default |
| :--- | :--- | :--- |
| `ENABLE_AUTO_TRANSFER` | Automatically transfer profit to funding account. | `false` |
| `MIN_BALANCE_THRESHOLD` | Minimum base capital to keep in the trading account ($). | `1000` |
| `TRANSFER_PERCENTAGE_THRESHOLD` | % profit relative to wallet value required to trigger transfer. | `5` |

---

## 📊 Directory Structure

```text
├── assets/             # Saved screenshots and visual dashboard showcases
├── src/
│   ├── exchanges/      # Unified exchange adapters (Bybit, Binance, OKX)
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
