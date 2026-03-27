use std::collections::HashMap;
use wasm_bindgen::prelude::*;
use js_sys::Math;

const MAX_SPEED: f32 = 15.0;
const MAX_FORCE: f32 = 20.0;
const SEPARATION_DISTANCE: f32 = 4.0;
const CELL_SIZE: f32 = 4.0;

struct Obstacle {
    x: f32,
    y: f32,
    height: f32,
    half_w: f32,
    half_d: f32,
    cos: f32,
    sin: f32,
    world_cos: f32,
    world_sin: f32,
    bounding_radius_sq: f32,
}

#[wasm_bindgen]
pub struct SwarmWasm {
    num_drones: usize,
    positions: Vec<f32>,
    velocities: Vec<f32>,
    selected: Vec<bool>,
    target: Option<(f32, f32, f32)>,
    obstacles: Vec<Obstacle>,
    // Grid maps cell coordinates to indices of drones in that cell
    grid: HashMap<(i32, i32, i32), Vec<usize>>,
}

#[wasm_bindgen]
impl SwarmWasm {
    #[wasm_bindgen(constructor)]
    pub fn new(num_drones: usize, _center_mercator_x: f32, _center_mercator_y: f32) -> SwarmWasm {
        let mut positions = Vec::with_capacity(num_drones * 3);
        let mut velocities = Vec::with_capacity(num_drones * 3);
        let selected = vec![false; num_drones];

        for _ in 0..num_drones {
            // Treat rx and ry purely as local meter offsets from the center
            let rx = (Math::random() as f32 - 0.5) * 100.0;
            let ry = (Math::random() as f32 - 0.5) * 100.0;
            
            positions.push(rx);
            positions.push(ry);
            positions.push(5.0); // Z

            velocities.push((Math::random() as f32 - 0.5) * 2.0);
            velocities.push((Math::random() as f32 - 0.5) * 2.0);
            velocities.push(0.0);
        }

        SwarmWasm {
            num_drones,
            positions,
            velocities,
            selected,
            target: None,
            obstacles: Vec::new(),
            grid: HashMap::new(),
        }
    }

    pub fn set_target(&mut self, x: f32, y: f32, z: f32) {
        self.target = Some((x, y, z));
    }

    pub fn clear_target(&mut self) {
        self.target = None;
    }

    /// Receives a Uint32Array from JS of selected indices
    pub fn update_selection(&mut self, selected_indices: &[u32]) {
        self.selected.fill(false);
        for &idx in selected_indices {
            if (idx as usize) < self.num_drones {
                self.selected[idx as usize] = true;
            }
        }
    }

    /// Receives a Float32Array from JS. Each obstacle is 6 floats: [x, y, height, width, depth, rotation]
    pub fn update_obstacles(&mut self, flat_obstacles: &[f32]) {
        self.obstacles.clear();
        
        for chunk in flat_obstacles.chunks(6) {
            if chunk.len() < 6 { break; }
            let (x, y, height, w, d, rot) = (chunk[0], chunk[1], chunk[2], chunk[3], chunk[4], chunk[5]);
            
            let half_w = w / 2.0;
            let half_d = d / 2.0;
            let bounding_radius = (half_w * half_w + half_d * half_d).sqrt() + 2.0;

            self.obstacles.push(Obstacle {
                x, y, height,
                half_w, half_d,
                cos: (-rot).cos(),
                sin: (-rot).sin(),
                world_cos: rot.cos(),
                world_sin: rot.sin(),
                bounding_radius_sq: bounding_radius * bounding_radius,
            });
        }
    }

