# Official Asset Drop Zone

The game loads production assets directly from this directory.

Required files:

- `city/uae-war-city.fbx`
- `soldiers/soldier.glb`

Soldier variants such as `enemy-rifleman`, `enemy-heavy`, `enemy-sniper`, and `enemy-commander` are instantiated dynamically from `soldiers/soldier.glb`. Do not add per-enemy STL files back into the pipeline.

Optional first-person weapon GLB:

- Put the file in `weapons/`, for example `weapons/rifle.glb`.
- Add a `weapon` block to `asset-manifest.json` with `url`, `scale`, `position`, `rotation`, and optional animation clip names.
- Supported weapon animation labels are `idle`, `fire`, `reload`, and `throw`.
- If no weapon GLB is configured, the game uses the built-in procedural rifle so Solo Play remains ready.

After changing assets, run:

```powershell
pnpm --filter @workspace/salute-frontline build
```
