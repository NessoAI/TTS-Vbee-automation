import crypto from 'node:crypto';
import type { AppConfig, DialogueResult, Job, RunMode, ValidationIssue } from '../../shared/types.js';
import { BrowserManager } from '../adapters/browser.js';
import { ChatGptAdapter } from '../adapters/chatgpt.js';
import { GoogleDocsAdapter } from '../adapters/google-docs.js';
import { VbeeAdapter } from '../adapters/vbee.js';
import {
  CORRECTION_PROMPT,
  REPAIR_PROMPT,
  ROLE_PROMPT_SOURCE,
  ROLE_PROMPT_VERSION,
  buildRolePrompt,
  withRepairContext,
  withText
} from '../prompts.js';
import { parseDialogueV442, restoreNumberedListMarkers, validateCorrection, validateDialogue } from './dialogue.js';
import { moveWithoutOverwrite, snapshotRars, waitForNewRar } from './files.js';
import { JobStore } from './job-store.js';

const DEMO_TEXT = 'Bây giờ, chúng ta sẽ tìm hiểu một trong những công cụ quan trọng nhất trong an toàn lao động, đó là HIRA, viết tắt của:\nVì sao phải thực hiện HIRA?';

export class JobRunner {
  private readonly browser: BrowserManager;
  private readonly docs: GoogleDocsAdapter;
  private readonly chatgpt: ChatGptAdapter;
  private readonly vbee: VbeeAdapter;

  constructor(private readonly config: AppConfig, private readonly store: JobStore) {
    this.browser = new BrowserManager(config);
    this.docs = new GoogleDocsAdapter(this.browser);
    this.chatgpt = new ChatGptAdapter(this.browser, config);
    this.vbee = new VbeeAdapter(this.browser, config);
  }

  async create(documentUrl: string, mode: RunMode): Promise<Job> {
    const now = new Date().toISOString();
    return this.store.save({
      id: crypto.randomUUID(), documentUrl, mode, status: 'created',
      validationIssues: [], createdAt: now, updatedAt: now
    });
  }

  private demoDialogue(): DialogueResult {
    return {
      roles: { A: 'Trưởng nhóm hướng dẫn', B: 'Nhân viên vận hành' },
      dialogue: [
        { order: 1, speaker: 'A', text: 'Bây giờ, chúng ta sẽ tìm hiểu một trong những công cụ quan trọng nhất trong an toàn lao động, đó là HIRA, viết tắt của:' },
        { order: 2, speaker: 'B', text: 'Vì sao phải thực hiện HIRA?' }
      ]
    };
  }

  async start(id: string): Promise<void> {
    const job = this.store.get(id);
    try {
      job.status = 'extracting_document'; await this.store.save(job);
      if (this.config.automation.dryRun) {
        await this.delay();
        job.documentTitle = 'Demo HIRA'; job.sourceText = DEMO_TEXT;
        job.status = 'correcting_text'; await this.store.save(job); await this.delay();
        job.correctedText = DEMO_TEXT;
        job.correctionAttempts = 1;
        job.status = 'assigning_roles';
        job.rolePromptVersion = ROLE_PROMPT_VERSION;
        job.rolePromptSource = ROLE_PROMPT_SOURCE;
        const rolePromptData = buildRolePrompt(DEMO_TEXT);
        job.rolePromptTemplateSha256 = rolePromptData.templateSha256;
        job.rolePromptRenderedSha256 = rolePromptData.renderedSha256;
        await this.store.save(job);
        await this.delay();
        job.dialogue = this.demoDialogue();
      } else {
        const document = await this.docs.extract(job.documentUrl);
        job.documentTitle = document.title; job.sourceText = document.text;
        job.status = 'correcting_text'; await this.store.save(job);

        const session = await this.chatgpt.createSession();
        let attempts = 0;
        let correctedText = '';
        let correctionIssues: ValidationIssue[] = [];

        while (attempts < 3) {
          attempts += 1;
          let rawResponse = '';
          if (attempts === 1) {
            rawResponse = await this.chatgpt.sendPrompt(session, withText(CORRECTION_PROMPT, document.text));
          } else {
            const errorMsgs = correctionIssues.filter((i) => i.severity === 'error').map((i) => i.message);
            const repairPrompt = withRepairContext(REPAIR_PROMPT, document.text, correctedText, errorMsgs);
            rawResponse = await this.chatgpt.sendPrompt(session, repairPrompt);
          }

          const restoration = restoreNumberedListMarkers(document.text, rawResponse);
          const currentIssues = validateCorrection(document.text, restoration.text);

          if (!currentIssues.some((issue) => issue.severity === 'error')) {
            correctedText = restoration.text;
            correctionIssues = currentIssues;
            if (restoration.restored.length > 0) {
              correctionIssues.push({
                code: 'STRUCTURE_RESTORED',
                message: `Đã tự khôi phục số thứ tự từ văn bản gốc: ${restoration.restored.join(', ')}`,
                severity: 'warning'
              });
            }
            break;
          } else {
            correctedText = restoration.text;
            correctionIssues = currentIssues;
          }
        }

        job.correctedText = correctedText;
        job.correctionAttempts = attempts;

        if (correctionIssues.some((issue) => issue.severity === 'error')) {
          job.status = 'failed';
          job.validationIssues = correctionIssues;
          job.error = 'ChatGPT không thể hiệu chỉnh mà vẫn bảo toàn nội dung sau 3 lần.';
          await this.store.save(job);
          return;
        }

        job.status = 'assigning_roles';
        job.rolePromptVersion = ROLE_PROMPT_VERSION;
        job.rolePromptSource = ROLE_PROMPT_SOURCE;
        const rolePromptData = buildRolePrompt(correctedText);
        job.rolePromptTemplateSha256 = rolePromptData.templateSha256;
        job.rolePromptRenderedSha256 = rolePromptData.renderedSha256;
        await this.store.save(job);

        const dialogueRaw = await this.chatgpt.sendPrompt(session, rolePromptData.rendered);
        job.dialogue = parseDialogueV442(dialogueRaw);
      }
      job.validationIssues = [
        ...validateCorrection(job.sourceText!, job.correctedText!),
        ...validateDialogue(job.correctedText!, job.dialogue!, this.config.vbee.maxBlockCharacters)
      ];
      if (job.validationIssues.some((issue) => issue.severity === 'error')) {
        job.status = 'awaiting_script_review'; await this.store.save(job); return;
      }
      if (job.mode === 'review_twice') {
        job.status = 'awaiting_script_review'; await this.store.save(job); return;
      }
      await this.pasteToVbee(job);
      await this.generateAndDownload(job);
    } catch (error) { await this.fail(job, error); }
  }

