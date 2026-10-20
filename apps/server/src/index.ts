import { existsSync } from 'node:fs';
import { loadConfig } from './config';
import { createServer } from './http/app';
import { backfillTones } from './engine/tones';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const { app, services } = await createServer(config);

app.log.info(
  {
    director: services.director.name,
    video: services.video.name,
    safety: services.safety.name,
    publicBaseUrl: config.PUBLIC_BASE_URL,
    dataDir: config.DATA_DIR,
    sceneSeconds: config.SCENE_SECONDS,
    scenesPerStory: config.SCENES_PER_STORY,
    adminRoutes: Boolean(config.ADMIN_TOKEN),
    iapMode: config.IAP_MODE,
    purchasesEnabled: config.purchasesEnabled,
  },
  'starting StoryQuest server',
);

services.engine.start();
services.daily.start();
backfillTones(services)
  .then((count) => {
    if (count > 0) app.log.info({ count }, 'worked out night colors for older scenes');
  })
  .catch((error: unknown) => app.log.warn({ error: String(error) }, 'night color backfill stopped'));
await app.listen({ port: config.PORT, host: config.HOST });

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    app.log.warn({ signal }, 'second signal, exiting now');
    process.exit(1);
  }
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  services.daily.stop();
  // Stopping the engine first releases long polls so the HTTP server can close quickly.
  const engineStopped = services.engine.stop(20_000);
  await app.close();
  await engineStopped;
  services.db.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason: reason instanceof Error ? reason.message : String(reason) }, 'unhandled rejection');
});