    pub fn update(&mut self, delta_time: f32) {
        // 1. Rebuild Spatial Hash Grid
        self.grid.values_mut().for_each(|v| v.clear());
        for i in 0..self.num_drones {
            let idx = i * 3;
            let cx = (self.positions[idx] / CELL_SIZE).floor() as i32;
            let cy = (self.positions[idx+1] / CELL_SIZE).floor() as i32;
            let cz = (self.positions[idx+2] / CELL_SIZE).floor() as i32;
            
            self.grid.entry((cx, cy, cz)).or_insert_with(Vec::new).push(i);
        }

        // 2. Compute Forces & Update
        for i in 0..self.num_drones {
            let idx = i * 3;
            let px = self.positions[idx];
            let py = self.positions[idx+1];
            let pz = self.positions[idx+2];
            let mut vx = self.velocities[idx];
            let mut vy = self.velocities[idx+1];

            // Separation
            let (mut sep_x, mut sep_y) = self.calc_separation(i, px, py, pz, vx, vy);
            sep_x *= 1.5;
            sep_y *= 1.5;

            // Attraction & Friction
            let mut att_x = 0.0;
            let mut att_y = 0.0;
            if self.selected[i] {
                if let Some((tx, ty, _tz)) = self.target {
                    let (ax, ay) = self.calc_attraction(px, py, vx, vy, tx, ty);
                    att_x = ax * 1.0;
                    att_y = ay * 1.0;
                }
            } else {
                vx *= 0.95;
                vy *= 0.95;
            }

            // Avoidance
            let (mut av_x, mut av_y) = self.calc_avoidance(px, py, pz, vx, vy);
            av_x *= 5.0;
            av_y *= 5.0;

            // Apply Forces
            vx += (sep_x + att_x + av_x) * delta_time;
            vy += (sep_y + att_y + av_y) * delta_time;

            // Clamp Velocity Length
            let speed_sq = vx * vx + vy * vy;
            if speed_sq > MAX_SPEED * MAX_SPEED {
                let speed = speed_sq.sqrt();
                vx = (vx / speed) * MAX_SPEED;
                vy = (vy / speed) * MAX_SPEED;
            }

            self.velocities[idx] = vx;
            self.velocities[idx+1] = vy;
            self.velocities[idx+2] = 0.0; // Enforce Z velocity is zero, as requested in TS

            // Apply Velocity to Position
            self.positions[idx] += vx * delta_time;
            self.positions[idx+1] += vy * delta_time;
        }
    }

    // --- HEPLER ALGORITHMS ---