  async approveScript(id: string, dialogue?: DialogueResult): Promise<void> {
    const job = this.store.get(id);
    if (job.status !== 'awaiting_script_review') throw new Error('Job không ở bước duyệt kịch bản.');
    if (dialogue) job.dialogue = dialogue;
    job.validationIssues = [
      ...validateCorrection(job.sourceText!, job.correctedText!),
      ...validateDialogue(job.correctedText!, job.dialogue!, this.config.vbee.maxBlockCharacters)
    ];
    if (job.validationIssues.some((issue) => issue.severity === 'error')) {
      await this.store.save(job); return;
    }
    try {
      await this.pasteToVbee(job);
      if (job.mode === 'review_twice') {
        job.status = 'awaiting_vbee_review'; await this.store.save(job); return;
      }
      await this.generateAndDownload(job);
    } catch (error) { await this.fail(job, error); }
  }

  async approveVbee(id: string): Promise<void> {
    const job = this.store.get(id);
    if (job.status !== 'awaiting_vbee_review') throw new Error('Job không ở bước duyệt VBEE.');
    try {
      if (!this.config.automation.dryRun) {
        const verified = await this.vbee.verify(job.vbeeProjectUrl!, job.dialogue!);
        if (!verified.ok) throw new Error(verified.issues.join(' '));
      }
      await this.generateAndDownload(job);
    } catch (error) { await this.fail(job, error); }
  }

  async cancel(id: string): Promise<void> {
    const job = this.store.get(id); job.status = 'cancelled'; await this.store.save(job);
  }

  private async pasteToVbee(job: Job): Promise<void> {
    job.status = 'creating_vbee_project'; await this.store.save(job);
    if (this.config.automation.dryRun) {
      await this.delay(); job.vbeeProjectUrl = 'https://studio.vbee.vn/projects/demo';
      job.status = 'pasting_vbee_blocks'; await this.store.save(job); await this.delay(); return;
    }
    job.vbeeProjectUrl = await this.vbee.createProject(job.documentTitle!);
    job.status = 'pasting_vbee_blocks'; await this.store.save(job);
    await this.vbee.pasteDialogue(job.vbeeProjectUrl, job.dialogue!);
    const verified = await this.vbee.verify(job.vbeeProjectUrl, job.dialogue!);
    if (!verified.ok) throw new Error(verified.issues.join(' '));
  }

  private async generateAndDownload(job: Job): Promise<void> {
    job.status = 'generating_audio'; await this.store.save(job);
    if (this.config.automation.dryRun) {
      await this.delay(); job.status = 'downloading'; await this.store.save(job); await this.delay();
      job.downloadedFile = `${this.config.files.destinationDir}\\${job.documentTitle}.rar`;
      job.status = 'completed'; await this.store.save(job); return;
    }
    const before = await snapshotRars(this.config.files.downloadsDir);
    await this.vbee.generateAll(job.vbeeProjectUrl!);
    // VBEE enables download only after selected blocks finish generating.
    job.status = 'downloading'; await this.store.save(job);
    await this.vbee.downloadAll(job.vbeeProjectUrl!);
    const downloaded = await waitForNewRar(this.config.files.downloadsDir, before, this.config.automation.generationTimeoutMs);
    job.downloadedFile = await moveWithoutOverwrite(downloaded, this.config.files.destinationDir);
    job.status = 'completed'; await this.store.save(job);
  }

  private async fail(job: Job, error: unknown): Promise<void> {
    job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error); await this.store.save(job);
  }

  private delay(ms = 550): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
}
