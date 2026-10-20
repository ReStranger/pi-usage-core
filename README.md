# pi-usage-core

Core package and TUI dashboard for tracking model provider quotas and rate limits in Pi.

`pi-usage-core` tracks rate limits, resets, and account balances across LLM providers in Pi. Provider plugins connect over Pi's event bus without compile-time dependencies.

- Fullscreen `/usage` dashboard with provider tabs, model pool cards, and progress bars.
- Persistent footer status line via `ctx.ui.setStatus` that follows the active model.
- Separate quota pools per provider account (for example, Gemini 5-hour limits versus Claude limits under Google Antigravity).
- Multi-account switching for providers with multiple logins.
- Decoupled registration over `pi.events` (`pi-usage:register` and `pi-usage:discover`).

---

## Quick start

### Installation

Install with the Pi package manager:
```bash
pi install npm:pi-usage-core
```

Or install from GitHub:
```bash
pi install git:github.com/ReStranger/pi-usage-core
```

Or load during development:
```bash
pi -e /path/to/pi-usage-core
```

### Usage

Run the slash command inside Pi:
```text
/usage
```

In interactive TUI mode, this opens the usage dashboard:
- `Tab` / `Shift+Tab` / `h` / `l` / `←` / `→`: switch provider tabs.
- `[` / `]`: switch accounts when a provider has more than one.
- `j` / `k` / `↑` / `↓`: select quota items.
- `r`: refresh quotas for the current provider.
- `a`: refresh all registered providers.
- `f`: cycle the footer format (`percent`, `with-reset`, `multi-window`, `bar`).
- `q` / `Esc`: close the dashboard.

In non-interactive modes (RPC, print, JSON), `/usage` prints a plain-text report.

---

## Footer statusline options

Set the format in `<agent-dir>/extensions/pi-usage.json` (or set `PI_CODING_AGENT_DIR`), or press `f` inside `/usage`:

1. `percent`:
   ```text
   used: 10%
   ```
2. `with-reset`:
   ```text
   used: 10% ↻ 2h 14m
   ```
3. `multi-window`:
   ```text
   S: 10% ↻ 2h 14m · W: 23% ↻ 4d 17h
   ```
4. `bar`:
   ```text
   [██░░░░] 10%
   ```

The reset timer recalculates locally every minute without network requests.

---

## Provider plugin integration

Provider extensions can register with `pi-usage-core` over the event bus with no runtime dependencies.

### Install types

```bash
bun add -d pi-usage-core
# or
npm install --save-dev pi-usage-core
```

### Implement and register UsageProviderAdapter

In your extension entry point:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { UsageProviderAdapter, UsageAccount } from "pi-usage-core";

export default function (pi: ExtensionAPI) {
  const myAdapter: UsageProviderAdapter = {
    id: "antigravity", // matches ctx.model.provider
    displayName: "Google Antigravity",

    async getAccounts(ctx): Promise<UsageAccount[]> {
      const now = Date.now();
      return [
        {
          id: "work-acc",
          name: "Work Account",
          email: "dev@work.com",
          status: "ready",
          isActive: true,
          lastUpdated: now,
          pools: [
            {
              id: "gemini-pool",
              name: "Gemini Models",
              modelKeys: ["gemini-2.5", "gemini-3.0"],
              buckets: [
                {
                  id: "5h-window",
                  label: "Session (5h)",
                  period: "5h",
                  used: 32,
                  remaining: 68,
                  unit: "percent",
                  resetsAt: now + (2 * 60 + 14) * 60 * 1000,
                  isPrimary: true,
                },
                {
                  id: "daily-window",
                  label: "Daily Quota",
                  period: "daily",
                  used: 15,
                  remaining: 85,
                  unit: "percent",
                  resetsAt: now + 8 * 60 * 60 * 1000,
                },
              ],
            },
            {
              id: "claude-pool",
              name: "Claude & GPT Models",
              modelKeys: ["claude-3-7", "gpt-4o"],
              buckets: [
                {
                  id: "claude-5h",
                  label: "Session (5h)",
                  period: "5h",
                  used: 75,
                  remaining: 25,
                  unit: "percent",
                  resetsAt: now + 42 * 60 * 1000,
                  isPrimary: true,
                },
              ],
            },
          ],
          metrics: [
            { id: "credits", label: "Extra Credits", value: 70.0, unit: "currency", currency: "USD" },
          ],
        },
      ];
    },

    async refresh(ctx, accountId): Promise<UsageAccount[]> {
      return this.getAccounts(ctx);
    },
  };

  pi.events.emit("pi-usage:register", myAdapter);

  pi.events.on("pi-usage:discover", () => {
    pi.events.emit("pi-usage:register", myAdapter);
  });
}
```

---

## Configuration

Settings file location: `<agent-dir>/extensions/pi-usage.json`. If `PI_CODING_AGENT_DIR` is set, `pi-usage-core` uses that directory.

```json
{
  "footerFormat": "percent",
  "footerMetric": "used",
  "pinnedTarget": null,
  "refreshIntervalMinutes": 5,
  "enableDevMock": false
}
```

- `footerFormat`: `"percent"` | `"with-reset"` | `"multi-window"` | `"bar"`
- `footerMetric`: `"used"` | `"remaining"`
- `pinnedTarget`: `{ "providerId": "antigravity", "accountId": "work-acc" }` or `null` (tracks active model)
- `refreshIntervalMinutes`: background polling interval in minutes (default: 5)
- `enableDevMock`: enables the built-in mock provider for local testing

---

## Development

```bash
# Install dependencies
bun install

# Run type check
bun run typecheck

# Run test suite
bun test

# Build package
bun run build
```

---

## License

MIT
