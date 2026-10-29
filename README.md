# Hivebreak

A pixel-art fixed shooter in your browser. Break the alien hive one wave at a time, and pick an
upgrade between waves, so every run builds differently. Ships and aliens are real 3D models,
scripted in Blender and rendered at a low resolution for a crisp pixel look. TypeScript + Vite +
Three.js, no backend.

Work in progress: see [docs/requirements.md](docs/requirements.md) for what it will be and
[docs/plan-slice-1.md](docs/plan-slice-1.md) for the first playable version.

## Run it

```bash
cd client
npm install
npm run dev
```

`npm test` runs the unit tests. `npm run build` type-checks and builds to `client/dist`.

## Layout

- `client/src/game/`: game logic, free of rendering and the DOM, unit-tested with Vitest.
- `client/src/main.ts`: rendering and the game loop.
- `art/blender/`: Blender Python scripts that build the ship and alien models.
- `client/public/models/`: the exported `.glb` models.
- `docs/`: requirements and plans.

## Licence

[MIT](LICENSE)
