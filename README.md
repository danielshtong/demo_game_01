# 道況 · HK Traffic

Live Hong Kong traffic checker powered by Transport Department open data.

## Features

- Interactive dark map of Hong Kong with **210 TD traffic cameras**
- Region filters and camera search
- Live **Special Traffic News** from `data.one.gov.hk` (auto-refresh every 5 minutes)
- Camera snapshot viewer with ~2 minute refresh cadence
- Responsive layout for desktop and mobile

## Data sources

- Traffic cameras: `https://tdcctv.data.one.gov.hk/{CAMERA_ID}.JPG`
- Special traffic news: `https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml`
- Camera location metadata bundled from TD PSI camera location records

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

Built with Vite, Leaflet, and CARTO basemap tiles.
