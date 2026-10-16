#!/usr/bin/env bash
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
printf 'Region: %s\n' "$REGION"
printf '\nCaller (AWS-owned workshop account; redact account ID in screenshots):\n'
aws sts get-caller-identity --query '{Arn:Arn,Account:Account}' --output json
printf '\nCurrent public IPv4:\n'
curl -4fsS https://checkip.amazonaws.com
printf '\nDefault VPC (may be absent):\n'
aws ec2 describe-vpcs --region "$REGION" --filters Name=is-default,Values=true --query 'Vpcs[*].[VpcId,CidrBlock]' --output table
printf '\nAll VPCs:\n'
aws ec2 describe-vpcs --region "$REGION" --query 'Vpcs[*].[VpcId,CidrBlock,IsDefault]' --output table
printf '\nSubnets (check the chosen subnet route table for 0.0.0.0/0 -> Internet Gateway):\n'
aws ec2 describe-subnets --region "$REGION" --query 'Subnets[*].[SubnetId,VpcId,AvailabilityZone,MapPublicIpOnLaunch]' --output table
printf '\nAvailable key pair names:\n'
aws ec2 describe-key-pairs --region "$REGION" --query 'KeyPairs[*].KeyName' --output table
printf '\nAvailable instance families and actual workshop restrictions still need confirmation.\n'
