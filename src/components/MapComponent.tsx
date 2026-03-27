import React, { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import DroneLayer, { getSwarmBarycenter, getSwarmBounds } from './DroneLayer';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MapComponent: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);

    useEffect(() => {
        if (map.current || !mapContainer.current) return;

        // 1. On récupère le barycentre exact de notre génération aléatoire
        const initialCenter = getSwarmBarycenter();

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/light-v11',
            center: initialCenter, // On centre sur le barycentre
            zoom: 12, // Zoom temporaire, sera écrasé par fitBounds
            pitch: 65,
            bearing: 20,
            antialias: true
        });

        map.current.on('style.load', () => {
            if (!map.current) return;

            map.current.addSource('mapbox-dem', {
                'type': 'raster-dem',
                'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                'tileSize': 512,
                'maxzoom': 14
            });
            map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });

            map.current.addLayer({
                'id': 'add-3d-buildings',
                'source': 'composite',
                'source-layer': 'building',
                'filter': ['==', 'extrude', 'true'],
                'type': 'fill-extrusion',
                'minzoom': 15,
                'paint': {
                    'fill-extrusion-color': '#aaa',
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'min_height'],
                    'fill-extrusion-opacity': 0.8
                }
            });

            const customLayer = new DroneLayer();
            map.current.addLayer(customLayer);

            // 2. LA MAGIE DE LA CAMÉRA : On ajuste le zoom et le cadre
            const bounds = getSwarmBounds();
            map.current.fitBounds(bounds, {
                padding: { top: 100, bottom: 100, left: 100, right: 100 }, // Marge en pixels autour de l'essaim
                pitch: 65, // On conserve l'effet 3D
                bearing: 20,
                maxZoom: 16, // Évite de trop zoomer si les drones sont très proches
                duration: 2000 // Animation fluide de 2 secondes au démarrage (mets 0 pour instantané)
            });
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    return <div ref={mapContainer} style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0 }} />;
};

export default MapComponent;