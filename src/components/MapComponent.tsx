import { useRef, useEffect, useState, type FC, type MouseEvent } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import DroneLayer, { getSwarmBarycenter, getSwarmBounds, swarmData } from './DroneLayer';
import { useDroneStore } from '../hooks/useDroneStore';
import DroneSidebar from './DroneSidebar';
import { useStats } from '../hooks/useStats';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const MapComponent: FC = () => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const droneLayerRef = useRef<DroneLayer | null>(null);
    const targetMarkerRef = useRef<mapboxgl.Marker | null>(null);

    const { selectedDrones, setSelectedDrones, clearSelection } = useDroneStore();

    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);
    const pathCanvasRef = useRef<HTMLCanvasElement>(null);

    useStats()

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
            antialias: true,
            maxZoom: 30
        });

        map.current.on('style.load', () => {
            if (!map.current) return;

            map.current.addSource('mapbox-dem', {
                'type': 'raster-dem',
                'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
                'tileSize': 512,
                'maxzoom': 18
            });
            map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1 });

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
            droneLayerRef.current = new DroneLayer(pathCanvasRef.current);
            map.current.addLayer(droneLayerRef.current);

            map.current.on('click', (e) => {
                if (!droneLayerRef.current || isSelectionMode) return;

                // Mapbox e.point is in CSS logical pixels. WebGL needs physical pixels.
                const dpr = window.devicePixelRatio;
                const physicalX = e.point.x * dpr;
                const physicalY = e.point.y * dpr;

                droneLayerRef.current.requestPick(physicalX, physicalY, (id) => {
                    if (id !== null) {
                        setSelectedDrones([id]); // Overwrite selection with picked drone
                    } else {
                        clearSelection(); // Clicked on empty space
                    }
                });
            });

            const bounds = getSwarmBounds();
            map.current.fitBounds(bounds, {
                padding: { top: 100, bottom: 100, left: 100, right: 100 },
                pitch: 65,
                bearing: 20,
                maxZoom: 18,
                duration: 2000
            });
        });

        map.current.on('moveend', () => {
            if (droneLayerRef.current && map.current) {
                const center = map.current.getCenter();
                const elevation = map.current.queryTerrainElevation(center) || 520;
                droneLayerRef.current.scanBuildings(elevation);
            }
        });

        return () => {
            map.current?.remove();
            map.current = null;
        };
    }, []);

    useEffect(() => {
        if (!droneLayerRef.current || !map.current) return;

        droneLayerRef.current.updateSelection(selectedDrones);

        if (selectedDrones.length > 0) {
            let sumLng = 0, sumLat = 0;
            let validCount = 0;

            selectedDrones.forEach(i => {
                const drone = swarmData[i];
                if (drone) { // <--- Safety guard
                    sumLng += drone.lng;
                    sumLat += drone.lat;
                    validCount++;
                }
            });

            if (validCount > 0) {
                const centerLng = sumLng / validCount;
                const centerLat = sumLat / validCount;

                if (!targetMarkerRef.current) {
                    targetMarkerRef.current = new mapboxgl.Marker({ color: '#ff00ff', draggable: true })
                        .setLngLat([centerLng, centerLat])
                        .addTo(map.current);

                    targetMarkerRef.current.on('drag', () => {
                        const lngLat = targetMarkerRef.current!.getLngLat();
                        droneLayerRef.current!.setTargetGPS(lngLat.lng, lngLat.lat);
                    });
                } else {
                    targetMarkerRef.current.setLngLat([centerLng, centerLat]);
                }

                droneLayerRef.current.setTargetGPS(centerLng, centerLat);
            }

        } else {
            if (targetMarkerRef.current) {
                targetMarkerRef.current.remove();
                targetMarkerRef.current = null;
            }
            droneLayerRef.current.clearTargetGPS();
        }
    }, [selectedDrones]);

    const handleMouseDown = (e: MouseEvent) => {
        if (!isSelectionMode) return;
        setSelectionBox({
            startX: e.clientX,
            startY: e.clientY,
            currentX: e.clientX,
            currentY: e.clientY
        });
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isSelectionMode || !selectionBox) return;
        setSelectionBox({ ...selectionBox, currentX: e.clientX, currentY: e.clientY });
    };

    const handleMouseUp = () => {
        if (!isSelectionMode || !selectionBox || !map.current || !droneLayerRef.current) return;

        const canvas = map.current.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const { clientWidth, clientHeight } = canvas;

        const minX = Math.min(selectionBox.startX, selectionBox.currentX) - rect.left;
        const maxX = Math.max(selectionBox.startX, selectionBox.currentX) - rect.left;
        const minY = Math.min(selectionBox.startY, selectionBox.currentY) - rect.top;
        const maxY = Math.max(selectionBox.startY, selectionBox.currentY) - rect.top;

        const newSelectedIndices: number[] = [];

        swarmData.forEach((_, index) => {
            const screenPosition = droneLayerRef.current!.getDroneScreenPosition(index, clientWidth, clientHeight);

            if (
                screenPosition &&
                screenPosition.x >= minX && screenPosition.x <= maxX &&
                screenPosition.y >= minY && screenPosition.y <= maxY
            ) {
                newSelectedIndices.push(index);
            }
        });

        setSelectedDrones(newSelectedIndices);
        setIsSelectionMode(false);
        setSelectionBox(null);
    };

    useEffect(() => {
        if (!map.current) return;
        if (isSelectionMode) {
            map.current.dragPan.disable();
        } else {
            map.current.dragPan.enable();
        }
    }, [isSelectionMode]);

    return (
        <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>

            <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10, display: 'flex', gap: '10px' }}>
                <button
                    onClick={() => {
                        setIsSelectionMode(!isSelectionMode);
                        if (isSelectionMode) clearSelection();
                    }}
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

                {selectedDrones.length > 0 && (
                    <div style={{
                        padding: '10px 20px',
                        backgroundColor: '#222',
                        color: '#fff',
                        borderRadius: '5px',
                        fontWeight: 'bold'
                    }}>
                        {selectedDrones.length} Selected
                    </div>
                )}
            </div>

            {isSelectionMode && (
                <div
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 5, cursor: 'crosshair' }}
                >
                    {selectionBox && (
                        <div style={{
                            position: 'absolute',
                            left: Math.min(selectionBox.startX, selectionBox.currentX),
                            top: Math.min(selectionBox.startY, selectionBox.currentY),
                            width: Math.abs(selectionBox.currentX - selectionBox.startX),
                            height: Math.abs(selectionBox.currentY - selectionBox.startY),
                            border: '2px solid #ff00ff',
                            backgroundColor: 'rgba(255, 0, 255, 0.2)',
                            pointerEvents: 'none'
                        }} />
                    )}
                </div>
            )}

            <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

            <canvas
                ref={pathCanvasRef}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    zIndex: 2,
                    pointerEvents: 'none' // Ensures map panning/clicking passes through to Mapbox
                }}
            />

            <DroneSidebar />
        </div>
    );
};

export default MapComponent;