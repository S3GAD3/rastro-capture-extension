#!/usr/bin/env bash
# Genera certificado autofirmado y ficheros de prueba (requiere openssl, ImageMagick `convert` y ffmpeg).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixtures certs
[ -f certs/cert.pem ] || {
cat > certs/openssl.cnf <<'CNF'
[req]
distinguished_name=dn
x509_extensions=v3
prompt=no
[dn]
CN=rastro-test
[v3]
subjectAltName=DNS:*.instagram.com,DNS:instagram.com,DNS:*.cdninstagram.com,DNS:*.tiktok.com,DNS:tiktok.com,DNS:*.tiktokcdn.com,DNS:*.example-web.test,DNS:example-web.test
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout certs/key.pem -out certs/cert.pem -config certs/openssl.cnf 2>/dev/null; }
[ -f fixtures/img1.jpg ] || {
for i in 1 2 3; do
  col=$([ $i = 1 ] && echo "#c0392b" || ([ $i = 2 ] && echo "#2980b9" || echo "#27ae60"))
  convert -size 1080x1080 xc:"$col" -gravity center -pointsize 120 -fill white -annotate 0 "IMG $i" fixtures/img$i.jpg
  convert -size 320x320 xc:"$col" -gravity center -pointsize 50 -fill white -annotate 0 "thumb $i" fixtures/thumb$i.jpg
done
convert -size 150x150 xc:"#444" -gravity center -pointsize 30 -fill white -annotate 0 "avatar" fixtures/avatar.jpg
ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=2:size=540x960:rate=15 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart -shortest fixtures/video1.mp4
ffmpeg -loglevel error -y -f lavfi -i testsrc=duration=2:size=320x568:rate=15 -c:v libx264 -pix_fmt yuv420p -movflags +faststart fixtures/video2.mp4; }
echo "fixtures listos"
