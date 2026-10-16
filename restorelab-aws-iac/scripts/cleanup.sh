#!/usr/bin/env bash
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
STACK="${STACK_NAME:-restorelab-shared-backend}"
echo "This will delete $STACK in $REGION, including EC2 and its root EBS volume."
echo "Confirm with Samer that required evidence is saved OUTSIDE the AWS workshop account."
read -r -p "Type DELETE $STACK to continue: " reply
[[ "$reply" == "DELETE $STACK" ]] || { echo 'Cancelled'; exit 1; }
aws cloudformation delete-stack --region "$REGION" --stack-name "$STACK"
aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$STACK"
echo 'Stack deleted.'
