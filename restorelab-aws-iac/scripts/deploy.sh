#!/usr/bin/env bash
set -euo pipefail
: "${WORKSHOP_DEPLOYMENT_APPROVED:?Set to yes only after organizer approval for project code/data and external service connections.}"
if [[ "$WORKSHOP_DEPLOYMENT_APPROVED" != 'yes' ]]; then
  echo 'Workshop deployment approval must be yes.' >&2; exit 2
fi
for var in VPC_ID PUBLIC_SUBNET_ID KEY_NAME ADMIN_CIDR; do
  if [[ -z "${!var:-}" ]]; then echo "Required: $var" >&2; exit 2; fi
done
if [[ ! "$ADMIN_CIDR" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/32$ ]]; then
  echo 'ADMIN_CIDR must be your single IPv4/32 (never 0.0.0.0/0)' >&2; exit 2
fi
REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK_NAME:-restorelab-shared-backend}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
PUBLIC_HTTPS="${ENABLE_PUBLIC_HTTPS:-false}"
if [[ "$PUBLIC_HTTPS" != false && "$PUBLIC_HTTPS" != true ]]; then echo 'ENABLE_PUBLIC_HTTPS must be true or false' >&2; exit 2; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../infra/aws/backend.yaml"
aws cloudformation validate-template --region "$REGION" --template-body "file://$TEMPLATE" >/dev/null
aws cloudformation deploy \
  --region "$REGION" --stack-name "$STACK" \
  --template-file "$TEMPLATE" \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "VpcId=$VPC_ID" "PublicSubnetId=$PUBLIC_SUBNET_ID" \
    "KeyName=$KEY_NAME" "AdminCidr=$ADMIN_CIDR" \
    "InstanceType=$INSTANCE_TYPE" "EnablePublicHttps=$PUBLIC_HTTPS"
printf '\nStack outputs:\n'
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query 'Stacks[0].Outputs' --output table
printf '\nNote: CREATE_COMPLETE does not guarantee EC2 UserData bootstrap succeeded; SSH and check cloud-init.\n'