    fn calc_separation(&self, index: usize, px: f32, py: f32, pz: f32, vx: f32, vy: f32) -> (f32, f32) {
        let mut count = 0;
        let mut sx = 0.0;
        let mut sy = 0.0;
        
        let cx = (px / CELL_SIZE).floor() as i32;
        let cy = (py / CELL_SIZE).floor() as i32;
        let cz = (pz / CELL_SIZE).floor() as i32;
        let sep_sq = SEPARATION_DISTANCE * SEPARATION_DISTANCE;

        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    if let Some(neighbors) = self.grid.get(&(cx+dx, cy+dy, cz+dz)) {
                        for &other_idx in neighbors {
                            if other_idx == index { continue; }
                            
                            let o_idx = other_idx * 3;
                            let ox = self.positions[o_idx];
                            let oy = self.positions[o_idx+1];
                            let oz = self.positions[o_idx+2];
                            
                            let dist_sq = (px-ox).powi(2) + (py-oy).powi(2) + (pz-oz).powi(2);
                            if dist_sq > 0.0 && dist_sq < sep_sq {
                                let dist = dist_sq.sqrt();
                                sx += (px - ox) / dist;
                                sy += (py - oy) / dist;
                                count += 1;
                            }
                        }
                    }
                }
            }
        }

        if count > 0 {
            sx /= count as f32;
            sy /= count as f32;
            let len = (sx * sx + sy * sy).sqrt();
            if len > 0.0 {
                sx = (sx / len) * MAX_SPEED - vx;
                sy = (sy / len) * MAX_SPEED - vy;
                
                // Clamp Force
                let f_len = (sx * sx + sy * sy).sqrt();
                if f_len > MAX_FORCE {
                    sx = (sx / f_len) * MAX_FORCE;
                    sy = (sy / f_len) * MAX_FORCE;
                }
            }
        }
        (sx, sy)
    }

    fn calc_attraction(&self, px: f32, py: f32, vx: f32, vy: f32, tx: f32, ty: f32) -> (f32, f32) {
        let mut dx = tx - px;
        let mut dy = ty - py;
        let dist = (dx * dx + dy * dy).sqrt();

        if dist > 0.0 {
            if dist < 5.0 {
                dx = (dx / dist) * MAX_SPEED * (dist / 5.0);
                dy = (dy / dist) * MAX_SPEED * (dist / 5.0);
            } else {
                dx = (dx / dist) * MAX_SPEED;
                dy = (dy / dist) * MAX_SPEED;
            }
        }

        let mut steer_x = dx - vx;
        let mut steer_y = dy - vy;
        
        // Clamp force
        let f_len = (steer_x * steer_x + steer_y * steer_y).sqrt();
        if f_len > MAX_FORCE {
            steer_x = (steer_x / f_len) * MAX_FORCE;
            steer_y = (steer_y / f_len) * MAX_FORCE;
        }

        (steer_x, steer_y)
    }

    fn calc_avoidance(&self, px: f32, py: f32, pz: f32, vx: f32, vy: f32) -> (f32, f32) {
        let mut steer_x = 0.0;
        let mut steer_y = 0.0;
        let mut count = 0;
        let padding = 2.0;

        for obs in &self.obstacles {
            if pz > obs.height + padding { continue; }

            let rel_x = px - obs.x;
            let rel_y = py - obs.y;

            let dist_sq = rel_x * rel_x + rel_y * rel_y;
            if dist_sq > obs.bounding_radius_sq { continue; }

            let local_x = rel_x * obs.cos - rel_y * obs.sin;
            let local_y = rel_x * obs.sin + rel_y * obs.cos;

            let closest_x = local_x.clamp(-obs.half_w, obs.half_w);
            let closest_y = local_y.clamp(-obs.half_d, obs.half_d);

            let local_dist_sq = (local_x - closest_x).powi(2) + (local_y - closest_y).powi(2);

            if local_dist_sq < padding * padding {
                let dist = local_dist_sq.sqrt();
                let mut push_lx = local_x;
                let mut push_ly = local_y;

                if dist != 0.0 {
                    push_lx = local_x - closest_x;
                    push_ly = local_y - closest_y;
                }

                let push_x = push_lx * obs.world_cos - push_ly * obs.world_sin;
                let push_y = push_lx * obs.world_sin + push_ly * obs.world_cos;

                let urgency = 1.0 - (dist / padding);
                let push_len = (push_x * push_x + push_y * push_y).sqrt();

                if push_len > 0.0 {
                    steer_x += (push_x / push_len) * urgency;
                    steer_y += (push_y / push_len) * urgency;
                    count += 1;
                }
            }
        }

        if count > 0 {
            steer_x /= count as f32;
            steer_y /= count as f32;

            let len = (steer_x * steer_x + steer_y * steer_y).sqrt();
            if len > 0.0 {
                steer_x = (steer_x / len) * MAX_SPEED - vx;
                steer_y = (steer_y / len) * MAX_SPEED - vy;

                let max_f = MAX_FORCE * 10.0;
                let f_len = (steer_x * steer_x + steer_y * steer_y).sqrt();
                if f_len > max_f {
                    steer_x = (steer_x / f_len) * max_f;
                    steer_y = (steer_y / f_len) * max_f;
                }
            }
        }

        (steer_x, steer_y)
    }

    // --- MEMORY POINTERS ---
    pub fn get_positions_ptr(&self) -> *const f32 {
        self.positions.as_ptr()
    }
    
    pub fn get_velocities_ptr(&self) -> *const f32 {
        self.velocities.as_ptr()
    }
}