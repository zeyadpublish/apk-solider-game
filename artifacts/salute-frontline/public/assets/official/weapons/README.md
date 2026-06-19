# Weapon GLB Drop Zone

Place optional first-person weapon GLBs here.

Current weapon:

- `rifle.glb` is installed from the provided textured GLB and is used by the player and all enemy soldiers.

Recommended future export:

- `rifle.glb`
- Real-world forward axis aimed down local `-Z`
- Origin near the grip/hand position
- Animation clips named `idle`, `fire`, `reload`, and `throw`

Then add this optional block to `../asset-manifest.json`:

```json
"weapon": {
  "id": "first-person-rifle",
  "label": "Animated first-person rifle",
  "kind": "glb",
  "url": "/assets/official/weapons/rifle.glb",
  "required": false,
  "scale": 1,
  "position": [0, 0, 0],
  "rotation": [0, 0, 0],
  "animations": {
    "idle": "idle",
    "fire": "fire",
    "reload": "reload",
    "throw": "throw"
  }
}
```
