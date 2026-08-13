# Security

This plugin is a **configuration-as-trust-boundary** tool for the DeepSeek
Harness. Please read this before deploying it.

## What the plugin does

- It spawns the product CLIs you configure (`claude`, `codex`, `opencode`,
  `cbc`, `agent`, …) as subprocesses and drives them over their native
  protocols. **Anything the configured `command` can do, the plugin can do.**
- The `full` permission mode passes the products' own "bypass all permission
  checks" flags (`claude --dangerously-skip-permissions`,
  `codex --dangerously-bypass-approvals-and-sandbox`). Only enable `full` for
  roles/agents you trust with arbitrary file and command access.
- The relay model (the in-process bridge agent) is always read-only: it only
  ever sees `product_submit` (and `product_delegate` when the role allows
  delegation). It never receives write-capable tools.

## What to keep private

- The durable session registry (default
  `~/.dsh/product-subagents-registry.json`) maps child session ids to remote
  product session ids. Treat it as runtime state; never commit it.
- Product CLI credentials are read by the products themselves from their own
  configuration. The plugin passes `process.env` through to child processes;
  do not rely on it to scrub secrets.

## Reporting

Report vulnerabilities privately to the repository owner (GitHub private
security advisories). Do not open public issues for exploitable flaws.
