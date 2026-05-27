---
title: "Attacking Self-Hosted GitLab Runners"
date: 2026-05-27
category: cicd
tags: [security, cicd, gitlab, runners]
breadcrumb: "Security > CICD > GitLab Runner Attacks"
---

# Security › CICD › GitLab Runner Attacks

## What it is

A GitLab Runner is the agent that picks up and executes jobs defined in
`.gitlab-ci.yml`. Runners come in two flavours: **GitLab-hosted** (managed by
GitLab) and **self-managed** (deployed on your own infrastructure).

Self-managed runners are a prime target. When one is registered as an
**instance runner** it is available to *every* group and project on the
GitLab instance — any user who can push a `.gitlab-ci.yml` can schedule work
on it.

By default, pushing a `.gitlab-ci.yml` to any repository triggers a new
pipeline run using the file's configuration. If the runner sits on a cloud VM
(EC2, GCE…), compromising it means access to the instance metadata service,
IAM roles, and potentially the wider VPC.

---

## How it works

```
   ┌───────────┐  push .gitlab-ci.yml  ┌─────────────┐  schedules job  ┌──────────────┐
   │ Attacker  │ ────────────────────▶  │   GitLab    │ ─────────────▶  │  Runner      │
   │ (dev/user)│                        │   Server    │                 │ (self-hosted)│
   └───────────┘                        └─────────────┘                 └──────┬───────┘
                                                                               │
                                         ┌─────────────────────────────────────┘
                                         ▼
                              ┌─────────────────────┐
                              │ CI/CD variables,     │
                              │ cloud metadata,      │
                              │ network, filesystem  │
                              └─────────────────────┘
```

The attacker needs:

1. Push access to **any** repository on the instance (even a personal one).
2. An instance runner (or a shared group runner) that picks up the job.
3. Secrets or interesting infrastructure reachable from the runner.

### Runner execution modes

A runner can execute jobs in several ways — each has a different attack surface:

- **Shell** — directly on the host. Full filesystem and network access.
- **Docker** — inside a container, but often with host mounts or privileged mode.
- **Docker + autoscaling** — spins up cloud VMs on demand; the provisioner
  credentials become a target.
- **SSH** — connects to a remote host to run commands.

Shell executors are the most exposed: the job runs as the runner's OS user
with no isolation.

### CI/CD variable extraction

GitLab injects CI/CD variables as environment variables into every job.
Four variable properties matter for an attacker:

- **Protected** — the variable is only injected into jobs running on
  protected branches or tags. If a variable is *not* marked protected, any
  feature branch — even a personal throwaway — can access it. This is a
  common misconfiguration: admins mask a secret but forget to protect it.
- **Masked** — the value is hidden in job logs. Encoding it (`base64`, hex,
  reversed string…) usually bypasses the mask.
- **Expanded** — the value is interpolated with other variables before
  injection. An expanded variable that references another secret can leak it
  even if the original is restricted.
- **File** (variable type) — instead of injecting the value directly, GitLab
  writes it to a temp file and sets the env var to the file *path*. The value
  won't appear in logs by default, but the attacker just `cat`s the path —
  it is not a security boundary.

### Typical flow

1. Identify whether the instance uses self-managed runners
   (`Settings › CI/CD › Runners`).
2. Push a `.gitlab-ci.yml` that exfiltrates secrets or probes the runner's
   environment:

   ```yaml
   stages:
     - exfil

   dump:
     stage: exfil
     script:
       - env | base64
       - curl http://169.254.169.254/latest/meta-data/iam/security-credentials/
   ```

3. The instance runner picks up the job and executes it.
4. Read the base64-encoded output from the job log (masked values are now
   visible).

> Tools like [Nord-Stream][nordstream] (Synacktiv) automate CI/CD secrets
> extraction across GitLab, GitHub, and Azure DevOps.

---

## Impact

- Steal CI/CD secrets (tokens, registry creds, signing keys).
- Access cloud metadata and IAM roles from the runner VM.
- Pivot into the internal network the runner is attached to.
- Lateral movement to other projects sharing the same runner.

---

## Defenses

- **Scope runners** — avoid instance-wide runners. Use project-specific or
  group-specific runners so a random repo cannot schedule work on sensitive
  infrastructure.
- **Network access control** — restrict runner egress (no arbitrary outbound
  HTTP) and block access to cloud metadata endpoints
  (`169.254.169.254`).
- **Use Docker or Kubernetes executors** over shell — add isolation between
  the job and the host.
- **Restrict who can push `.gitlab-ci.yml`** — protected branches,
  CODEOWNERS, or `allow_failure` gates on merge-request pipelines.
- **Protect and mask variables** — and be aware that masking alone does not
  prevent exfiltration through encoding.
- **Audit runner registrations** — review instance runners regularly; remove
  stale or overly broad registrations.

---

## Sources

- risk3sixty — *Attacking Self-Hosted GitLab*:
  <https://risk3sixty.com/blog/attacking-self-hosted-gitlab>
- GitLab Docs — *GitLab Runner*:
  <https://docs.gitlab.com/runner/>
- Synacktiv — *CI/CD Secrets Extraction Tips and Tricks*:
  <https://www.synacktiv.com/publications/cicd-secrets-extraction-tips-and-tricks>
- Nord-Stream (Synacktiv):
  <https://github.com/synacktiv/nord-stream#gitlab>

[nordstream]: https://github.com/synacktiv/nord-stream#gitlab
