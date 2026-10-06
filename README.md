# DevOps Kubernetes Challenge

A sample Node.js application packaged as a Docker image and deployed to Kubernetes with Helm. The project demonstrates application health checks, resource and container security settings, and a GitHub Actions CI workflow.

## Application

The Express application listens on port `8080` by default. Set `PORT` to override it.

| Endpoint | Purpose |
| --- | --- |
| `/my-app` | Returns `Hello, World!` |
| `/ready` | Kubernetes readiness probe |
| `/live` | Kubernetes liveness probe |
| `/metrics` | Prometheus metrics |
| `/about` | Application description |

## Kubernetes Design

The Helm chart is in [`devops-k8s-challenge/`](devops-k8s-challenge/).

The workload uses a `Deployment`, not a `StatefulSet`, because the HTTP application is stateless: requests can be served by interchangeable replicas, and the application has no persistent per-instance data or stable Pod identity requirement. The in-memory Prometheus counter is temporary telemetry and may reset when a Pod restarts. A Deployment provides replica management, replacement of failed Pods, and rolling updates without the additional identity and storage behavior of a StatefulSet.

This choice keeps the workload simple while still supporting scaling, self-healing, and rolling updates. A `StatefulSet` would be appropriate if replicas needed stable identities or persistent per-replica storage, neither of which this application requires.

The chart configures:

- A `Deployment` with one replica by default.
- Readiness and liveness probes using `/ready` and `/live`.
- A `ClusterIP` Service on port `80`, targeting the application container on port `8080`.
- An Ingress route for `chart-example.local/my-app`. K3s includes Traefik as its Ingress controller by default.
- CPU and memory requests and limits.
- A non-root container security context, no privilege escalation, dropped Linux capabilities, and no automatic ServiceAccount token mount.
- A Helm test Pod that requests `/my-app` through the Service.

The Ingress hostname is a sample hostname. For local access, configure name resolution for `chart-example.local` to the cluster node address, or send an HTTP request with the matching `Host` header.

## Run and Test Locally

Requirements: Node.js 22 and npm.

```bash
npm ci
npm test
npm audit --audit-level=high
```

Build and run the container locally:

```bash
sudo docker build -t devops-k8s-challenge:1.0 .
sudo docker run --rm -d --name devops-k8s-challenge-test -p 8080:8080 devops-k8s-challenge:1.0
curl http://localhost:8080/my-app
sudo docker stop devops-k8s-challenge-test
```

The expected response from the application endpoint is `Hello, World!`.

## Validate the Helm Chart

These checks do not require a Kubernetes cluster:

```bash
helm lint ./devops-k8s-challenge
helm template test ./devops-k8s-challenge
```

## Deploy to K3s

The chart defaults to the GHCR image `ghcr.io/nadavl1/devops-k8s-challenge:1.0`. For a locally imported image, override the image settings during installation. First import the image into the K3s containerd image store on the target node, then run:

```bash
sudo env KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm upgrade --install devops-k8s-challenge ./devops-k8s-challenge \
	--set image.repository=docker.io/library/devops-k8s-challenge \
	--set image.tag=1.0 \
	--set image.pullPolicy=Never \
	--wait --timeout 3m
```

Check the workload and run the Helm test:

```bash
sudo k3s kubectl get pods,services,ingress -o wide
sudo env KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm test devops-k8s-challenge
```

To verify the Ingress route from a machine that can reach the node:

```bash
curl -i -H 'Host: chart-example.local' http://<NODE_IP>/my-app
```

## CI/CD

The workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pushes to `main` and on pull requests. It runs the Node.js tests and dependency audit, Semgrep SAST, Helm lint and rendering, builds the Docker image, and scans it with Trivy. On pushes to `main`, it also publishes version- and commit-tagged images to GitHub Container Registry (GHCR).

### Security Tool Choices

- `npm audit --audit-level=high` checks the Node.js dependency tree against npm's vulnerability advisories. We use it because it directly understands the npm lockfile and fails the workflow on high- or critical-severity dependency advisories.
- Semgrep with the `p/security-audit` ruleset performs SAST: it analyzes source code for insecure coding patterns without running the application. The `--error` option makes the workflow fail if Semgrep reports findings from this ruleset. Semgrep severities (`ERROR`, `WARNING`, and `INFO`) are rule severities; they are not the same scale as CVSS `Critical`.
- Trivy scans the built container image, including operating-system packages and application libraries. It is included because dependency-only auditing does not inspect the complete runtime image. The workflow fails on `HIGH` or `CRITICAL` findings, before login and image publication to GHCR.

Together these checks cover different surfaces: npm dependencies, source-code patterns, and packages included in the final image. We chose these tools because they fit the Node.js/Docker/GitHub Actions stack and provide CI exit statuses that can prevent an unsafe image from being published.

### Git and Versioning

Use short-lived feature branches and open a pull request to `main`. Review and merge after the CI checks pass. The workflow runs checks on pull requests and publishes images only after a push to `main`.

Use Semantic Versioning (`MAJOR.MINOR.PATCH`) for the application. Keep `package.json`'s `version` and `Chart.yaml`'s `appVersion` aligned. For each application release, bump both in the pull request; for example, use `1.0.1` for a backward-compatible bug fix. Keep `values.yaml`'s `image.tag` empty so the Deployment template uses `appVersion` as the image tag. This keeps one application-version value for Helm and the version-tagged image. Bump `Chart.yaml`'s `version` separately when the chart templates or chart behavior change.

The CI publishes the image with both the `appVersion` tag and the commit SHA. ArgoCD watches this repository's `main` branch and the `devops-k8s-challenge/` chart directory, then automatically synchronizes chart changes to the K3s cluster. The Argo CD Application manifest is in [`argocd/application.yaml`](argocd/application.yaml). This single-repository GitOps setup keeps application code and its deployment definition together, which is straightforward for this sample project.

The GHCR package is private. The target cluster must have a read-only registry credential configured as an `imagePullSecret`; this chart refers to the `ghcr-pull` Secret in the application namespace. Do not commit registry tokens to Git.
