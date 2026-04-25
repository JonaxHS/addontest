# AIOStreams -> DebridStream Bridge

Convierte resultados de AIOStreams (`streams[].url`) a `infoHash` para usar en DebridStream.

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
