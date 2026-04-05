# PACSMed — Guía de Deploy en Hostinger

## Índice
1. [Arquitectura del deploy](#arquitectura)
2. [Prerrequisitos](#prerrequisitos)
3. [Paso 1 — Build local](#build-local)
4. [Paso 2 — Frontend en Hostinger compartido](#frontend-hostinger)
5. [Paso 3 — Backend en VPS o servicio externo](#backend)
6. [Paso 4 — Conectar frontend con backend](#conectar)
7. [Paso 5 — Base de datos MySQL](#base-de-datos)
8. [Paso 6 — Dominio y SSL](#dominio-ssl)
9. [Paso 7 — Verificación final](#verificacion)
10. [Opciones de hosting del backend](#opciones-backend)
11. [Mantenimiento](#mantenimiento)

---

## Arquitectura del deploy {#arquitectura}

```
┌────────────────────────────────────────────────────────────────┐
│                    HOSTINGER COMPARTIDO                        │
│                                                                │
│   public_html/                                                 │
│   ├── index.html          ← React SPA (build estático)        │
│   ├── assets/             ← JS, CSS, imágenes compiladas      │
│   ├── _cs/               ← Worker DICOM pre-bundleado         │
│   └── .htaccess          ← SPA routing + caché                │
└────────────────────────────────────────────────────────────────┘
          ↓ fetch('/api/...') apunta a →
┌────────────────────────────────────────────────────────────────┐
│              VPS / RAILWAY / RENDER                            │
│                                                                │
│   Node.js + Express (Puerto 4000)                             │
│   ├── API REST  (/api/*)                                      │
│   ├── DICOM SCP (Puerto TCP 11112)                            │
│   ├── Archivos DICOM (/files/*)                               │
│   └── MySQL (Base de datos)                                   │
└────────────────────────────────────────────────────────────────┘
```

> **Importante**: Hostinger compartido NO soporta Node.js. Solo sirve archivos estáticos PHP/HTML.
> El backend DEBE ejecutarse en un VPS o servicio externo.

---

## Prerrequisitos {#prerrequisitos}

**En tu máquina local (donde haces el build):**
- Node.js ≥ 18
- npm ≥ 9
- zip (Linux/Mac: preinstalado; Windows: usar WSL o 7-zip)
- Git

**En Hostinger compartido:**
- Plan Premium, Business o superior (necesitas acceso FTP/cPanel)
- Dominio configurado

**Para el backend (elige una opción):**
- Hostinger VPS (KVM 1 o superior) — recomendado
- Railway.app (plan Hobby: $5/mes)
- Render.com (plan Individual: $7/mes)
- Cualquier VPS con Ubuntu 20+ y Node.js

---

## Paso 1 — Build local {#build-local}

```bash
# Clona el repositorio en tu máquina
git clone https://github.com/tu-usuario/pacs.git
cd pacs

# Ejecuta el script de build
chmod +x scripts/deploy-hostinger.sh
./scripts/deploy-hostinger.sh
```

El script genera: `dist/pacsmed-deploy-FECHA.zip`

Descomprime el ZIP y encontrarás:
```
deploy/
├── frontend/      ← subir a public_html/ en Hostinger
└── backend/       ← subir al VPS o servicio externo
```

---

## Paso 2 — Frontend en Hostinger compartido {#frontend-hostinger}

### 2.1 — Configurar la URL del backend ANTES del build

Edita `frontend/.env.production` (créalo si no existe):

```env
VITE_API_URL=https://api.tu-dominio.com
VITE_FILES_URL=https://api.tu-dominio.com/files
```

Luego ejecuta el build (`./scripts/deploy-hostinger.sh`).

### 2.2 — Subir archivos via FTP (FileZilla)

1. Abre **FileZilla** (o el gestor de FTP de tu preferencia)
2. Conecta al servidor FTP de Hostinger:
   - Host: `ftp.tu-dominio.com`
   - Usuario y contraseña: los de tu cuenta Hostinger
   - Puerto: `21`
3. Navega a `public_html/` en el panel derecho
4. Sube **todo el contenido** de `deploy/frontend/` (no la carpeta, sino su contenido)

La estructura final en el servidor debe ser:
```
public_html/
├── index.html
├── .htaccess          ← IMPORTANTE — asegúrate de que esté
├── assets/
│   ├── index-HASH.js
│   └── index-HASH.css
└── _cs/
    └── decodeImageFrameWorker.js
```

### 2.3 — Verificar que .htaccess está activo

> En Hostinger, los archivos que empiezan con `.` a veces no se muestran en FileZilla.
> Activa "Ver archivos ocultos" en el menú Servidor de FileZilla.

El `.htaccess` incluido configura:
- ✅ Routing SPA (todas las rutas → `index.html`)
- ✅ Caché de 1 año para assets estáticos
- ✅ Compresión gzip
- ✅ Headers de seguridad

### 2.4 — Subir via cPanel (alternativa a FTP)

1. Accede al cPanel de Hostinger
2. Ve a **Archivos → Administrador de archivos**
3. Navega a `public_html/`
4. Usa el botón **Cargar** para subir el ZIP de frontend
5. Descomprímelo en el servidor con clic derecho → **Extraer**
6. Mueve el contenido de la subcarpeta a `public_html/`

---

## Paso 3 — Backend en VPS o servicio externo {#backend}

### Opción A — Hostinger VPS (recomendado para producción)

```bash
# En tu VPS (Ubuntu 22.04), como root:

# 1. Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 2. Instalar PM2 (gestor de procesos)
npm install -g pm2

# 3. Crear directorio de la aplicación
mkdir -p /opt/pacsmed
cd /opt/pacsmed

# 4. Subir deploy/backend/ al VPS via SCP:
#    (ejecutar esto en tu máquina local)
scp -r deploy/backend/* root@IP-DEL-VPS:/opt/pacsmed/

# 5. En el VPS: instalar dependencias y configurar
cd /opt/pacsmed
bash install-vps.sh

# 6. Configurar variables de entorno
cp .env.example .env
nano .env          # Completar con tus datos reales

# 7. Ejecutar migraciones de base de datos
npx prisma migrate deploy

# 8. Crear usuario administrador inicial
node dist/prisma/seed.js   # o: npx prisma db seed

# 9. Iniciar con PM2
pm2 start ecosystem.config.cjs
pm2 startup    # Para que inicie al reiniciar el servidor
pm2 save

# 10. Abrir puertos en el firewall
ufw allow 4000/tcp    # API HTTP
ufw allow 11112/tcp   # DICOM SCP
ufw allow 22/tcp      # SSH
ufw enable
```

### Opción B — Railway.app (más simple, sin mantener servidor)

1. Ve a [railway.app](https://railway.app) y crea una cuenta
2. Crea un nuevo proyecto → **Deploy from GitHub repo**
3. Conecta tu repositorio
4. Agrega un servicio **MySQL** (Railway lo provisiona automáticamente)
5. En Variables de entorno del servicio, configura las mismas variables del `.env.example`
6. Railway detecta el `package.json` y despliega automáticamente

> Railway genera una URL pública como `https://pacsmed-xxx.railway.app`
> Úsala como `VITE_API_URL` en el frontend.

---

## Paso 4 — Conectar frontend con backend {#conectar}

El frontend usa la variable `VITE_API_URL` para apuntar al backend. Si NO configuraste esta variable antes del build, edita `frontend/src/lib/api.ts` para hardcodear la URL:

```typescript
// frontend/src/lib/api.ts — ejemplo de override manual
const BASE_URL = 'https://api.tu-dominio.com';
```

O mejor: reconstruye con el `.env.production` correcto:

```bash
# Crear frontend/.env.production
echo "VITE_API_URL=https://api.tu-dominio.com" > frontend/.env.production
echo "VITE_FILES_URL=https://api.tu-dominio.com/files" >> frontend/.env.production

# Rebuild
./scripts/deploy-hostinger.sh
```

**Configuración CORS en el backend:**

En el `.env` del backend, asegúrate de incluir la URL de Hostinger:
```env
CORS_ORIGIN=https://tu-dominio.com,https://www.tu-dominio.com
```

---

## Paso 5 — Base de datos MySQL {#base-de-datos}

### Opción A — MySQL en Hostinger compartido (con VPS Backend)

Hostinger compartido incluye bases de datos MySQL en el cPanel.
El backend en el VPS puede conectarse a ellas remotamente.

**En cPanel de Hostinger:**
1. **Bases de datos MySQL → Crear base de datos**
   - Nombre: `pacsmed_prod`
2. **Crear usuario MySQL**
   - Usuario: `pacsmed_user`
   - Contraseña: (generar aleatoria)
3. **Agregar usuario a la base de datos** con todos los permisos
4. **Habilitar acceso remoto** (Bases de datos → Acceso remoto):
   - Agregar la IP del VPS

**En el `.env` del backend:**
```env
DATABASE_URL="mysql://pacsmed_user:CONTRASEÑA@tu-dominio.com:3306/pacsmed_prod"
DATABASE_PROVIDER=mysql
```

### Opción B — MySQL en el VPS

```bash
# En el VPS Ubuntu:
apt-get install -y mysql-server

# Crear base de datos y usuario
mysql -u root -p << 'SQL'
CREATE DATABASE pacsmed_prod CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pacsmed'@'localhost' IDENTIFIED BY 'CONTRASEÑA_SEGURA';
GRANT ALL PRIVILEGES ON pacsmed_prod.* TO 'pacsmed'@'localhost';
FLUSH PRIVILEGES;
SQL
```

```env
# .env del backend
DATABASE_URL="mysql://pacsmed@localhost:3306/pacsmed_prod"
```

---

## Paso 6 — Dominio y SSL {#dominio-ssl}

### Frontend (Hostinger compartido)

Hostinger activa SSL automáticamente con Let's Encrypt para dominios conectados.
Ve a **SSL → Let's Encrypt** en el cPanel y actívalo.

### Backend (VPS con Nginx + Certbot)

```bash
# En el VPS: instalar Nginx como proxy reverso
apt-get install -y nginx certbot python3-certbot-nginx

# Crear configuración de Nginx
cat > /etc/nginx/sites-available/pacsmed << 'NGINX'
server {
    server_name api.tu-dominio.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Soporte para archivos DICOM grandes
        client_max_body_size 500M;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
    }
}
NGINX

ln -s /etc/nginx/sites-available/pacsmed /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Obtener certificado SSL
certbot --nginx -d api.tu-dominio.com
```

---

## Paso 7 — Verificación final {#verificacion}

```bash
# 1. Verificar que el backend responde
curl https://api.tu-dominio.com/health

# Respuesta esperada:
# {"status":"ok","service":"pacs-backend","version":"1.0.0"}

# 2. Verificar frontend (en el navegador)
# Abrir https://tu-dominio.com
# Debe mostrar la pantalla de login

# 3. Verificar DICOM SCP (desde un equipo en la red)
# Configurar el equipo con:
#   IP: la IP del VPS
#   Puerto: 11112
#   AE Title destino: PACS_SERVER (o el valor de DICOM_AE_TITLE)
# Hacer un DICOM Echo → debe responder OK

# 4. Login con credenciales del admin (creadas en el seed):
#   Email: admin@pacsmed.local
#   Password: Admin1234! (CAMBIAR INMEDIATAMENTE)
```

---

## Opciones de hosting del backend {#opciones-backend}

| Opción | Costo | DICOM SCP (TCP) | Ventajas | Desventajas |
|--------|-------|-----------------|----------|-------------|
| **Hostinger VPS KVM 1** | ~$5/mes | ✅ Sí | Control total, mismo proveedor | Requiere mantenimiento |
| **Railway.app** | ~$5/mes | ❌ No (solo HTTP) | Muy simple, auto-deploy | Sin puertos TCP custom |
| **Render.com** | ~$7/mes | ❌ No (solo HTTP) | Buena integración GitHub | Sin puertos TCP custom |
| **DigitalOcean Droplet** | ~$6/mes | ✅ Sí | Muy estable, buena docs | Requiere configuración |
| **Contabo VPS** | ~$5/mes | ✅ Sí | Muy barato, mucha RAM | Soporte básico |

> **Para usar DICOM SCP** (recibir imágenes directamente desde equipos via red), **necesitas un VPS** con puerto TCP abierto.
> Railway/Render solo soportan HTTP/HTTPS — solo podrás usar DICOMweb o subida manual.

---

## Mantenimiento {#mantenimiento}

### Actualizar a una nueva versión

```bash
# En tu máquina local:
git pull origin main
./scripts/deploy-hostinger.sh

# Subir frontend: reemplazar public_html/ con deploy/frontend/
# Actualizar backend:
scp -r deploy/backend/dist/* root@IP-VPS:/opt/pacsmed/dist/
ssh root@IP-VPS "cd /opt/pacsmed && npx prisma migrate deploy && pm2 restart pacsmed-backend"
```

### Backup de la base de datos

```bash
# En el VPS (programar con cron):
mysqldump -u pacsmed -p pacsmed_prod > backup-$(date +%Y%m%d).sql
```

### Backup de archivos DICOM

```bash
# Comprimir el storage (los archivos DICOM pueden ser grandes)
tar -czf dicom-backup-$(date +%Y%m%d).tar.gz /opt/pacsmed/storage/
```

### Monitoreo con PM2

```bash
pm2 status          # Ver estado del proceso
pm2 logs            # Ver logs en tiempo real
pm2 restart pacsmed-backend    # Reiniciar
pm2 monit           # Dashboard de métricas
```

---

## Contacto y soporte

Si el puerto DICOM SCP (11112) está bloqueado por el ISP o el firewall del VPS:
1. Usa el puerto alternativo 104 (estándar DICOM, requiere root)
2. Configura el mismo número de puerto en todos los equipos
3. Verifica con: `telnet IP-VPS 11112`

Para configurar equipos DICOM, consulta la pestaña **Tutorial de conexión** en el panel Admin del sistema.
