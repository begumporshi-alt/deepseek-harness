# Agent Note: Curated MCP tool-server overlay examples

Status: implemented

English | [中文](2026-09-12-mcp-server-overlay-examples.zh.md)

## Problem

ZCode-class agent CLIs ship browser automation and up-to-date documentation lookup as built-in abilities; DSH had neither. The third-party memory MCP examples ([origin note](../../archived/feature/2026-07-31-third-party-memory-mcp-examples.md)) established the pattern — copyable default-off overlays over the generic MCP client — but only for memory servers, and every shipped example used stdio, leaving Streamable HTTP without a tested reference. A first-party browser or docs capability now would repeat the mistake that note rejected: pulling vendor APIs, lifecycle, and semantics into DSH for something the generic MCP boundary already expresses.

## Decision

Ship a second example family, `apps/cli/config/examples/mcp-overlays`, with two default-off rows over `@deepseek-ai/dsh-mcp-client`, and one catalog guide owning setup and verification: [Connect curated MCP tool servers](../../../../docs/user/guide/mcp-overlays.md).

- `playwright.cordis.yml` — stdio row for Microsoft Playwright MCP (`@playwright/mcp@0.0.80`, bin `playwright-mcp`), giving the model the server's 24 `browser_*` tools against a Chrome-family browser on the machine.
- `context7.cordis.yml` — the first shipped Streamable HTTP example: the hosted Context7 documentation server at `mcp.context7.com/mcp`, whose `resolve-library-id` and `query-docs` tools add current library documentation.

The boundary carries over from the memory family and is stated the same way: DSH parses the selected overlay, starts or connects the transport, discovers tools, and exposes them as `mcp__<serverName>__<tool>`; the user installs pinned executables and owns accounts, storage, and supervision. Third-party inclusion remains an interoperability example, not an endorsement. The no-`npx` pinning rule applies for the same reason probed there: DSH starts a server process, it is not the provider's package manager. The memory family keeps its own guide and rows; this guide links them instead of restating them. No product code, default composition, or profile changed.

## Validation contract

The keyless gates parse both overlay files and enforce the generic bridge and secret boundary (`verify-cordis-config`). Connection-level evidence, gathered manually on 2026-09-12 without an API key: `playwright-mcp@0.0.80` answered `initialize` (serverInfo Playwright 1.63.0-alpha-2026-08-31) and listed 24 tools over stdio; the Context7 endpoint answered `initialize` and `tools/list` anonymously over Streamable HTTP (serverInfo 4.1.0; tools `resolve-library-id`, `query-docs`). Model-visible end-to-end verification requires an API key and remains the guide's verify steps, mirroring the memory guide's manual bar.

## Alternatives considered

**A first-party browser seam now.** Deferred: the MCP route needs no new dependency and proves demand first; a `dsh-browser` seam is revisited only if the MCP route underdelivers.

**Shipping more servers in the first set.** Kept to two so both pins could be verified honestly; the catalog grows row-by-row the way the memory family did.

**Enabling a browser in the web profile by default.** Rejected: an always-on browser process and its token cost are opt-in decisions; overlays keep removal to omitting `--patch`.

## Consequences

Users gain browser automation and documentation lookup with zero product code, accepting each upstream's trust, data policy, and token cost. Curated pins drift upstream and need revalidation like the memory pins. Future example families should link this guide and the client README rather than restate the enable mechanics or the boundary.
