# Saifu prototype

The first Itonami dapp written as ClojureScript in the browser and Basilisp on the OS, with one
shared core and EVM reads (AWAI-170). It holds no keys and cannot sign or send. It is a prototype
to test the approach, and it is **not built into the OS image yet**.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/saifu/core.cljc` | ClojureScript and Basilisp, unchanged |
| Screen | `app/src/saifu/app.cljs` | Browser: Reagent and React |
| Agent tools | `mcp/server.lpy` | Basilisp: stdio MCP server |
| Shared cases | `test/cases.json` | Both |

The core has no I/O, regular expressions, dates or platform numbers. Amounts stay as digit strings,
so no float can round them. The screen reads through `window.saifuHost.readChainState` if the host
offers it, which is where the shared consent broker belongs, and otherwise through an EIP-1193
wallet in the page.

## Tools

`nix/shell.nix` has the tools. Basilisp 0.5.1 is not in the pinned nixpkgs, so `nix/basilisp.nix`
builds it from the PyPI wheel by digest. Java runs only to compile ClojureScript and never runs in
the OS. A record of that use is required by ADR 0026 D3, and using it in CI is an open owner
decision.

## Check

```bash
nix-shell nix/shell.nix --run 'npm ci && npx shadow-cljs compile test && node out/test.js'
```

```bash
nix-shell nix/shell.nix --run 'PYTHONPATH=src basilisp run test/run_cases.lpy && PYTHONPATH=src basilisp run test/check_mcp.lpy'
```

## Evidence (2026-11-07, 5 vCPU aarch64 Linux container on Apple M1 Max)

| Check | Result |
| --- | --- |
| Shared cases on ClojureScript | 29 of 29 |
| Shared cases on Basilisp | 29 of 29 |
| A changed expectation | Fails on both, exit 1 |
| MCP over stdio | Three tools answer, and bad arguments, an unknown tool and an unknown method are refused |
| One read of Optimism mainnet through the core | `0x…dEaD` returned 0.312425237374196945 ETH |
| Screen, with a stand-in wallet in the browser | A hex balance reads 1.5 ETH, and a bad address sends nothing |
| Browser bundle, advanced compile | 300 KB, 83 KB gzip |
| Time to load the core on Basilisp | About 350 ms |
| MCP server ready | About 0.46 s |
| ClojureScript test run in Node | About 110 ms |

The shared cases include 256-bit amounts, invalid input and RPC errors.

These timings are single-machine and include other load. There is no comparison with Squint or Hy.

## Not verified or not implemented

- The screen in the OS shell, a sandbox, or the consent broker. A real wallet was not used.
- Hermes calling the MCP server. Only a test client spoke to it.
- Transactions: the core only reads and has no signing path.
- Differences between the two platforms beyond these cases. Regular expressions, dates, async and
  platform numbers are kept out of the core rather than made equal.
