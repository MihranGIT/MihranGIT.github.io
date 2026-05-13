---
title: "Indirect Poisoned Pipeline Execution (I-PPE)"
date: 2026-05-13
category: cicd
tags: [security, cicd, ppe]
breadcrumb: "Security > CICD > Indirect PPE"
---

# Security › CICD › Indirect PPE

## What it is

CI/CD pipelines run code on every push. Sometimes the pipeline definition
itself (`Jenkinsfile`, `.gitlab-ci.yml`, …) lives in a **separate, locked-down
repo** the attacker cannot edit — so the [Direct PPE][dppe] trick of editing
the pipeline file is off the table.

**Indirect PPE (I-PPE)** is the variant where the attacker leaves the pipeline
file alone and instead poisons a file the pipeline *calls into*: a `Makefile`,
a `package.json` script, a `tox.ini`, a build/test shell script, a linter
config — anything the job shells out to.

The pipeline file says "run `make build`". The attacker controls what `make
build` actually does.

Both variants are ranked **CICD-SEC-4** in the
[OWASP Top 10 CI/CD Security Risks][owasp].

---

## How it works

```
   ┌───────────┐  push / PR   ┌─────────────┐   triggers   ┌──────────────┐
   │ Attacker  │ ───────────▶ │   SCM       │ ───────────▶ │  CI/CD       │
   │ (dev/user)│              │ (Git/Gitea) │              │ (Jenkins...) │
   └───────────┘              └─────────────┘              └──────┬───────┘
                                                                  │
                                  ┌───────────────────────────────┘
                                  ▼
                       ┌──────────────────────┐
                       │  Jenkinsfile (read   │   ← attacker CANNOT edit
                       │  from locked repo)   │
                       │       │              │
                       │       │ sh 'make ..' │
                       │       ▼              │
                       │  Makefile / script   │   ← attacker CAN edit
                       │  (in target repo)    │
                       └──────────┬───────────┘
                                  ▼
                       ┌──────────────────────┐
                       │ Secrets, tokens,     │
                       │ prod creds, K8s, …   │
                       └──────────────────────┘
```

The attacker needs:

1. Write access to a branch in the **application** repo.
2. An event that triggers the pipeline (push, PR, tag…).
3. The pipeline (defined elsewhere) to invoke a script or build file that
   lives in the application repo.
4. Secrets attached to the job.

### Typical flow

1. Read the pipeline file (it is usually readable, just not writable) and find
   the command it runs — e.g. `sh 'make test'`, `npm run build`, `tox`.
2. Locate the corresponding file in the app repo (`Makefile`, `package.json`,
   `tox.ini`, `scripts/*.sh`…).
3. Add a malicious step to the recipe that exfiltrates a secret — printing
   `$SECRET`, sending it over HTTP, or pushing it to an attacker-controlled
   branch.
4. Push the branch (or open a PR) to trigger the pipeline.
5. Read the secret from the job output.

> As with D-PPE, raw secret values are often masked in job logs. **Encoding**
> the value (`base64`, hex, reversed string…) before printing usually bypasses
> naive masking filters.

### Concrete example — `Makefile` poisoning

Pipeline (read-only, in a separate repo) contains:

```groovy
stage('build') { steps { sh 'make build' } }
```

Attacker edits `Makefile` in the app repo:

```makefile
build:
	@echo "$$SECRET_TOKEN" | base64
	# ...original build steps...
```

On the next push, the job runs `make build`, the recipe echoes the
base64-encoded token, and it appears unmasked in the build log.

---

## D-PPE vs I-PPE

|                       | Direct PPE                    | Indirect PPE                                       |
| --------------------- | ----------------------------- | -------------------------------------------------- |
| File modified         | Pipeline file (`Jenkinsfile`) | A file the pipeline invokes (`Makefile`, scripts…) |
| Pipeline file lives…  | Same repo as the code         | Separate, locked-down repo                         |
| Required write access | Pipeline file                 | Any file the pipeline executes                     |
| Detectability         | Easier — pipeline diff stands out | Harder — looks like a normal code change       |

I-PPE is often *stealthier* than D-PPE: a diff to `Makefile` or a test script
reads as routine dev work, while a diff to `Jenkinsfile` tends to draw review.

---

## Impact

- Steal CI secrets (cloud creds, registry tokens, signing keys).
- Push backdoored artifacts to prod.
- Pivot into the internal network from the build agent.
- Supply-chain compromise of downstream users.

---

## Defenses

- Don't assume "pipeline file is protected" is enough — **every file the
  pipeline executes** is part of the trust boundary.
- Require CODEOWNERS review on build scripts, `Makefile`, `package.json`
  scripts, `tox.ini`, Dockerfiles, anything the job shells out to.
- Scope CI secrets — short-lived tokens, per-job credentials, OIDC instead of
  long-lived keys. The Makefile job rarely needs prod creds.
- Don't run secret-bearing pipelines on arbitrary feature branches / forks.
- Mask secrets *and* reject obvious encoding bypasses where feasible.
- Run untrusted-branch builds on an isolated runner with no production
  credentials.

---

## Sources

- OWASP — *Top 10 CI/CD Security Risks*:
  <https://owasp.org/www-project-top-10-ci-cd-security-risks/>
- Palo Alto / Cider Security — *Poisoned Pipeline Execution (PPE)*:
  <https://www.paloaltonetworks.com/cyberpedia/what-is-cicd-security>
- Original PPE research by Daniel Krivelevich & Omer Gil (Cider, 2022).

[owasp]: https://owasp.org/www-project-top-10-ci-cd-security-risks/
[dppe]: {% post_url 2026-05-13-direct-ppe %}
