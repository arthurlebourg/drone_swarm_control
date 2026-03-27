import { create } from 'zustand';

interface DroneStore {
    selectedDrones: number[];
    setSelectedDrones: (indices: number[]) => void;
    clearSelection: () => void;
}

export const useDroneStore = create<DroneStore>((set) => ({
    selectedDrones: [],
    setSelectedDrones: (indices) => set({ selectedDrones: indices }),
    clearSelection: () => set({ selectedDrones: [] }),
}));