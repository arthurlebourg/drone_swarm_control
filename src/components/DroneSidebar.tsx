import { useEffect, useRef, type FC } from 'react';
import { useDroneStore } from '../hooks/useDroneStore';
import { swarmData } from './DroneLayer';

const DroneSidebar: FC = () => {
    const { selectedDrones } = useDroneStore();

    const latRefs = useRef<{ [key: number]: HTMLSpanElement | null }>({});
    const lngRefs = useRef<{ [key: number]: HTMLSpanElement | null }>({});

    useEffect(() => {
        if (selectedDrones.length === 0) return;

        let animationFrameId: number;

        const updateCoordinates = () => {
            selectedDrones.forEach((index) => {
                const drone = swarmData[index];
                if (!drone) return;
                const latEl = latRefs.current[index];
                const lngEl = lngRefs.current[index];

                if (latEl && lngEl) {
                    latEl.innerText = `Lat: ${drone.lat.toFixed(6)}`;
                    lngEl.innerText = `Lng: ${drone.lng.toFixed(6)}`;
                }
            });
            animationFrameId = requestAnimationFrame(updateCoordinates);
        };

        updateCoordinates();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [selectedDrones]);

    if (selectedDrones.length === 0) {
        return null;
    }

    return (
        <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '320px',
            height: '100vh',
            backgroundColor: 'rgba(25, 25, 25, 0.95)',
            color: '#ffffff',
            padding: '20px',
            boxSizing: 'border-box',
            overflowY: 'auto',
            zIndex: 20,
            borderLeft: '1px solid #444',
            boxShadow: '-4px 0 15px rgba(0,0,0,0.5)'
        }}>
            <h2 style={{ marginTop: 0, borderBottom: '1px solid #555', paddingBottom: '10px' }}>
                Selected Drones. ({selectedDrones.length})
            </h2>

            <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                {selectedDrones.map((index) => {
                    return (
                        <li
                            key={index}
                            style={{
                                marginBottom: '10px',
                                padding: '12px',
                                backgroundColor: '#333',
                                borderRadius: '6px',
                                borderLeft: '4px solid #ff00ff'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>
                                Drone #{index}
                            </div>
                            <div style={{ fontSize: '0.9em', color: '#ccc', fontFamily: 'monospace' }}>
                                <span ref={el => { latRefs.current[index] = el }}>Lat: 0.000000</span><br />
                                <span ref={el => { lngRefs.current[index] = el }}>Lng: 0.000000</span>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default DroneSidebar;