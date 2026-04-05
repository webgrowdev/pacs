#!/usr/bin/env bash
# =============================================================================
# PACSMed — Script de deploy para Hostinger
# =============================================================================
#
# USO:
#   chmod +x scripts/deploy-hostinger.sh
#   ./scripts/deploy-hostinger.sh
#
# RESULTADO:
#   Genera el archivo  dist/pacsmed-deploy-FECHA.zip  listo para subir.
#
# REQUISITOS locales (en tu máquina de desarrollo, NO en Hostinger):
#   - Node.js >= 18
#   - npm >= 9
#   - zip
#
# ESTRUCTURA del ZIP generado:
#   frontend/          ← archivos estáticos del frontend (subir a public_html/)
#     index.html
#     assets/
#     _cs/
#     .htaccess        ← configuración Apache para SPA + proxy al backend
#   backend/           ← backend Node.js compilado (subir a un VPS o Railway)
#     dist/
#     package.json
#     package-lock.json
#     .env.example
#     ecosystem.config.cjs  ← config PM2 para producción
#
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/deploy"
ZIP_NAME="pacsmed-deploy-$(date +%Y%m%d-%H%M%S).zip"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║       PACSMed — Build para Hostinger         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─── Limpieza previa ──────────────────────────────────────────────────────────
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/frontend"
mkdir -p "$DIST_DIR/backend"

# =============================================================================
# 1. BUILD FRONTEND
# =============================================================================
echo "▶ [1/4] Construyendo frontend (Vite)..."

cd "$ROOT_DIR/frontend"

# Instalar dependencias si hace falta
if [ ! -d "node_modules" ]; then
  echo "  → Instalando dependencias del frontend..."
  npm install
fi

# Build de producción
npm run build

