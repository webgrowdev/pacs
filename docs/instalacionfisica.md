# Instalación Física de PACsMed en Mini PC

> Guía paso a paso para montar el sistema PACsMed desde cero en una mini PC, conectarla a la red clínica y comenzar a recibir estudios DICOM de equipos médicos (rayos X, ecógrafo, tomógrafo, resonancia, etc.).

---

## Índice

1. [¿Qué hace este sistema?](#1-qué-hace-este-sistema)
2. [Hardware recomendado](#2-hardware-recomendado)
3. [Diagrama de red](#3-diagrama-de-red)
4. [Instalación del sistema operativo](#4-instalación-del-sistema-operativo)
5. [Configuración de red estática](#5-configuración-de-red-estática)
6. [Instalación de dependencias del sistema](#6-instalación-de-dependencias-del-sistema)
7. [Instalación de Orthanc (servidor DICOM)](#7-instalación-de-orthanc-servidor-dicom)
8. [Instalación de PACsMed](#8-instalación-de-pacsmed)
9. [Configurar Nginx como proxy inverso](#9-configurar-nginx-como-proxy-inverso)
10. [Gestión de procesos con PM2](#10-gestión-de-procesos-con-pm2)
11. [Firewall y seguridad básica](#11-firewall-y-seguridad-básica)
12. [Conectar un equipo DICOM a la red](#12-conectar-un-equipo-dicom-a-la-red)
13. [Primera prueba end-to-end](#13-primera-prueba-end-to-end)
14. [Mantenimiento y operación diaria](#14-mantenimiento-y-operación-diaria)
15. [Resolución de problemas frecuentes](#15-resolución-de-problemas-frecuentes)
16. [Glosario](#16-glosario)

---

## 1. ¿Qué hace este sistema?

PACsMed es un sistema web de gestión de imágenes médicas (PACS) que permite:

- **Recibir estudios DICOM** enviados por equipos de diagnóstico por imágenes.
- **Visualizar** imágenes DICOM directamente en el navegador (sin software adicional).
- **Informar** estudios con soporte de IA editorial (el médico siempre valida).
- **Generar PDFs** del informe firmado.
- **Portal del paciente** para ver resultados en línea.

El sistema corre 100 % en la red local (sin necesidad de internet) y puede servir a cualquier computadora o tablet conectada a la misma red.

---

## 2. Hardware recomendado

### Mini PC (servidor)

| Componente | Mínimo | Recomendado |
|------------|--------|-------------|
| **CPU** | Intel Core i3 / AMD Ryzen 3 (4 núcleos) | Intel Core i5 / AMD Ryzen 5 (6–8 núcleos) |
| **RAM** | 8 GB DDR4 | 16 GB DDR4 |
| **Almacenamiento SO + software** | SSD de 128 GB | SSD de 256 GB (NVMe preferible) |
| **Almacenamiento DICOM** | HDD de 500 GB | HDD/SSD de 1–2 TB (separado del SO) |
| **Red** | Ethernet Gigabit (1 GbE) | Ethernet Gigabit (cableado, no Wi-Fi) |
| **Puertos** | 2× USB 3.0, HDMI, RJ-45 | Igual + USB-C, 2× RJ-45 |
| **Sistema operativo** | Ubuntu Server 24.04 LTS | Ubuntu Server 24.04 LTS |

> **Nota:** Modelos probados o equivalentes: Intel NUC 12/13, Beelink EQ12 / SEi12, Minisforum UM560. Cualquier mini PC con las especificaciones anteriores funciona. Evitar Raspberry Pi para producción con más de 2 usuarios simultáneos.

### Switch de red (si conectas más de 2 equipos)

- Switch gestionable o no gestionable Gigabit de 5 u 8 puertos (TP-Link, Netgear, D-Link).
- Si ya existe un switch en la clínica, basta con conectar la mini PC a un puerto libre.

### Equipo de diagnóstico (modalidad DICOM)

- Cualquier equipo con salida DICOM sobre red TCP/IP (rayos X digital, ecógrafo, tomógrafo, resonancia magnética, mamógrafo, etc.).
- El equipo debe tener configurado un **AE Title**, una **IP estática** y el puerto **DICOM SCP 104** (o el que use el fabricante). El equipo actúa como SCU (cliente que envía) y el servidor PACS actúa como SCP (servidor que recibe).

### Estaciones de trabajo (clientes)

- Cualquier PC o laptop con navegador moderno (Chrome 110+, Firefox 110+, Edge 110+).
- No requieren software adicional: el visor DICOM corre en el navegador.

---

## 3. Diagrama de red

```
                          ┌─────────────────────────────┐
                          │        RED LOCAL (LAN)       │
                          │         192.168.1.0/24        │
                          └─────────────────────────────┘
                                        │
              ┌─────────────────────────┼───────────────────────────┐
              │                         │                           │
    ┌─────────┴──────┐      ┌───────────┴──────────┐    ┌──────────┴─────────┐
    │  Mini PC PACS  │      │  Equipo DICOM (RX/TC) │    │  PC Médico / Admin │
    │  192.168.1.10  │      │   192.168.1.20        │    │  192.168.1.30      │
    │  (servidor)    │      │  AE: MODALITY01       │    │  (navegador web)   │
    └────────────────┘      └───────────────────────┘    └────────────────────┘
         │   Servicios:
         │   Puerto 80/443 → Nginx → Frontend (React)
         │   Puerto 4000   → Backend API (Node.js)
         │   Puerto 4104   → Orthanc DICOM (DIMSE)
         │   Puerto 8042   → Orthanc REST API
         │   Puerto 3306   → MySQL (solo local)
```

> **Importante:** Asignar una IP estática a la mini PC es imprescindible para que los equipos DICOM siempre encuentren el servidor.

---

## 4. Instalación del sistema operativo

### 4.1 Descargar Ubuntu Server 24.04 LTS

```
https://ubuntu.com/download/server
```

Descarga el archivo `.iso` (≈ 2 GB).

### 4.2 Crear USB booteable

En Windows:
```
Herramienta: Rufus (https://rufus.ie)
- Seleccionar el .iso
- Esquema de partición: GPT
- Sistema de destino: UEFI (no CSM)
- Iniciar
```

En Linux/macOS:
```bash
sudo dd if=ubuntu-24.04-live-server-amd64.iso of=/dev/sdX bs=4M status=progress
# Reemplazar /dev/sdX por el dispositivo USB (ver con lsblk)
```

### 4.3 Instalar Ubuntu Server

1. Insertar el USB en la mini PC y encenderla (puede ser necesario entrar al BIOS con F2/Del/F12 para elegir el orden de boot).
2. Seleccionar **"Try or Install Ubuntu Server"**.
3. Seguir el asistente:
   - Idioma: English (recomendado para logs) o Español.
   - Distribución de teclado: la de tu país.
   - Tipo de instalación: **Ubuntu Server (minimized)**.
   - Red: configurar IP estática (ver sección 5) o dejar DHCP y configurar después.
   - Almacenamiento:
     - Disco 1 (SSD): instalar el SO aquí → usar **todo el disco**.
     - Disco 2 (HDD): no formatearlo en este paso; se configura después.
   - Nombre del servidor: `pacsmed`
   - Usuario: `pacsadmin` (o el que prefieras)
   - Contraseña: usar una contraseña fuerte (mínimo 12 caracteres).
   - Instalar **OpenSSH Server**: **sí** (para administración remota).
4. Reiniciar y retirar el USB cuando lo pida.

---

## 5. Configuración de red estática

Acceder a la mini PC directamente (teclado + monitor) o via SSH desde otra PC:

```bash
ssh pacsadmin@192.168.1.10   # IP que asignó el DHCP durante la instalación
```

### 5.1 Identificar la interfaz de red

```bash
ip link show
# Buscar el nombre de la interfaz Ethernet, ej: eno1, eth0, enp3s0
```

### 5.2 Editar la configuración netplan

```bash
sudo nano /etc/netplan/00-installer-config.yaml
```

Reemplazar el contenido con:

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    eno1:                          # ← cambiar por el nombre real de tu interfaz
      dhcp4: false
      addresses:
        - 192.168.1.10/24          # ← IP estática deseada
      routes:
        - to: default
          via: 192.168.1.1         # ← gateway (router)
      nameservers:
        addresses:
          - 8.8.8.8
          - 1.1.1.1
```

Aplicar:

```bash
sudo netplan apply
ip addr show eno1   # Verificar la IP
```

---

## 6. Instalación de dependencias del sistema

### 6.1 Actualizar el sistema

```bash
sudo apt update && sudo apt upgrade -y
```

### 6.2 Instalar utilidades básicas

```bash
sudo apt install -y curl wget git unzip build-essential ca-certificates gnupg
```

### 6.3 Instalar Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # Debe mostrar v20.x.x
npm --version
```

### 6.4 Instalar MySQL 8

```bash
sudo apt install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql
```

Configuración inicial segura:

```bash
sudo mysql_secure_installation
# Seguir el asistente:
# - Validate Password Component: No (o Yes según preferencia)
# - Remove anonymous users: Yes
# - Disallow root login remotely: Yes
# - Remove test database: Yes
# - Reload privilege tables: Yes
```

Crear la base de datos y usuario para PACsMed:

```bash
sudo mysql -u root -p
```

```sql
CREATE DATABASE pacs_mvp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'pacsuser'@'localhost' IDENTIFIED BY 'PacsM3d_S3guro!';
GRANT ALL PRIVILEGES ON pacs_mvp.* TO 'pacsuser'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 6.5 Instalar Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 6.6 Instalar PM2 (gestor de procesos Node.js)

```bash
sudo npm install -g pm2
```

### 6.7 Montar el disco de almacenamiento DICOM (si tiene disco secundario)

Identificar el disco:

```bash
lsblk
# Buscar el HDD/SSD secundario, ej: /dev/sdb
```

Formatear y montar:

```bash
sudo mkfs.ext4 /dev/sdb
sudo mkdir -p /data/pacsmed
sudo mount /dev/sdb /data/pacsmed
```

Hacer el montaje permanente:

```bash
# Obtener el UUID del disco
sudo blkid /dev/sdb
# Copiar el UUID, ej: 550e8400-e29b-41d4-a716-446655440000

sudo nano /etc/fstab
# Agregar al final:
UUID=550e8400-e29b-41d4-a716-446655440000  /data/pacsmed  ext4  defaults  0  2
```

Verificar:

```bash
sudo mount -a
df -h /data/pacsmed   # Debe mostrar el disco montado
```

Crear estructura de directorios:

```bash
sudo mkdir -p /data/pacsmed/{dicom,pdfs,backups}
sudo chown -R pacsadmin:pacsadmin /data/pacsmed
```

---

## 7. Instalación de Orthanc (servidor DICOM)

> **¿Por qué Orthanc?**
> Los equipos de diagnóstico por imágenes hablan el protocolo **DICOM** (no HTTP). Orthanc actúa como receptor DICOM en la red local y puede reenviar los estudios al backend de PACsMed. Sin Orthanc (o un servidor DICOM equivalente), los equipos no pueden enviar estudios automáticamente.

### 7.1 Instalar Orthanc

```bash
sudo apt install -y orthanc orthanc-dicomweb
```

### 7.2 Configurar Orthanc

```bash
sudo nano /etc/orthanc/orthanc.json
```

Modificar los siguientes parámetros (mantener el resto):

```json
{
  "Name": "PACSMED",
  "HttpPort": 8042,
  "DicomPort": 4104,
  "DicomAet": "PACSMED",
  "StorageDirectory": "/data/pacsmed/dicom",
  "IndexDirectory": "/data/pacsmed/dicom",
  "AuthenticationEnabled": false,
  "RemoteAccessAllowed": true,
  "HttpServerEnabled": true,

  "DicomModalities": {
    "MODALIDAD01": ["MODALITY01", "192.168.1.20", 104],
    "WORKSTATION01": ["WORKSTATION01", "192.168.1.30", 104]
  },

  "OrthancPeers": {},

  "Plugins": [
    "/usr/share/orthanc/plugins/libOrthancDicomWeb.so"
  ]
}
```

> **Reemplazar** las IPs y AE Titles de `DicomModalities` con los de tus equipos reales.

### 7.3 Habilitar e iniciar Orthanc

```bash
sudo systemctl enable orthanc
sudo systemctl restart orthanc
sudo systemctl status orthanc   # Debe mostrar "active (running)"
```

Verificar que los puertos estén abiertos:

```bash
ss -tlnp | grep -E '4104|8042'
```

### 7.4 Verificar la interfaz web de Orthanc

Desde otra PC en la red, abrir en el navegador:

```
http://192.168.1.10:8042
```

Debería cargar la interfaz web de Orthanc.

---

## 8. Instalación de PACsMed

### 8.1 Clonar el repositorio

```bash
cd /opt
sudo git clone https://github.com/webgrowdev/pacs pacsmed
sudo chown -R pacsadmin:pacsadmin /opt/pacsmed
cd /opt/pacsmed
```

### 8.2 Configurar el Backend

```bash
cd /opt/pacsmed/backend
cp .env.example .env
nano .env
```

Contenido del `.env` de producción:

```env
NODE_ENV=production
PORT=4000

# Base de datos
DATABASE_PROVIDER=mysql
DATABASE_URL=mysql://pacsuser:PacsM3d_S3guro!@localhost:3306/pacs_mvp

# JWT — generar valores únicos con el comando de abajo
JWT_ACCESS_SECRET=<reemplazar con: openssl rand -base64 48>
JWT_REFRESH_SECRET=<reemplazar con: openssl rand -base64 48>

# Almacenamiento
STORAGE_ROOT=/data/pacsmed

# URLs — usar la IP estática de la mini PC
APP_BASE_URL=http://192.168.1.10
CORS_ORIGIN=http://192.168.1.10
```

Generar los secrets JWT:

```bash
openssl rand -base64 48   # Copiar para JWT_ACCESS_SECRET
openssl rand -base64 48   # Copiar para JWT_REFRESH_SECRET
```

Instalar dependencias y configurar la base de datos:

```bash
npm install
npm run db:setup   # Cambia provider, sincroniza schema, siembra datos demo
```

Compilar el backend:

```bash
npm run build
```

### 8.3 Configurar el Frontend

```bash
cd /opt/pacsmed/frontend
cp .env.example .env
nano .env
```

Contenido del `.env` del frontend:

```env
VITE_API_URL=http://192.168.1.10/api
VITE_FILES_URL=http://192.168.1.10/files
```

Instalar y compilar:

```bash
npm install
npm run build
# Los archivos estáticos quedan en: /opt/pacsmed/frontend/dist/
```

### 8.4 Crear directorio de almacenamiento y permisos

```bash
mkdir -p /data/pacsmed/pdfs
# El backend crea automáticamente las subcarpetas necesarias en el primer uso
```

---

## 9. Configurar Nginx como proxy inverso

Nginx atiende el puerto 80 y redirige:
- `/api/*` y `/files/*` → backend Node.js (puerto 4000)
- Todo lo demás → frontend React (archivos estáticos)

```bash
sudo nano /etc/nginx/sites-available/pacsmed
```

```nginx
server {
    listen 80;
    server_name 192.168.1.10;   # o el hostname que uses

    # Tamaño máximo de subida (estudios DICOM pueden ser grandes)
    client_max_body_size 500M;

    # Frontend React (archivos estáticos)
    root /opt/pacsmed/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # Archivos DICOM y PDFs
    location /files/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }
}
```

Activar el sitio y verificar la configuración:

```bash
sudo ln -s /etc/nginx/sites-available/pacsmed /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # Eliminar sitio por defecto
sudo nginx -t                                  # Debe decir "syntax is ok"
sudo systemctl reload nginx
```

---

## 10. Gestión de procesos con PM2

PM2 asegura que el backend se reinicie automáticamente si falla o si la mini PC se reinicia.

### 10.1 Iniciar el backend con PM2

```bash
cd /opt/pacsmed/backend
pm2 start dist/server.js --name pacsmed-backend --env production
pm2 save            # Guardar la configuración actual
pm2 startup         # Muestra un comando para ejecutar (copiarlo y ejecutarlo)
# Ejemplo del comando que mostrará:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u pacsadmin --hp /home/pacsadmin
```

Ejecutar el comando que mostró `pm2 startup` para que PM2 arranque con el sistema.

### 10.2 Comandos útiles de PM2

```bash
pm2 status                         # Ver estado de todos los procesos
pm2 logs pacsmed-backend           # Ver logs en tiempo real
pm2 logs pacsmed-backend --lines 50 # Últimas 50 líneas
pm2 restart pacsmed-backend        # Reiniciar el proceso
pm2 stop pacsmed-backend           # Detener el proceso
pm2 monit                          # Monitor visual (CPU, RAM, logs)
```

---

## 11. Firewall y seguridad básica

```bash
sudo ufw enable
```

Reglas necesarias:

```bash
# SSH (administración remota)
sudo ufw allow 22/tcp

# HTTP (acceso web al sistema)
sudo ufw allow 80/tcp

# DICOM (recepción de estudios desde equipos)
sudo ufw allow 4104/tcp

# Orthanc REST (solo si necesitas acceso desde otras PCs a la interfaz de Orthanc)
sudo ufw allow 8042/tcp

# Verificar las reglas
sudo ufw status verbose
```

> **Recomendación:** Restringir SSH y el puerto 8042 solo a IPs de tu red local:
> ```bash
> sudo ufw delete allow 22/tcp
> sudo ufw allow from 192.168.1.0/24 to any port 22
> sudo ufw delete allow 8042/tcp
> sudo ufw allow from 192.168.1.0/24 to any port 8042
> ```

---

## 12. Conectar un equipo DICOM a la red

### 12.1 Configuración en el equipo de diagnóstico (modalidad)

Cada fabricante tiene un panel de configuración DICOM diferente, pero los parámetros son siempre los mismos:

| Parámetro | Valor a ingresar |
|-----------|-----------------|
| **AE Title del destino (PACS)** | `PACSMED` |
| **IP del destino (PACS)** | `192.168.1.10` |
| **Puerto del destino** | `4104` |
| **AE Title de la modalidad** | El que tiene configurado el equipo (ej: `MODALITY01`) |

### 12.2 Verificar la conexión con C-ECHO

La mayoría de equipos DICOM tienen un botón de "Verificar conexión" o "C-ECHO". Usarlo para confirmar que el equipo puede hablar con el servidor.

Si no lo tiene, desde la mini PC:

```bash
# Instalar herramientas DICOM de DCMTK
sudo apt install -y dcmtk

# Enviar C-ECHO desde el servidor hacia el equipo
echoscu -v 192.168.1.20 104 -aec MODALITY01 -aet PACSMED
# Si responde con "I: Association Accepted" la conexión es exitosa
```

### 12.3 Agregar el equipo en la configuración de Orthanc

Si no lo hiciste en el paso 7.2, agregar el equipo a `DicomModalities`:

```bash
sudo nano /etc/orthanc/orthanc.json
```

```json
"DicomModalities": {
  "NOMBRE_DESCRIPTIVO": ["AE_TITLE_DEL_EQUIPO", "IP_DEL_EQUIPO", 104]
}
```

```bash
sudo systemctl restart orthanc
```

### 12.4 Flujo de trabajo con equipos DICOM

El flujo recomendado con la versión actual del sistema es:

```
Equipo DICOM ──C-STORE──► Orthanc (receptor DICOM)
                                │
                           Orthanc guarda
                           los archivos .dcm
                           en /data/pacsmed/dicom
                                │
                           El operador accede
                           a Orthanc (http://192.168.1.10:8042)
                           y descarga el ZIP del estudio
                                │
                           Sube el ZIP en PACsMed
                           (http://192.168.1.10)
                           a través del módulo de carga
```

> **Nota:** En una fase futura (ver roadmap del proyecto), PACsMed tendrá integración directa con Orthanc vía DICOMweb (WADO-RS), eliminando la necesidad del paso manual de descarga y subida. Por ahora, la conexión entre Orthanc y PACsMed se hace manualmente o vía script.

#### Script de ingesta automática (opcional)

Si quieres automatizar la ingesta de estudios desde Orthanc al sistema, puedes usar la API REST de Orthanc. El siguiente script descarga el estudio más reciente como ZIP y lo sube a PACsMed:

```bash
cat > /opt/pacsmed/scripts/ingest-from-orthanc.sh << 'EOF'
#!/bin/bash
# Script básico de ingesta manual de un estudio desde Orthanc
# Uso: ./ingest-from-orthanc.sh <STUDY_ID_DE_ORTHANC> <PATIENT_ID_PACSMED> <ADMIN_TOKEN>

STUDY_ID=$1
PATIENT_ID=$2
ADMIN_TOKEN=$3
ORTHANC_URL="http://127.0.0.1:8042"
PACS_API="http://127.0.0.1:4000/api"
TMP_DIR=$(mktemp -d)

echo "Descargando estudio $STUDY_ID desde Orthanc..."
curl -s "$ORTHANC_URL/studies/$STUDY_ID/archive" -o "$TMP_DIR/study.zip"

echo "Subiendo a PACsMed..."
curl -s -X POST "$PACS_API/studies/upload" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -F "patientId=$PATIENT_ID" \
  -F "dicom=@$TMP_DIR/study.zip"

rm -rf "$TMP_DIR"
echo "Listo."
EOF
chmod +x /opt/pacsmed/scripts/ingest-from-orthanc.sh
```

---

## 13. Primera prueba end-to-end

### 13.1 Verificar todos los servicios

```bash
# Estado de los servicios del sistema
sudo systemctl status mysql    | grep -E "Active|●"
sudo systemctl status orthanc  | grep -E "Active|●"
sudo systemctl status nginx    | grep -E "Active|●"

# Estado del backend Node.js
pm2 status

# Puertos en escucha
ss -tlnp | grep -E '80|4000|4104|8042|3306'
```

Salida esperada:

```
Active: active (running)   ← mysql
Active: active (running)   ← orthanc
Active: active (running)   ← nginx
┌──────────────────┬────────┬─────────┐
│ name             │ status │ restarts│
│ pacsmed-backend  │ online │ 0       │
└──────────────────┴────────┴─────────┘
```

### 13.2 Acceder al sistema desde una PC cliente

En cualquier PC de la misma red, abrir el navegador y navegar a:

```
http://192.168.1.10
```

### 13.3 Iniciar sesión con usuario demo

| Usuario | Contraseña | Rol |
|---------|------------|-----|
| `admin@pacs.local` | `ChangeMe123!` | Administrador |
| `doctor@pacs.local` | `ChangeMe123!` | Médico |
| `paciente@pacs.local` | `ChangeMe123!` | Paciente |

> **⚠️ Importante:** Cambiar estas contraseñas inmediatamente después de la primera prueba exitosa.

### 13.4 Prueba de carga de estudio DICOM

1. Obtener un archivo DICOM de prueba. Opciones:
   - Usar una imagen phantom/fantasma del propio equipo de diagnóstico.
   - Descargar muestras del repositorio público [The Cancer Imaging Archive (TCIA)](https://www.cancerimagingarchive.net).
   - Usar cualquier archivo `.dcm` ya disponible en la institución.
2. En PACsMed:
   - Crear un paciente de prueba.
   - Cargar el archivo `.dcm` o `.zip` con DICOM.
   - Abrir el visor DICOM.
   - Verificar que la imagen se muestre correctamente.

### 13.5 Prueba de envío C-STORE desde equipo real

1. En el equipo de diagnóstico, realizar un estudio de prueba (puede ser una imagen fantasma/phantom).
2. Desde el equipo, enviar el estudio al destino `PACSMED` (IP: `192.168.1.10`, Puerto: `4104`).
3. Verificar en Orthanc (`http://192.168.1.10:8042`) que el estudio aparece en la lista.
4. Ingresar a PACsMed y cargar el ZIP descargado de Orthanc (hasta integración directa).

---

## 14. Mantenimiento y operación diaria

### 14.1 Arranque automático

Con la configuración de PM2 y `systemd`, al reiniciar la mini PC todos los servicios arrancan automáticamente:

- MySQL → `systemd`
- Orthanc → `systemd`
- Nginx → `systemd`
- Backend Node.js → `PM2` + `systemd`

### 14.2 Backups automáticos de la base de datos

Crear el archivo de credenciales MySQL (sin exponer la contraseña en el script):

```bash
nano /home/pacsadmin/.my.cnf
```

```ini
[client]
user=pacsuser
password=PacsM3d_S3guro!
```

Restringir los permisos del archivo (solo el propietario puede leerlo):

```bash
chmod 600 /home/pacsadmin/.my.cnf
```

Crear el script de backup:

```bash
sudo nano /opt/pacsmed/scripts/backup-db.sh
```

```bash
#!/bin/bash
FECHA=$(date +%Y%m%d_%H%M%S)
DESTINO=/data/pacsmed/backups
mkdir -p $DESTINO
# Las credenciales se leen de ~/.my.cnf (no se exponen en el proceso)
mysqldump pacs_mvp | gzip > "$DESTINO/pacs_mvp_$FECHA.sql.gz"
# Mantener solo los últimos 30 backups
ls -t $DESTINO/pacs_mvp_*.sql.gz | tail -n +31 | xargs rm -f
echo "Backup completado: pacs_mvp_$FECHA.sql.gz"
```

```bash
chmod +x /opt/pacsmed/scripts/backup-db.sh
```

Programar backup diario con cron:

```bash
crontab -e
# Agregar la línea:
0 2 * * * /opt/pacsmed/scripts/backup-db.sh >> /var/log/pacsmed-backup.log 2>&1
```

### 14.3 Actualizar PACsMed

```bash
cd /opt/pacsmed
git pull origin main

cd backend
npm install
npm run build
npx prisma db push   # Aplicar cambios de schema si los hay

cd ../frontend
npm install
npm run build

pm2 restart pacsmed-backend
sudo systemctl reload nginx
```

### 14.4 Ver logs

```bash
# Logs del backend en tiempo real
pm2 logs pacsmed-backend

# Logs de Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Logs de Orthanc
sudo journalctl -u orthanc -f

# Logs de MySQL
sudo journalctl -u mysql -f
```

---

## 15. Resolución de problemas frecuentes

### El sistema no carga en el navegador

```bash
# Verificar Nginx
sudo nginx -t
sudo systemctl status nginx

# Verificar que el frontend fue compilado
ls /opt/pacsmed/frontend/dist/   # Debe haber archivos .html y .js
```

### Error 502 Bad Gateway

El backend no está corriendo:

```bash
pm2 status
pm2 logs pacsmed-backend --lines 30
# Si está caído:
pm2 restart pacsmed-backend
```

### No puedo conectarme desde otra PC

```bash
# Verificar el firewall
sudo ufw status

# Verificar que Nginx escucha en todas las interfaces (no solo localhost)
ss -tlnp | grep :80
# Debe mostrar 0.0.0.0:80, no 127.0.0.1:80
```

### El equipo DICOM no puede enviar al servidor

```bash
# Verificar que Orthanc está escuchando en el puerto DICOM
ss -tlnp | grep 4104

# Verificar el firewall
sudo ufw status | grep 4104

# Hacer ping desde el equipo al servidor (verificar conectividad básica)
ping 192.168.1.10

# Desde el servidor, hacer C-ECHO al equipo
echoscu -v 192.168.1.20 104 -aec MODALITY01 -aet PACSMED
```

### Error de autenticación en la base de datos

```bash
# Verificar credenciales
mysql -u pacsuser -p pacs_mvp
# Ingresar la contraseña configurada en .env

# Si falla, recrear el usuario
sudo mysql -u root -p
# DROP USER 'pacsuser'@'localhost';
# CREATE USER 'pacsuser'@'localhost' IDENTIFIED BY 'PacsM3d_S3guro!';
# GRANT ALL PRIVILEGES ON pacs_mvp.* TO 'pacsuser'@'localhost';
# FLUSH PRIVILEGES;
```

### El visor DICOM no muestra imágenes

- Verificar que el archivo DICOM fue cargado correctamente (debe estar en `/data/pacsmed/dicom/` o en el directorio de almacenamiento configurado).
- Verificar la consola del navegador (F12 → Console) para ver errores de red.
- Verificar que `VITE_FILES_URL` en el frontend apunta a la IP correcta del servidor.

---

## 16. Glosario

| Término | Definición |
|---------|------------|
| **PACS** | Picture Archiving and Communication System. Sistema de archivo y comunicación de imágenes médicas. |
| **DICOM** | Digital Imaging and Communications in Medicine. Estándar para la transmisión, almacenamiento y visualización de imágenes médicas. |
| **AE Title** | Application Entity Title. Nombre único que identifica a un dispositivo DICOM en la red. |
| **C-STORE** | Operación DICOM para enviar (almacenar) imágenes desde una modalidad a un servidor. |
| **C-ECHO** | Operación DICOM de verificación de conectividad (equivalente al ping). |
| **SCU** | Service Class User. El cliente DICOM (ej: el equipo que envía). |
| **SCP** | Service Class Provider. El servidor DICOM (ej: Orthanc). |
| **Modalidad** | Equipo de diagnóstico (rayos X, tomógrafo, ecógrafo, resonador, etc.). |
| **Orthanc** | Servidor DICOM de código abierto. Recibe, almacena y expone estudios DICOM. |
| **PM2** | Process Manager 2. Gestor de procesos para aplicaciones Node.js en producción. |
| **Nginx** | Servidor web y proxy inverso. En este contexto, sirve el frontend y redirige el tráfico API al backend. |
| **Prisma** | ORM (Object-Relational Mapper) utilizado por el backend para interactuar con la base de datos. |
| **JWT** | JSON Web Token. Mecanismo de autenticación sin estado usado por la API. |

---

> **Aviso:** Esta guía asume una instalación básica para entorno clínico pequeño o piloto. Para entornos de producción con múltiples modalidades y alta carga de estudios, se recomienda evaluar configuraciones de alta disponibilidad, HTTPS con certificado SSL/TLS (Let's Encrypt o CA interna), y backups fuera del servidor.
