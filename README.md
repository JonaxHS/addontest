# AIOStreams -> DebridStream Bridge

Convierte resultados de AIOStreams (`streams[].url`) a `infoHash` para usar en DebridStream.

## Despliegue en CasaOS (VPS en casa)

### Opcion 1: desde terminal en tu VPS

1. Clona el repo:

```bash
git clone https://github.com/JonaxHS/addontest.git
cd addontest
```

2. Levanta el contenedor:

```bash
docker compose up -d --build
```

3. Verifica salud:

```bash
curl "http://IP_DE_TU_VPS:8787/health"
```

Debe responder algo como:

```json
{"ok":true,"service":"aiostreams-debrid-bridge"}
```

### Opcion 2: desde la UI de CasaOS

1. Ve a App Store -> Custom Install -> Import docker-compose.
2. Pega el contenido de `docker-compose.yml`.
3. Deploy.
4. Asegura que el puerto `8787` quede publicado.

### URL para usar en spanish.json

Si tu VPS tiene IP `192.168.1.50`, cambia la URL del scraper a:

`http://192.168.1.50:8787/stream/%searchPattern.json`

Si lo publicas por dominio (ejemplo `bridge.tucasa.com`), usa:

`https://bridge.tucasa.com/stream/%searchPattern.json`

## Ejecutar

```bash
npm start
```

Servidor por defecto en `http://localhost:8787`.

## Endpoints

- Salud: `GET /health`
- Pelicula: `GET /stream/movie/<imdbId>.json`
- Serie: `GET /stream/series/<imdbId>:<season>:<episode>.json`

Ejemplo:

```bash
curl "http://localhost:8787/stream/movie/tt15574124.json"
```

## Variables de entorno

- `PORT`: puerto del servidor (default `8787`).
- `AIO_BASE`: base del endpoint AIO sin `/<pattern>.json`.

Default actual:

`https://aiostream.axonim.lat/stremio/35099f5e-fd8c-488f-a701-2bd66af59ead/eyJpIjoiT3ExWVFONXE1alQ3MVVvaEVKNU5CZz09IiwiZSI6IkpGYWxsWGtjZDVCUndTRDdNWlVlOUJpRnE0UzQwOEpvZEljaTFFUDQwOU09IiwidCI6ImEifQ/stream`

## Formato de salida

```json
{
  "streams": [
    {
      "infoHash": "40hex...",
      "name": "texto",
      "size": 123456789,
      "sourceUrl": "https://..."
    }
  ],
  "count": 1,
  "upstreamUrl": "https://..."
}
```
