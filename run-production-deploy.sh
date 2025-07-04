#!/bin/bash
set -e

# Generate a tag name based on the current date and time (YYYYMMDDHHMM)
TAG_NAME=$(date +%Y%m%d%H%M)

# Load the server IP address from server_ip.txt
SERVER_IP=$(grep DIGITAL_OCEAN_IP .env | cut -d '=' -f2)

# Extract secrets from .env
TELEGRAM_BOT_TOKEN=$(grep VLANDIVIR_2025_BOT_TOKEN .env | cut -d '=' -f2)
POSTGRES_CONNECTION_STRING=$(grep POSTGRES_CONNECTION_STRING .env | cut -d '=' -f2)
DO_SPACES_ACCESS_KEY=$(grep DO_SPACES_ACCESS_KEY .env | cut -d '=' -f2)
DO_SPACES_SECRET_KEY=$(grep DO_SPACES_SECRET_KEY .env | cut -d '=' -f2)

docker build \
  --platform linux/amd64 \
  --build-arg TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN}" \
  --build-arg TAG_NAME="${TAG_NAME}" \
  --build-arg ENVIRONMENT="PROD" \
  --build-arg POSTGRES_CONNECTION_STRING="${POSTGRES_CONNECTION_STRING}" \
  --build-arg DO_SPACES_ACCESS_KEY="${DO_SPACES_ACCESS_KEY}" \
  --build-arg DO_SPACES_SECRET_KEY="${DO_SPACES_SECRET_KEY}" \
  -t vlandivir-2025 .

docker tag vlandivir-2025 registry.digitalocean.com/vlandivir-main/vlandivir-2025:$TAG_NAME
docker push registry.digitalocean.com/vlandivir-main/vlandivir-2025:$TAG_NAME

# Update the Docker container on the DigitalOcean droplet
SSH_COMMANDS="docker pull registry.digitalocean.com/vlandivir-main/vlandivir-2025:$TAG_NAME; \
docker stop vlandivir-2025; \
docker rm vlandivir-2025; \
docker run -d -p 443:443 -e ENVIRONMENT=PROD --name vlandivir-2025 registry.digitalocean.com/vlandivir-main/vlandivir-2025:$TAG_NAME"

ssh -o StrictHostKeyChecking=no root@$SERVER_IP "$SSH_COMMANDS"
