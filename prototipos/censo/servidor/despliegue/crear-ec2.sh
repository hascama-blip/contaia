#!/usr/bin/env bash
# Crea el servidor del portal en EC2 (us-east-1): grupo de seguridad, instancia Ubuntu 24.04
# con el script de arranque, IP elástica y protección contra terminación.
#   CODIGO=<código de instalación> RAMA=main bash crear-ec2.sh
# Requiere AWS CLI con permisos de EC2 (AmazonEC2FullAccess).
set -euo pipefail
REGION="${REGION:-us-east-1}"
RAMA="${RAMA:-main}"
CODIGO="${CODIGO:?Falta CODIGO (código de instalación)}"
TIPO="${TIPO:-t4g.micro}"            # ARM, 2 vCPU, 1 GB · ~US$6/mes
NOMBRE="${NOMBRE:-portal-inmaculada}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
export AWS_DEFAULT_REGION="$REGION"

echo "== AMI Ubuntu 24.04 (arm64, oficial Canonical) =="
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text 2>/dev/null \
  || aws ec2 describe-images --owners 099720109477 --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*" "Name=state,Values=available" --query "sort_by(Images,&CreationDate)[-1].ImageId" --output text)
echo "AMI: $AMI"

echo "== Grupo de seguridad =="
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NOMBRE" Name=vpc-id,Values="$VPC" --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)
if [[ -z "$SG" || "$SG" == "None" ]]; then
  SG=$(aws ec2 create-security-group --group-name "$NOMBRE" --description "Portal C.C. Inmaculada Concepcion (web + ssh)" --vpc-id "$VPC" --query GroupId --output text)
  for p in 22 80 443; do aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port $p --cidr 0.0.0.0/0 >/dev/null; done
fi
echo "SG: $SG"

echo "== Script de arranque =="
sed -e "s|__RAMA__|$RAMA|; s|__CODIGO__|$CODIGO|; s|__DOMINIO__|${DOMINIO:-}|; s|__CORREO__|${CORREO:-}|" "$AQUI/arranque.sh" > /tmp/arranque.generado.sh

echo "== Instancia =="
ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TIPO" --security-group-ids "$SG" \
  --user-data file:///tmp/arranque.generado.sh \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3","DeleteOnTermination":false}}]' \
  --metadata-options HttpTokens=required \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NOMBRE},{Key=proyecto,Value=censo}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NOMBRE-disco},{Key=proyecto,Value=censo}]" \
  --query "Instances[0].InstanceId" --output text)
echo "Instancia: $ID"
aws ec2 wait instance-running --instance-ids "$ID"
aws ec2 modify-instance-attribute --instance-id "$ID" --disable-api-termination

echo "== IP elástica =="
ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NOMBRE" --query "Addresses[0].AllocationId" --output text 2>/dev/null || true)
if [[ -z "$ALLOC" || "$ALLOC" == "None" ]]; then
  ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NOMBRE}]" --query AllocationId --output text)
fi
aws ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query "Addresses[0].PublicIp" --output text)
rm -f /tmp/arranque.generado.sh
echo
echo "LISTO. IP pública fija: $IP"
echo "En 3-5 minutos: http://$IP/  → primera configuración con el código de instalación."
echo "GoDaddy: registros A de @ y www → $IP"
