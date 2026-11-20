@echo off
setlocal enabledelayedexpansion
title V-CONTROLLER Server - Port 3000
cd /d "%~dp0"

:: 1. Configuracion fija de red (Puerto 3000 en 0.0.0.0 para acceso iPad directo)
set PORT=3000
set HOST=0.0.0.0

:: 2. Verificacion de entorno Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ======================================================================
    echo  [ERROR] Node.js no esta instalado o no se encuentra en el PATH.
    echo  Por favor instala Node.js (LTS) desde https://nodejs.org/
    echo ======================================================================
    pause
    exit /b 1
)

:: 3. Verificacion del directorio web compilado (dist)
if not exist "dist\index.html" (
    echo [INFO] Directorio dist no encontrado o incompleto.
    echo Generando build web de produccion...
    call npm run build
    if %errorlevel% neq 0 (
        echo [ADVERTENCIA] La compilacion web fallo. Intentando iniciar el servidor...
    )
)

:: 4. Deteccion de IPs y visualizacion de URLs para el iPad
cls
echo ======================================================================
echo    V-CONTROLLER / INTERCON TALLY VMIX - SERVIDOR LOCAL
echo ======================================================================
echo  Servidor Web y Senalizacion: Puerto fijo 3000 (0.0.0.0)
echo  vMix Web Controller objetivo:  Puerto 8088
echo.
echo  DIRECCIONES EXACTAS PARA ABRIR EN EL IPAD / DISPOSITIVOS:
echo  --------------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$addrs = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' }; ^
   if ($addrs) { ^
     foreach ($a in $addrs) { ^
       $hint = if ($a.IPAddress -like '169.254.*') { 'Cable directo Ethernet / iPad' } elseif ($a.IPAddress -like '172.20.10.*') { 'USB Tethering' } else { 'LAN / Wi-Fi' }; ^
       Write-Host ('   -> http://' + $a.IPAddress + ':3000/   [' + $hint + ' - ' + $a.InterfaceAlias + ']') -ForegroundColor Cyan; ^
     } ^
   } else { ^
     Write-Host '   -> http://localhost:3000/' -ForegroundColor Yellow; ^
   }"
echo  --------------------------------------------------------------------
echo  En este PC: http://localhost:3000/
echo.
echo  Abre cualquiera de las URLs anteriores en Safari en tu iPad.
echo  Presiona CTRL+C para detener el servidor.
echo ======================================================================
echo.
echo Iniciando servidor Node.js en 0.0.0.0:3000...
echo.

node server/index.js
if %errorlevel% neq 0 (
    echo.
    echo [AVISO] El servidor se ha detenido con codigo de salida %errorlevel%.
    pause
)
