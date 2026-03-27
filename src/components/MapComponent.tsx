import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import DroneLayer, { getSwarmBarycenter, getSwarmBounds, swarmData } from './DroneLayer';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MapComponent: React.FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const droneLayerRef = useRef<DroneLayer | null>(null); // Pour stocker notre layer Three.js

    // États pour la sélection
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);

    useEffect(() => {
        if (map.current || !mapContainer.current) return;

        const initialCenter = getSwarmBarycenter();

        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/light-v11',
            center: initialCenter,
            zoom: 12,
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

            droneLayerRef.current = new DroneLayer();
            map.current.addLayer(droneLayerRef.current);

            const bounds = getSwarmBounds();
            map.current.fitBounds(bounds, {
                padding: { top: 100, bottom: 100, left: 100, right: 100 },
                pitch: 65,
                bearing: 20,
                maxZoom: 16,
                duration: 2000
            });
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    // GESTION DE LA SOURIS POUR LE DESSIN DU RECTANGLE
    const handleMouseDown = (e: React.MouseEvent) => {
        if (!isSelectionMode) return;
        setSelectionBox({
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY
        });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isSelectionMode || !selectionBox) return;
        setSelectionBox({ ...selectionBox, currentX: e.clientX, currentY: e.clientY });
    };

    const handleMouseUp = () => {
        if (!isSelectionMode || !selectionBox || !map.current || !droneLayerRef.current) return;

        // 1. Définir les limites du rectangle en pixels
        const minX = Math.min(selectionBox.startX, selectionBox.currentX);
        const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
        const minY = Math.min(selectionBox.startY, selectionBox.currentY);
        const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

        // 2. Trouver quels drones sont dans le rectangle
        const selectedIndices: number[] = [];

        swarmData.forEach((drone, index) => {
            // map.project() transforme les coordonnées GPS en position X/Y sur l'écran !
            const screenPosition = map.current!.project([drone.lng, drone.lat]);

            if (
                screenPosition.x >= minX && screenPosition.x <= maxX &&
                screenPosition.y >= minY && screenPosition.y <= maxY
            ) {
                selectedIndices.push(index);
            }
        });

        // 3. Envoyer les indices sélectionnés au layer Three.js
        droneLayerRef.current.highlightDrones(selectedIndices);

        // 4. Nettoyer
        setSelectionBox(null);
    };

    // ACTIVER / DÉSACTIVER LES CONTRÔLES MAPBOX
    useEffect(() => {
        if (!map.current) return;
        if (isSelectionMode) {
            map.current.dragPan.disable(); // Empêche la carte de bouger quand on dessine
        } else {
            map.current.dragPan.enable();
        }
    }, [isSelectionMode]);

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>

            {/* L'UI PAR DESSUS LA CARTE */}
            <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', gap: '10px' }}>
                <button
                    onClick={() => setIsSelectionMode(!isSelectionMode)}
                    style={{
                        padding: '10px 20px',
                        cursor: 'pointer',
                        backgroundColor: isSelectionMode ? '#ff00ff' : '#ffffff',
                        color: isSelectionMode ? '#ffffff' : '#000000',
                        border: 'none',
                        borderRadius: '5px',
                        fontWeight: 'bold',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
                    }}
                >
                    {isSelectionMode ? 'Cancel Selection' : 'Select Drones'}
                </button>
            </div>

            {/* LE DIV INVISIBLE QUI CAPTURE LA SOURIS QUAND LE MODE EST ACTIF */}
            {isSelectionMode && (
                <div
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 5, cursor: 'crosshair' }}
                >
                    {/* LE DESSIN DU RECTANGLE */}
                    {selectionBox && (
                        <div style={{
                            position: 'absolute',
                            left: Math.min(selectionBox.startX, selectionBox.currentX),
                            top: Math.min(selectionBox.startY, selectionBox.currentY),
                            width: Math.abs(selectionBox.currentX - selectionBox.startX),
                            height: Math.abs(selectionBox.currentY - selectionBox.startY),
                            border: '2px solid #ff00ff',
                            backgroundColor: 'rgba(255, 0, 255, 0.2)',
                            pointerEvents: 'none' // Pour ne pas bloquer les événements de souris
                        }} />
                    )}
                </div>
            )}

            {/* LE CONTENEUR MAPBOX */}
            <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
        </div>
    );
};

export default MapComponent;