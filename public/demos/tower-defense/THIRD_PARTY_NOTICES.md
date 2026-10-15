# Third-party notices and modifications

Adapted from **HTML5 Tower Defense** by gamelabz, source revision `8caa9483da02a1c729ae1bf54f38e7fa158c5783` ([repository](https://github.com/gamelabz/html5-game-tower-defense)). The complete upstream MIT license and copyright notice are retained in [`LICENSE`](./LICENSE).

GameForge moved the simulation into a testable local engine, made spawn/movement/projectile timing frame-rate-aware, added swept projectile collision checks, implemented the documented pause/resume control, prevented starting overlapping waves, and added explicit session-only reset behavior. The source game used procedural Canvas art and no external runtime libraries or media; this adaptation likewise makes no network requests and stores no game data.
