# Publishing the app image to GHCR — a learning guide

This document explains, step by step, how the app's Docker image gets built and
published to the **GitHub Container Registry (GHCR)**, and how it's consumed on
the server (Portainer / Docker Swarm).

It's written so you can **do every step by hand first** to understand it, then
see how the GitHub Actions workflow automates the exact same steps.

- Repo: `s4cindia/Accessibility-Tools`
- Image: `ghcr.io/s4cindia/accessibility-tools`
- Related Jira: **KAN-21** (build & publish image) → feeds **KAN-14** (Swarm deploy)

---

## 0. The mental model

A container image is just a **build artifact**. Two separate concerns:

1. **Produce** the artifact → build the `Dockerfile` into an image, push it to a
   registry (GHCR) so other machines can download it.
2. **Run** the artifact → a server pulls the image and runs it with the right
   database, env vars, and volumes (that's `docker-stack.yml` / Portainer).

This guide is mostly about **(1)**, plus how to hand the result to **(2)**.

```
  Dockerfile ──build──> image ──push──> ghcr.io/s4cindia/accessibility-tools
                                              │
                                              └── pull ──> Portainer / Swarm runs it
```

GHCR is just Docker's registry protocol hosted by GitHub. `docker push` /
`docker pull` work against it exactly like Docker Hub — only the address
(`ghcr.io/...`) and the login credentials differ.

---

## 1. Prerequisites

- Docker installed locally (`docker --version`).
- Push access to the `s4cindia/Accessibility-Tools` repo.
- A **Personal Access Token (PAT)** for GHCR auth when doing it by hand:
  - GitHub → Settings → Developer settings → **Personal access tokens (classic)**
  - Scopes: `write:packages` (to push) and `read:packages` (to pull).
    `delete:packages` if you want to remove old images.
  - Treat it like a password. Don't commit it.

---

## 2. Do it manually (build + push by hand)

This is the part to actually practice — it's exactly what the CI does, just typed
by you. Run these from the repo root.

### 2.1 Log in to GHCR

```bash
# Paste your PAT when prompted (or pipe it in as shown).
echo "<YOUR_PAT>" | docker login ghcr.io -u <your-github-username> --password-stdin
```

A successful login writes the credential to `~/.docker/config.json`. You only
need to do this once per machine (until the token expires).

### 2.2 Build the image

```bash
docker build -t ghcr.io/s4cindia/accessibility-tools:latest .
```

- `-t` = the **tag** (the full name) you're giving the image.
- The trailing `.` = build context (current dir); Docker reads `./Dockerfile`.
- **Why the name must be lowercase:** GHCR rejects uppercase in the path. The
  owner `s4cindia` and `accessibility-tools` are already lowercase — good.

It's good practice to also tag with the commit so every image is traceable:

```bash
SHA=$(git rev-parse --short HEAD)
docker build -t ghcr.io/s4cindia/accessibility-tools:latest \
             -t ghcr.io/s4cindia/accessibility-tools:main-$SHA .
```

### 2.3 Push to GHCR

```bash
docker push ghcr.io/s4cindia/accessibility-tools:latest
docker push ghcr.io/s4cindia/accessibility-tools:main-$SHA   # if you tagged it
```

### 2.4 Confirm it landed

GitHub → org `s4cindia` → **Packages** → `accessibility-tools`. You should see
your tags. Or from the CLI:

```bash
docker pull ghcr.io/s4cindia/accessibility-tools:latest   # pull it back to verify
```

**That's the whole publish flow.** Everything below is either automating this
(Section 3) or consuming the result (Sections 5–6).

---

## 3. How the GitHub Actions workflow automates Section 2

File: `.github/workflows/build-and-publish.yml`. It runs the same login → build
→ push on GitHub's servers whenever you push to `main` (so you never have to do
it by hand again). Mapping each manual step to the workflow:

| Manual step (Section 2)        | Workflow equivalent                                   |
| ------------------------------ | ----------------------------------------------------- |
| `docker login ghcr.io`         | `docker/login-action` using the built-in `GITHUB_TOKEN` (no PAT needed in CI) |
| Decide tags (`:latest`, `:main-<sha>`) | `docker/metadata-action` computes them automatically |
| `docker build`                 | `docker/build-push-action` with `push: false` on PRs  |
| `docker push`                  | same action with `push: true` on `main`/tags          |
| (speed) re-using layers        | `cache-from/to: type=gha` caches layers between runs   |

### Why CI doesn't need your PAT

Every workflow run gets a temporary `GITHUB_TOKEN`. We grant it
`packages: write` in the workflow's `permissions:` block, so it can push to GHCR
for that run only, then the token is discarded. Safer than a long-lived PAT.

### When it runs

- **push to `main`** → publishes `:latest` and `:main-<sha>`
- **push a tag `vX.Y.Z`** → publishes `:X.Y.Z`, `:X.Y`, `:latest`
- **pull request** → builds only (no push) to catch a broken `Dockerfile`
- **manual** → the "Run workflow" button (`workflow_dispatch`)

