# Plataforma de Análisis Financiero

Sitio estático simple para visualizar tendencias de activos e inversiones mediante gráficos.

## Estructura

- `index.html` — página principal

## Uso local

Abrir directamente en el navegador o servir con:

```bash
py -m http.server 8000
```

Luego entrar a:

```text
http://localhost:8000
```

## Preparado para Cloud Pages

Este repositorio está diseñado como sitio estático básico para ser conectado a Salesforce Cloud Pages o a un despliegue desde GitHub.

## Subir a GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <URL_DEL_REPOSITORIO_GITHUB>
git push -u origin main
```
