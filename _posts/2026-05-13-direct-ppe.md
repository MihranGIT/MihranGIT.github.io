---
title: "Direct Poisoned Pipeline Execution (D-PPE)"
date: 2026-05-13
category: cicd
tags: [security, cicd, ppe]
breadcrumb: "Security > CICD > Direct PPE"
---

# Security › CICD › Direct PPE

## What it is

CI/CD pipelines run code on every push. If an attacker can change *what* the
pipeline runs, they get code execution on the build agent — with access to its
secrets, tokens, and infrastructure.

That class of attack is called **Poisoned Pipeline Execution (PPE)**, ranked
**CICD-SEC-4** in the [OWASP Top 10 CI/CD Security Risks][owasp].

**Direct PPE (D-PPE)** is the variant where the pipeline definition itself
(e.g. `Jenkinsfile`, `.gitlab-ci.yml`, `.github/workflows/*.yml`) lives in the
same repo the attacker can write to. They edit it directly to add a malicious
step.

---

## How it works

```
   ┌───────────┐   push / PR    ┌─────────────┐    runs    ┌──────────────┐
   │ Attacker  │ ─────────────▶ │   SCM       │ ─────────▶ │  CI/CD       │
   │ (dev/user)│                │ (Git/Gitea) │            │ (Jenkins...) │
   └───────────┘                └─────────────┘            └──────┬───────┘
                                                                  │
                                                                  ▼
                                                         ┌──────────────────┐
                                                         │ Secrets, tokens, │
                                                         │ prod creds, K8s, │
                                                         │ cloud, registry  │
                                                         └──────────────────┘
```

The attacker needs:

1. Write access to a branch in the source repo.
2. An event that triggers the pipeline (push, PR, tag…).
3. The pipeline file in that repo, with secrets attached to the job.

### Typical flow

1. Clone the target repo and create a new branch.
2. Edit the pipeline file to add a step that exfiltrates a secret —
   commonly by printing `$SECRET` to logs, sending it over HTTP, or pushing it
   to an attacker-controlled branch.
3. Push the branch (or open a PR) to trigger the pipeline.
4. Read the secret from the job output.

> Many pipelines mask raw secret values in logs. **Encoding** the value
> (`base64`, hex, reversed string…) before printing usually bypasses naive
> masking filters.

---

## Impact

- Steal CI secrets (cloud creds, registry tokens, signing keys).
- Push backdoored artifacts to prod.
- Pivot into the internal network from the build agent.
- Supply-chain compromise of downstream users.

---

## Defenses

- Treat pipeline files (`Jenkinsfile`, `.github/workflows/*`, etc.) as
  **protected** — branch protection + CODEOWNERS review required.
- Keep pipeline definitions in a separate, locked-down repo when possible.
- Scope CI secrets — short-lived tokens, per-job credentials, OIDC instead of
  long-lived keys.
- Don't run pipelines with prod secrets on arbitrary feature branches.
- Mask secrets *and* reject obvious encoding bypasses where feasible.

---

## Sources

- OWASP — *Top 10 CI/CD Security Risks*:
  <https://owasp.org/www-project-top-10-ci-cd-security-risks/>
- Palo Alto / Cider Security — *Poisoned Pipeline Execution (PPE)*:
  <https://www.paloaltonetworks.com/cyberpedia/what-is-cicd-security>
- Original PPE research by Daniel Krivelevich & Omer Gil (Cider, 2022).

[owasp]: https://owasp.org/www-project-top-10-ci-cd-security-risks/
