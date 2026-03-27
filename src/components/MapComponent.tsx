import React, { useRef, useEffect } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import DroneLayer from './DroneLayer';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MapComponent: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);

    useEffect(() => {
        if (map.current || !mapContainer.current) return;

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/light-v11',
            center: [11.5820, 48.1351],
            zoom: 13.5,
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
                    'fill-extrusion-color': '#222', // Bâtiments foncés pour aller avec la carte
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'min_height'],
                    'fill-extrusion-opacity': 0.8
                }
            });

            const customLayer = new DroneLayer();
            map.current.addLayer(customLayer);
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    return (
        <div ref={mapContainer} style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0 }} />
    );
};

export default MapComponent;