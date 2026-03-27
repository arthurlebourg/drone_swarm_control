import React from 'react';
import { useDroneStore } from '../hooks/useDroneStore';
import { swarmData } from './DroneLayer';

const DroneSidebar: React.FC = () => {
    const { selectedDrones } = useDroneStore();

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
                Drones Sélect. ({selectedDrones.length})
            </h2>

            <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                {selectedDrones.map((index) => {
                    const drone = swarmData[index];
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
                                Lat: {drone.lat.toFixed(6)}<br />
                                Lng: {drone.lng.toFixed(6)}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default DroneSidebar;