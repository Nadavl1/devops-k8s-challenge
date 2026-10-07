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

The chart defaults to one replica because this is a learning/demo deployment on a single-node K3s cluster, and keeping the resource footprint small is appropriate for that environment. This is not a production availability target: a production deployment would typically run at least two replicas and distribute them across nodes so one Pod can remain available during a Pod failure or rollout. Multiple replicas on a single node do not protect against loss of that node. Horizontal Pod Autoscaling could be added when workload metrics and suitable resource requests are available.

The chart configures:

- A `Deployment` with one replica by default.
- Readiness and liveness probes using `/ready` and `/live`.
- A `ClusterIP` Service on port `80`, targeting the application container on port `8080`.
- An Ingress route for `chart-example.local/my-app`. K3s includes Traefik as its Ingress controller by default.
- CPU and memory requests and limits.
- A non-root container security context, no privilege escalation, dropped Linux capabilities, and no automatic ServiceAccount token mount.
- A Helm test Pod that requests `/my-app` through the Service.

We use Ingress rather than HTTPRoute because the assignment explicitly asks for an Ingress, and K3s includes Traefik configured to handle Kubernetes Ingress resources. HTTPRoute is part of the Gateway API and would require choosing and configuring a Gateway API implementation and Gateway resources. The chart retains an optional HTTPRoute template, but it is disabled because this cluster uses the Ingress path.

The container requests `100m` CPU and has a `500m` CPU limit. The request gives the scheduler a small baseline for placing this lightweight demo workload, while the limit puts an upper bound on CPU use so the application cannot monopolize CPU on the shared single-node demo server. CPU limits are not universally beneficial: under load, a hard limit can throttle a latency-sensitive application. For production, requests and limits should be chosen from observed usage and service objectives; depending on the workload and platform policy, omitting a CPU limit can be appropriate. The memory request (`160Mi`) and limit (`256Mi`) are configured separately because exceeding a memory limit can cause the container to be terminated.

The Ingress hostname is a sample hostname, and this demo Ingress uses HTTP without TLS. For access from the demo network, configure name resolution for `chart-example.local` to the cluster node address, or send an HTTP request with the matching `Host` header. TLS is left out because the demo environment does not have a DNS name and trusted certificate configured; this is not a production TLS configuration.

## Run and Test Locally

Requirements: Node.js 22 and npm.

```bash
npm ci
npm test
npm audit --audit-level=high
```

Build and run the container locally (the image tag follows the application version):

```bash
sudo docker build -t devops-k8s-challenge:1.0.0 .
sudo docker run --rm -d --name devops-k8s-challenge-test -p 8080:8080 devops-k8s-challenge:1.0.0
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

## K3s Deployment and GitOps

The image is published to the private GHCR package `ghcr.io/nadavl1/devops-k8s-challenge`. K3s has a read-only `imagePullSecret` named `ghcr-pull` in the application namespace. GitHub Actions builds and scans the image; after a successful push to `main`, it publishes the image and promotes its immutable digest to the `gitops` branch. ArgoCD watches that branch and synchronizes the Helm chart to K3s, so the cluster deploys the exact image that passed the scan.

The ArgoCD Application is defined in [`argocd/application.yaml`](argocd/application.yaml). It targets the `gitops` branch and deploys the chart to the `default` namespace in the same cluster. ArgoCD reports sync and health status for the application.

To inspect the workload and run the Helm connection test on the K3s server:

```bash
sudo k3s kubectl get pods,services,ingress -o wide
sudo env KUBECONFIG=/etc/rancher/k3s/k3s.yaml helm test devops-k8s-challenge
```

To verify the Ingress route from a machine that can reach the node:

```bash
curl -i -H 'Host: chart-example.local' http://<NODE_IP>/my-app
```

## Deployment Evidence

The application responds through the K3s Ingress:

![Application responding through the K3s Ingress](docs/images/Picture%20APP.png)

ArgoCD reports the application as synced and healthy, and the workload runs from the promoted GHCR image digest:

![ArgoCD sync status and K3s workload](docs/images/Picture%20argoCD.png)

The successful GitHub Actions run that validated, scanned, built, and published the image is available [here](https://github.com/Nadavl1/devops-k8s-challenge/actions/runs/37619768776).

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

On pushes to `main`, the CI validates the application, builds the Docker image, scans it with Trivy, and publishes it to GHCR only if all checks pass. After publishing, the workflow records the image digest in the `gitops` branch. ArgoCD watches the `gitops` branch and the `devops-k8s-challenge/` chart directory, then synchronizes the verified image to the K3s cluster. The Argo CD Application manifest is in [`argocd/application.yaml`](argocd/application.yaml). We use the same repository for application code and deployment configuration to keep this sample project's workflow straightforward.

The GHCR package is private. The target cluster must have a read-only registry credential configured as an `imagePullSecret`; this chart refers to the `ghcr-pull` Secret in the application namespace. Do not commit registry tokens to Git.
