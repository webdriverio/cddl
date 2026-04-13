FROM node:24-bookworm-slim

ARG PNPM_VERSION=10.32.1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends git sudo \
    && rm -rf /var/lib/apt/lists/*

RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu \
    && usermod -aG sudo ubuntu \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu

RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cddl/package.json packages/cddl/package.json
COPY packages/cddl2ts/package.json packages/cddl2ts/package.json
COPY packages/cddl2java/package.json packages/cddl2java/package.json
COPY packages/cddl2py/package.json packages/cddl2py/package.json

RUN pnpm install --frozen-lockfile

RUN chown -R ubuntu:ubuntu /workspace

USER ubuntu