### How to write that workflow from scratch (the shape)

```yaml
name: Build & publish image to GHCR
on:
  push: { branches: [main], tags: ['v*.*.*'] }
  pull_request: { branches: [main] }
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository_owner }}/accessibility-tools

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read      # to checkout
      packages: write     # to push to GHCR
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=main-,enable={{is_default_branch}}
            type=semver,pattern={{version}}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

See the committed file for the fully-commented version.

---

## 4. Make the package pullable

A brand-new GHCR package is **private**. Until you fix this, `docker pull` from
the server (or Portainer) fails with "denied / not found". Two options:

**Option A — make it public** (simplest for an internal tool)
GitHub → package → **Package settings** → **Change visibility** → Public.
No credentials needed to pull after this.

**Option B — keep private, authenticate on the puller**
On the server / in Portainer, log in with a PAT that has `read:packages`:
```bash
echo "<PAT_with_read:packages>" | docker login ghcr.io -u <github-username> --password-stdin
```

---

## 5. Consume it on the server (manual `docker run` — for understanding only)

You *can* pull and run the image directly, but the app needs a database, secrets,
and volumes, so a bare `docker run` is only useful as a smoke test:

```bash
docker pull ghcr.io/s4cindia/accessibility-tools:latest
```

The real run is the **stack** (Section 6), which wires in Postgres + env + volumes.

---

## 6. Consume it in Portainer (the real deploy)

The app is **not standalone** — it needs:
- a Postgres service (`postgres:16-alpine`),
- env vars `SDE_SECRET_KEY` and `SDE_DB_URL`,
- volumes for data/uploads/exports/reports.

All of that lives in `docker-stack.yml`, whose `app.image` already points at
`ghcr.io/s4cindia/accessibility-tools:latest`.

### Recommended: deploy as a Stack
1. Portainer → **Stacks** → **Add stack** → **Web editor**.
2. Paste the contents of `docker-stack.yml`.
3. Add the environment variables it requires:
   - `POSTGRES_PASSWORD` — the DB password
   - `SDE_SECRET_KEY` — generate with `openssl rand -hex 32`
   - (optional) `POSTGRES_USER`, `POSTGRES_DB`, `APP_IMAGE`
4. If the package is **private**: Portainer → **Registries** → **Add registry**
   → **Custom**, URL `ghcr.io`, username + PAT (`read:packages`). Then Portainer
   can pull during deploy.
5. **Deploy the stack.**

### Just the image reference (if your TL only wants the URL)

```
ghcr.io/s4cindia/accessibility-tools:latest
```

…but remember it won't run correctly without the DB + env + volumes above.

### Equivalent CLI (Swarm)

```bash
export POSTGRES_PASSWORD='...'
export SDE_SECRET_KEY="$(openssl rand -hex 32)"
docker stack deploy -c docker-stack.yml accessibility --with-registry-auth
```

`--with-registry-auth` ships your GHCR login from the manager to every node so
they can pull a private image.

---

## 7. The steady-state update loop

Once set up, releasing a change is:

```
edit code → git push main
  → workflow builds + pushes ghcr.io/s4cindia/accessibility-tools:latest (+ :main-<sha>)
  → on the server, pull the new image and roll the service:
       docker service update \
         --image ghcr.io/s4cindia/accessibility-tools:main-<new-sha> \
         --with-registry-auth \
         accessibility_app
```

The stack uses `update_config.order: stop-first`, so Swarm stops the old app
task before starting the new one (the app is a singleton — never two at once).
A brief blip during the swap is expected.

---

## 8. Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| `denied: ... ` on push | Not logged in, or PAT missing `write:packages`. Re-run `docker login`. |
| `unauthorized` / `not found` on pull from server | Package is private and the puller isn't logged in → make it public, or `docker login` / add the registry in Portainer. |
| GHCR rejects the name | Uppercase in the path. Everything after `ghcr.io/` must be lowercase. |
| Workflow can't push | Missing `permissions: packages: write` in the job. |
| App container restarts / unhealthy | Missing `SDE_SECRET_KEY` / `SDE_DB_URL`, or Postgres not reachable. Check the stack env + db service. |
| `service ps` shows `no suitable node` | `placement.constraints: node.role == manager` — the app/db are pinned to a manager node by design. |

---

## 9. Quick reference

```bash
# Build & push by hand
echo "$PAT" | docker login ghcr.io -u <user> --password-stdin
docker build -t ghcr.io/s4cindia/accessibility-tools:latest .
docker push  ghcr.io/s4cindia/accessibility-tools:latest

# Pull on the server
docker pull  ghcr.io/s4cindia/accessibility-tools:latest

# Deploy the stack (Swarm)
docker stack deploy -c docker-stack.yml accessibility --with-registry-auth
```
