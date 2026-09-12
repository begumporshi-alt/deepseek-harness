# Agent Note: BrowserSkill in the shipped web profile

Status: implemented

English | [中文](2026-09-12-browserskill-web-profile.zh.md)

## Problem

The gap audit found GUI/browser control absent from dsh: browser automation existed only through the default-off Playwright MCP overlay, which drives a headless, logged-out browser. BrowserSkill (Tencent) ships a first-party dsh plugin (`@wxg-prc-cpg/browser-skill-dsh-plugin`) that drives a real, logged-in browser through a dedicated Agent Window — daemon plus extension, no MCP round-trip. The dependency had been added to `dsh-web-app` and pinned in the workspace supply-chain policy, but nothing mounted it: profile bundle layers come from a profile's `dsh.profile.bundles` list, and no shipped template named the package, so the plugin's `dsh.bundle.patch` never applied.

## Decision

Wire the plugin into the shipped `web` profile as a third bundle layer:

- **Template.** `PROFILE_TEMPLATES.web.bundles` becomes `dsh-base`, `dsh-web-app`, `@wxg-prc-cpg/browser-skill-dsh-plugin`. The plugin's own patch inserts its row; no product patch file changes. Only the web profile changes — headless, sdk, acp, and mcp compositions are untouched.
- **Installation resolution.** Bundle names resolve from the dsh installation anchor first, so the plugin is declared as a dependency of `apps/cli` (the published `dsh` package), not only of `dsh-web-app`. The version stays pinned at `0.1.2` through the workspace `minimumReleaseAgeExclude` policy.
- **Migration.** The previous exact web tuple joins `INSTALLATION_OWNED_PROFILE_TUPLES`, so an existing `~/.dsh/profiles/web` written by an earlier version is normalized to the new template on load. A profile whose bundle list the user has edited is never rewritten.
- **Degradation.** The plugin maps a missing `bsk` binary to a friendly tool error with setup guidance, so web sessions on machines without the BrowserSkill stack fail per call rather than at boot.

The web frontend needs no manual composition: the plugin declares `dsh.client` (platform web, inject client-runtime/ui-tool/ui-layout, external ui-attachment/ui-primitives), and the client module system composes `./client` bundles from loaded entries automatically.

## Validation contract

The profile suite pins the new template tuple, the retired-tuple normalization (including that a user-owned bundle list is untouched), and the unchanged templates of every other profile. A composition check against the real installation resolves all three layers, finds the `browserskill` insert row, and loads the plugin module. The keyless snapshot suite (headless and sdk lanes) passes unchanged; the web profile boots the same plugin the user verified live on 2026-08-30 through the profile-local route.

## Alternatives considered

**Ship as a default-off overlay like the MCP examples.** Rejected: the overlay mechanism patches the launcher tree, while standing tool rows belong to a preset's agent plane; a bundle layer is the sanctioned composition surface, and BrowserSkill's value is a logged-in browser the user already trusts.

**Mount the row directly in `dsh-web-app`'s patch.** Rejected: the plugin ships its own `dsh.bundle.patch` precisely so compositions own only the decision to include it; duplicating its row in a product patch would drift from the upstream manifest.

**Expose it in every profile.** Rejected: headless and automation profiles run where no interactive browser exists; the audit scoped the capability to the web profile.

## Consequences

Every fresh web profile carries the six `browser_*` tools and the `browser-skill` skill; machines without the `bsk` stack see per-call setup guidance instead of boot failure. The dependency is the first third-party bundle layer in a shipped template, so its upgrade path is version-pinned through the workspace supply-chain policy and upgrades flow through the profile-normalization machinery only when the tuple is still installation-owned. Sessions on the web profile now depend on an external daemon for browser tasks — everything else in the profile is unchanged.