# Copiar dist al paquete de deploy
cp -r dist/* "$DIST_DIR/frontend/"

# ─── .htaccess para Apache (Hostinger usa Apache) ────────────────────────────
# Redirige todas las rutas al index.html para que React Router funcione.
# El proxy /api y /files apunta al backend (ajusta la URL según tu VPS).
cat > "$DIST_DIR/frontend/.htaccess" << 'HTACCESS'
Options -Indexes

# ─── SPA routing — todas las rutas van a index.html ──────────────────────────
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  # No redirigir archivos y directorios existentes
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d

  # No redirigir assets estáticos
  RewriteCond %{REQUEST_URI} !^/assets/
  RewriteCond %{REQUEST_URI} !^/_cs/

  # Todo lo demás → index.html
  RewriteRule ^ index.html [QSA,L]
</IfModule>

# ─── Seguridad básica ─────────────────────────────────────────────────────────
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "DENY"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

# ─── Cache de assets estáticos ───────────────────────────────────────────────
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html                 "access plus 0 seconds"
  ExpiresByType application/javascript    "access plus 1 year"
  ExpiresByType text/css                  "access plus 1 year"
  ExpiresByType image/png                 "access plus 1 year"
  ExpiresByType image/svg+xml             "access plus 1 year"
  ExpiresByType font/woff2                "access plus 1 year"
</IfModule>

# ─── Comprimir respuestas ─────────────────────────────────────────────────────
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/plain text/css application/javascript application/json
</IfModule>

# ─── Nota sobre el proxy al backend ──────────────────────────────────────────
# Hostinger compartido NO soporta mod_proxy.
# El frontend usa la variable VITE_API_URL para apuntar al backend.
# Asegúrate de configurar VITE_API_URL en tu .env.production antes del build.
HTACCESS

echo "  ✓ Frontend construido → $DIST_DIR/frontend/"

# =============================================================================
# 2. BUILD BACKEND
# =============================================================================
echo ""
echo "▶ [2/4] Construyendo backend (TypeScript)..."

cd "$ROOT_DIR/backend"

if [ ! -d "node_modules" ]; then
  echo "  → Instalando dependencias del backend..."
  npm install
fi

# Generar cliente Prisma
echo "  → Generando cliente Prisma..."
npx prisma generate

# Compilar TypeScript
npm run build

# Copiar archivos necesarios para producción
cp -r dist "$DIST_DIR/backend/dist"
cp package.json "$DIST_DIR/backend/"
cp package-lock.json "$DIST_DIR/backend/" 2>/dev/null || true

# Copiar schema de prisma (necesario para migrate en producción)
mkdir -p "$DIST_DIR/backend/prisma"
cp prisma/schema.prisma "$DIST_DIR/backend/prisma/"
cp -r prisma/migrations "$DIST_DIR/backend/prisma/" 2>/dev/null || true

echo "  ✓ Backend construido → $DIST_DIR/backend/"

# =============================================================================
# 3. ARCHIVOS DE CONFIGURACIÓN
# =============================================================================
echo ""
echo "▶ [3/4] Generando archivos de configuración..."

# ─── .env.example ─────────────────────────────────────────────────────────────
cat > "$DIST_DIR/backend/.env.example" << 'ENV'
# =============================================================================
# PACSMed Backend — Variables de entorno de PRODUCCIÓN
# =============================================================================
# Copia este archivo como .env y completa todos los valores.
# NUNCA subas el .env real a un repositorio git.

NODE_ENV=production
PORT=4000
APP_VERSION=1.0.0

# Base de datos MySQL (Hostinger ofrece MySQL en todos los planes)
DATABASE_URL="mysql://USUARIO:CONTRASEÑA@localhost:3306/NOMBRE_BD"
DATABASE_PROVIDER=mysql

# JWT — genera con: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_ACCESS_SECRET=CAMBIAR_POR_SECRETO_ALEATORIO_DE_48_BYTES_HEX
JWT_REFRESH_SECRET=CAMBIAR_POR_OTRO_SECRETO_ALEATORIO_DE_48_BYTES_HEX

# URLs
APP_BASE_URL=https://tu-dominio.com
CORS_ORIGIN=https://tu-dominio.com

# Almacenamiento de archivos DICOM
STORAGE_ROOT=/home/usuario/pacsmed/storage

# DICOM
DICOM_AE_TITLE=PACS_SERVER
DICOM_SCP_PORT=11112
DICOM_SYSTEM_TOKEN=CAMBIAR_POR_TOKEN_PARA_EQUIPOS_DICOMWEB
DICOM_ALLOWED_IPS=

# SFTP drop folder
SFTP_DROP_FOLDER=/home/usuario/pacsmed/sftp-drop

# Email (opcional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=PACSMed <noreply@tu-dominio.com>

# OpenAI (opcional — requiere HIPAA BAA)
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
ENV

# ─── PM2 ecosystem config ─────────────────────────────────────────────────────
cat > "$DIST_DIR/backend/ecosystem.config.cjs" << 'PM2'
// PM2 process manager configuration
// Uso: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'pacsmed-backend',
    script: './dist/index.js',
    instances: 1,           // Un solo proceso (DICOM SCP es stateful)
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    // Reinicio automático si el proceso muere
    restart_delay: 5000,
    max_restarts: 10,
    // Logs
    out_file:   './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
PM2

# ─── Script de instalación rápida para VPS ────────────────────────────────────
cat > "$DIST_DIR/backend/install-vps.sh" << 'INSTALL'
#!/bin/bash
# =============================================================================
# PACSMed Backend — Instalación en VPS (Ubuntu/Debian)
# =============================================================================
# Ejecutar como root o con sudo en el VPS:
#   bash install-vps.sh

set -e

echo "==> Actualizando sistema..."
apt-get update -y

echo "==> Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Instalando PM2..."
npm install -g pm2

echo "==> Instalando dependencias del backend..."
npm install --omit=dev

echo "==> Creando directorios de almacenamiento..."
mkdir -p storage/dicom storage/pdfs storage/tmp
mkdir -p sftp-drop/processed sftp-drop/failed
mkdir -p logs

echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║  PASOS SIGUIENTES:                             ║"
echo "║  1. cp .env.example .env                       ║"
echo "║  2. nano .env          (completar variables)   ║"
echo "║  3. npx prisma migrate deploy                  ║"
echo "║  4. npx prisma db seed (crear usuario admin)   ║"
echo "║  5. pm2 start ecosystem.config.cjs             ║"
echo "║  6. pm2 startup && pm2 save                    ║"
echo "╚════════════════════════════════════════════════╝"
INSTALL
chmod +x "$DIST_DIR/backend/install-vps.sh"

echo "  ✓ Archivos de configuración generados"

# =============================================================================
# 4. EMPAQUETAR ZIP
# =============================================================================
echo ""
echo "▶ [4/4] Creando paquete ZIP..."

mkdir -p "$ROOT_DIR/dist"
cd "$DIST_DIR/.."
zip -r "$ROOT_DIR/dist/$ZIP_NAME" "deploy/" -x "*.DS_Store" "*/node_modules/*"

FILESIZE=$(du -sh "$ROOT_DIR/dist/$ZIP_NAME" | cut -f1)

echo ""
echo "╔══════════════════════════════════════════════════════════════════════╗"
echo "║  ✓ Build completado exitosamente                                    ║"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  Archivo generado:  dist/$ZIP_NAME"
echo "║  Tamaño:            $FILESIZE"
echo "╠══════════════════════════════════════════════════════════════════════╣"
echo "║  PASOS PARA DEPLOY:                                                 ║"
echo "║                                                                      ║"
echo "║  FRONTEND (Hostinger compartido):                                   ║"
echo "║  1. Subir contenido de deploy/frontend/ a public_html/ via FTP     ║"
echo "║  2. Asegurar que .htaccess está incluido                           ║"
echo "║                                                                      ║"
echo "║  BACKEND (VPS / Railway / Render):                                  ║"
echo "║  1. Subir deploy/backend/ al servidor                              ║"
echo "║  2. Ejecutar: bash install-vps.sh                                  ║"
echo "║  3. Configurar .env con los datos de producción                    ║"
echo "║  4. npx prisma migrate deploy && npx prisma db seed                ║"
echo "║  5. pm2 start ecosystem.config.cjs                                 ║"
echo "║                                                                      ║"
echo "║  Ver guía completa en: docs/DEPLOY-HOSTINGER.md                    ║"
echo "╚══════════════════════════════════════════════════════════════════════╝"
echo ""
