# Browser automation with BrowserSkill

English | [中文](browserskill.zh.md)

The `web` profile ships BrowserSkill integration: the model can drive a **real, logged-in browser** through first-party `browser_*` tools — no MCP server or shell round-trips. BrowserSkill (Tencent) runs a local daemon and a browser extension; the agent works in a dedicated Agent Window, so it never steals your own windows or tabs.

## What the model gets

Every web session carries six tools — `browser_session` (start/stop automated sessions), `browser_page` (navigate, back, forward, reload, wait), `browser_inspect` (snapshot, html, screenshot, console, network), `browser_interact` (click, hover, fill, select, press), `browser_tabs` (list, create, select, close, borrow, return), and `browser_assist` (resize, emulate, pause for human assistance) — plus a `browser-skill` skill through the `skill` tool that documents effective usage patterns.

## Prerequisites

The tools are present in every web session, but each call fails with setup guidance until the BrowserSkill stack is installed:

1. Install the `bsk` CLI (see the [BrowserSkill repository](https://github.com/Tencent/BrowserSkill)).
2. Start the daemon (`bsk` starts it on first use).
3. Install the BrowserSkill browser extension and confirm one extension is connected.

The `browser_session` tool with `action=start` opens the Agent Window; `action=list` reports connection health when something is wrong.

## Safety boundaries

The agent drives a browser profile you control: it can reach every site you are logged into, in the window it opened. Treat its requests like a teammate at your keyboard — the `browser_assist` pause action exists precisely for steps a human should take (credentials, payments, irreversible actions). Screenshots and snapshots enter the session log like any tool result, so anything the agent observes during a session is retained with it.

## Removing it

The BrowserSkill bundle is a normal profile layer. Remove `@wxg-prc-cpg/browser-skill-dsh-plugin` from `bundles` in `$DSH_HOME/profiles/web/package.json` and restart `dsh web`; a profile whose bundle list you edited stays yours — later shipped-template changes no longer rewrite it.
