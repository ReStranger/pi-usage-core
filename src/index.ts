import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverProviders, setupUsageEventBus } from "./events.js";
import { FooterManager } from "./footer.js";
import { MockUsageAdapter } from "./mock-adapter.js";
import { ProviderRegistry } from "./registry.js";
import { SettingsManager } from "./settings.js";
import { formatPlainUsageReport, UsageDashboardComponent } from "./ui/dashboard.js";

// Re-export public SDK contracts and utilities
export * from "./events.js";
export * from "./footer.js";
export * from "./mock-adapter.js";
export * from "./registry.js";
export * from "./settings.js";
export * from "./types.js";
export * from "./ui/dashboard.js";
export * from "./ui/formatters.js";
export * from "./ui/progress-bar.js";

export default function (pi: ExtensionAPI): void {
  const settingsManager = new SettingsManager();
  const registry = new ProviderRegistry(settingsManager);
  const footerManager = new FooterManager(registry, settingsManager);

  // Auto-enable mock adapter if setting is enabled or in development
  const settings = settingsManager.get();
  if (settings.enableDevMock || process.env.PI_USAGE_DEV_MOCK === "1") {
    registry.register(new MockUsageAdapter());
  }

  // Set up EventBus listener for external provider registrations
  const cleanupEventBus = setupUsageEventBus(pi, registry, () => {
    // When a new adapter registers, refresh footer status if appropriate
  });

  // Register /usage slash command
  pi.registerCommand("usage", {
    description: "Show usage quotas, pool limits, and balance across AI providers",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      // Interactive TUI mode: open fullscreen dashboard overlay
      if (ctx.mode === "tui" && ctx.hasUI) {
        await ctx.ui.custom<void>(
          (tui, theme, _keybindings, done) => {
            const comp = new UsageDashboardComponent(
              ctx,
              theme,
              registry,
              settingsManager,
              done,
              () => tui.requestRender(),
              {
                onFooterChanged: () => footerManager.update(ctx),
              },
            );

            return {
              render: (w) => comp.render(w),
              invalidate: () => {},
              handleInput: (data) => {
                comp.handleInput(data);
                tui.requestRender();
              },
            };
          },
          { overlay: false },
        );
        return;
      }

      // Non-interactive fallback: text report
      const allResults = await registry.getAllAccounts(ctx);
      const accountsMap = new Map<string, typeof allResults[0]["accounts"]>();
      for (const res of allResults) {
        accountsMap.set(res.provider.id, res.accounts);
      }

      const report = formatPlainUsageReport(registry.getAdapters(), accountsMap);
      if (ctx.hasUI) {
        ctx.ui.notify(report, "info");
      } else {
        process.stdout.write(`${report}\n`);
      }
    },
  });

  // Session lifecycle hooks
  pi.on("session_start", (_event, ctx) => {
    // Broadcast discovery to loaded provider extensions
    discoverProviders(pi);
    footerManager.update(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    footerManager.update(ctx);
  });

  pi.on("turn_end", (_event, ctx) => {
    footerManager.update(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    footerManager.dispose(ctx);
    registry.clearCache();
    cleanupEventBus();
  });
}
