import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { JobStore } from './services/job-store.js';
import { JobRunner } from './services/runner.js';

const config = loadConfig();
const store = new JobStore();
await store.init();
const runner = new JobRunner(config, store);
const app = express();
app.use(cors()); app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, dryRun: config.automation.dryRun }));
app.get('/api/config', (_req, res) => res.json({
  dryRun: config.automation.dryRun,
  projectName: config.chatgpt.projectName,
  voiceA: `${config.vbee.voiceA} — ${config.vbee.speedA}`,
  voiceB: `${config.vbee.voiceB} — ${config.vbee.speedB}`,
  destinationDir: config.files.destinationDir
}));
app.get('/api/jobs', (_req, res) => res.json(store.list()));
app.get('/api/jobs/:id', (req, res) => {
  try { res.json(store.get(req.params.id)); } catch (error) { res.status(404).json({ error: String(error) }); }
});
app.post('/api/jobs', async (req, res, next) => {
  try {
    const body = z.object({ documentUrl: z.string().url(), mode: z.enum(['review_twice', 'full_auto']) }).parse(req.body);
    const job = await runner.create(body.documentUrl, body.mode);
    void runner.start(job.id);
    res.status(201).json(job);
  } catch (error) { next(error); }
});
app.post('/api/jobs/:id/approve-script', async (req, res, next) => {
  try { void runner.approveScript(req.params.id, req.body.dialogue); res.status(202).json({ ok: true }); } catch (error) { next(error); }
});
app.post('/api/jobs/:id/approve-vbee', async (req, res, next) => {
  try { void runner.approveVbee(req.params.id); res.status(202).json({ ok: true }); } catch (error) { next(error); }
});
app.post('/api/jobs/:id/cancel', async (req, res, next) => {
  try { await runner.cancel(req.params.id); res.json({ ok: true }); } catch (error) { next(error); }
});
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
});

const uiDir = path.resolve(process.cwd(), 'dist/ui');
app.use(express.static(uiDir));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.sendFile(path.join(uiDir, 'index.html'));
    return;
  }
  next();
});
app.listen(config.serverPort, '127.0.0.1', () => {
  console.log(`TTS POE Automation: http://127.0.0.1:${config.serverPort}`);
  console.log(`Mode: ${config.automation.dryRun ? 'DRY RUN' : 'REAL'}`);
});
