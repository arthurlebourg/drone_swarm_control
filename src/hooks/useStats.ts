import { useEffect } from "react";
import Stats from 'stats.js';


export const useStats = () => {
    useEffect(() => {
        const stats = new Stats();
        stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom

        // Force the stats panel to sit on top of everything (like Mapbox and your UI)
        stats.dom.style.position = 'absolute';
        stats.dom.style.top = '0px';
        stats.dom.style.right = '0px'; // Put it on the right so it doesn't block your buttons
        stats.dom.style.left = 'auto';
        stats.dom.style.zIndex = '9999';

        document.body.appendChild(stats.dom);

        // Run a basic requestAnimationFrame loop to track the browser's main thread framerate
        let animationFrameId: number;
        const animate = () => {
            stats.update();
            animationFrameId = requestAnimationFrame(animate);
        };
        animate();

        // Clean up when the component unmounts
        return () => {
            cancelAnimationFrame(animationFrameId);
            if (document.body.contains(stats.dom)) {
                document.body.removeChild(stats.dom);
            }
        };
    }, []);
}
