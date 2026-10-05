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

The workflow currently builds and publishes the image; Kubernetes deployment through ArgoCD/GitOps is not configured yet. If the GHCR package is private, configure an `imagePullSecret` in the target cluster before deploying from GHCR. The local K3s test instead imports the image directly into containerd.
