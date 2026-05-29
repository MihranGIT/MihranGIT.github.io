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
- **Scope** — variables live at three levels:
  - **Instance** — available to every project on the GitLab server.
  - **Group** — available to *every project under the group*, including
    subgroups. A leaky group-level token compromises dozens of repos at once.
  - **Project** — scoped to a single project. Still reachable from any branch
    unless also marked *protected*.

  Group-level secrets are the highest-value find: one push to a low-importance
  project in the group can dump a token usable across the whole group.

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

## Recon once you land on the runner

Job execution = code execution on the runner. The next question is *where*
you actually landed and what's reachable from there. Walk the checklist:

### Where is the runner hosted?

- **Cloud VM** (AWS / GCP / Azure) — hit the instance metadata service for
  short-lived credentials tied to the runner's role:
  - AWS: `curl http://169.254.169.254/latest/meta-data/iam/security-credentials/`
    (IMDSv2: grab a token first with `PUT /latest/api/token`).
  - GCP: `curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token`.
  - Azure: `curl -H "Metadata: true" "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/"`.
- **On-prem / bare metal** — look for files dropped by config management
  (Ansible vaults, Chef encrypted bags, `~/.ssh/`, mounted NFS shares,
  `/etc/gitlab-runner/config.toml`).

### Network — what else is reachable?

- Map internal CIDR from `ip a`, `/etc/resolv.conf`, routing table.
- Sweep for adjacent hosts (GitLab server itself, internal registry, Vault,
  artifact store, package proxy). Runners often sit in a build VLAN with
  more internal access than a typical workload.
- Test **outbound exfil paths** — direct HTTPS to the internet, DNS
  resolution of attacker-controlled domains, ICMP. Egress is often
  *implicitly* permitted because the runner needs to fetch packages.
- Check `/etc/hosts` and resolver behaviour for short names — they often
  reveal internal service topology.

### Container — is the executor a real boundary?

If the job runs in Docker / containerd, verify whether you're actually
contained:

- `cat /proc/1/cgroup`, `/.dockerenv`, `ls -la /` to confirm container.
- `capsh --print` — look for dangerous capabilities (`CAP_SYS_ADMIN`,
  `CAP_SYS_PTRACE`, `CAP_NET_ADMIN`). `SYS_ADMIN` is often enough for a
  trivial escape via `cgroups release_agent`.
- Privileged container? `ls /dev` shows host devices, `mount` lets you
  attach the host's root disk.
- **Host mounts** — `/var/run/docker.sock`, `/`, or `/proc` mounted in is
  game over: spawn a sibling privileged container or write to the host
  filesystem directly.
- **Known Docker / runc CVEs** — e.g. CVE-2019-5736 (runc), CVE-2024-21626
  (`runc leaky fd`). Check versions before throwing exploits.
- **Kernel exploits** — possible but **noisy and risky in prod**. A failed
  attempt can panic the host. Don't go there without an explicit
  authorization to do so.

### Kubernetes executor — pod misconfigurations

If the runner is a pod in a cluster, the blast radius is usually larger:

- `env | grep KUBERNETES` — `KUBERNETES_SERVICE_HOST` confirms you're inside
  a pod.
- `cat /var/run/secrets/kubernetes.io/serviceaccount/token` — try it
  against the API server (`kubectl auth can-i --list`). Over-broad RBAC
  (`get/list secrets`, `create pods`) on the runner's service account is
  the typical win.
- Check `hostNetwork`, `hostPID`, `hostPath` mounts in the pod spec —
  any of these enable host or cluster pivots.
- Reachable in-cluster services: `kubelet` API on `:10250`, the metadata
  service via the node, internal ingress, etcd if exposed.
- Look for cached image-pull secrets and CI runner tokens in the pod
  filesystem (`/etc/gitlab-runner/`, `/secrets/`, projected volumes).

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
