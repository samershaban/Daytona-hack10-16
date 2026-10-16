# RestoreLab — minimal AWS backend IaC

## Scope

This stack provisions only a **temporary host for Samer's authenticated shared API**: one Amazon Linux 2023 EC2 instance, an existing VPC/public subnet, restricted SSH security group, encrypted 20-GiB EBS root volume, Docker/bootstrap directory, and optional public HTTP/HTTPS ingress. It does **not** provision SurrealDB, deploy the application, distribute credentials, make an API publicly reachable by default, or set up TLS. It does not create an IAM role, database, NAT gateway, load balancer, Elastic IP, or S3 bucket.

RestoreLab uses separately managed SurrealDB Cloud/Agent Memory (confirm which Samer's code integrates), Daytona for isolated VAmPI recovery attempts, and AWS solely for shared API processing. Keep the deliberately vulnerable VAmPI target in approved isolated test infrastructure rather than deploying it on this public API host.

**Workshop terms gate:** The event account is AWS-owned and ephemeral. Before using this template to upload/deploy project files, synthetic fixtures, or connect external API credentials, obtain the event operator's confirmation that these are permitted/approved materials. Never introduce personal, financial, regulated, or otherwise disallowed data. Do not rely on this account for permanent access or data retention.

## 0. What you need

- Local AWS CLI authenticated to the workshop account (if CLI access is supported), permitted CloudFormation/EC2/SSM actions, AWS region (default `us-east-1`). A console-only workshop may require an organizer-supported path.
- Permission to create an EC2 instance/security group and use the existing VPC/subnet, plus a workshop-approved EC2 key pair.
- An existing VPC and subnet with Internet Gateway route `0.0.0.0/0` (do not assume `MapPublicIpOnLaunch` alone proves the route).
- Your current public IPv4 with `/32` for SSH. An EC2 key pair private `.pem` file stored locally with `chmod 400`.
- Approval to deploy your team's project and connect externally to managed SurrealDB.

## 1. Inventory before provisioning

```bash
export AWS_REGION=us-east-1
./scripts/inventory.sh
```

Choose the subnet only after checking routing and available permissions. If your workshop gives no key pair and creation is prohibited, ask the operator for the supported EC2 access method rather than opening SSH to everyone.

## 2. Validate the template

```bash
aws cloudformation validate-template \
  --region "$AWS_REGION" \
  --template-body file://infra/aws/backend.yaml
```

Template validation is not a deployment; CloudFormation or service permission failures must be checked in the workshop account. The code is not yet deployed or live-tested for you.

## 3. Deploy after approval

```bash
export WORKSHOP_DEPLOYMENT_APPROVED=yes
export VPC_ID=vpc-REPLACE
export PUBLIC_SUBNET_ID=subnet-REPLACE
export KEY_NAME=YOUR-EXISTING-KEY-NAME
export ADMIN_CIDR="$(curl -4fsS https://checkip.amazonaws.com | tr -d '\n')/32"
export ENABLE_PUBLIC_HTTPS=false
./scripts/deploy.sh
```

Note: `ENABLE_PUBLIC_HTTPS=false` is intentional. Ports 80 and 443 remain closed until authentication and TLS are ready. Port 3000 (backend) and 8000 (SurrealDB) are **never** publicly opened by this template. AWS-owned lab resources can be reclaimed without notice; coordinate before installing any secrets or data.

If `validate-template` or deploy fails, inspect:

```bash
aws cloudformation describe-stack-events \
  --region "$AWS_REGION" \
  --stack-name restorelab-shared-backend \
  --query 'StackEvents[0:12].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]' \
  --output table
```

Do not broaden IAM permissions or disable encryption to bypass workshop restrictions.

## 4. Verify host readiness

Use the returned PublicIp, then on your laptop:

```bash
chmod 400 /path/to/YOUR_KEY.pem
ssh -i /path/to/YOUR_KEY.pem ec2-user@PUBLIC_IP
```

Once logged into EC2:

```bash
sudo systemctl is-active docker
sudo docker info >/dev/null && echo 'Docker ready'
cat /opt/restorelab/bootstrap.status
sudo tail -n 50 /var/log/cloud-init-output.log
```

Expected: Docker active and `bootstrap complete`. `CREATE_COMPLETE` alone does not establish that UserData succeeded. Keep application port bound to `127.0.0.1:3000` during initial integration.

## 5. Samer deployment handoff

Samer supplies the real backend build/start command and API auth/health contract. After he reviews the code and the workshop operator approves deployment, transfer his build artifact or repository using the approved method. Do not assume it uses Docker or make up a working endpoint.

His backend receives its managed SurrealDB/Agent Memory credentials securely on the host in a restricted local environment file or approved secrets facility. Never put them into CloudFormation parameters, UserData, Git, screenshots, or group messages. Agent Memory is a distinct hosted API, not a self-hosted SurrealDB container.

For initial access from authorized developers, use an SSH tunnel (replace path/IP and local port):

```bash
ssh -i /path/to/YOUR_KEY.pem -N -L 13000:127.0.0.1:3000 ec2-user@PUBLIC_IP
# From your laptop, once the API is running: curl http://127.0.0.1:13000/<ACTUAL_HEALTH_ROUTE>
```

Each teammate needs authorized host access/tunnel; a tunnel is not a public endpoint. For Daytona and remote clients, wait until a genuine authenticated HTTPS endpoint is set up.

## 6. Public HTTPS, only when ready

After Samer's API authorization is functional and a tested TLS reverse proxy is installed, change `ENABLE_PUBLIC_HTTPS=true` and rerun `./scripts/deploy.sh`. This opens 80/443 at the SG; **it does not automatically configure or prove TLS**. Route only to the authenticated API on loopback; leave 3000/8000 closed. Agree on DNS/certificate strategy (workshop restrictions may prevent Route 53 or ACM). Do not transmit application/API credentials over public plaintext HTTP. The instance public IPv4 is ephemeral and can change on stop/start.

## 7. Stop and cleanup

Export only permitted, sanitized artifacts to a team-controlled location outside the workshop account. Verify that no vital run history exists only on EC2. Then:

```bash
./scripts/cleanup.sh
```

Stack deletion destroys the EC2 instance and root EBS. The default stack creates no persistent AWS storage services.

## Source documentation

- [AWS CloudFormation EC2 Instance](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html)
- [AWS EC2 Metadata Options](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-ec2-instance-metadataoptions.html)
- [Amazon Linux 2023 AMI via SSM parameter](https://docs.aws.amazon.com/linux/al2023/ug/ec2.html)
