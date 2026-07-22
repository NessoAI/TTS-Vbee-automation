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
import { moveWithoutOverwrite } from './files.js';
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
      validationIssues: [], logs: [], createdAt: now, updatedAt: now
    });
  }

  private log(job: Job, msg: string): void {
    if (!job.logs) job.logs = [];
    const ts = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = `[${ts}] ${msg}`;
    job.logs.push(entry);
    console.log(`[${job.id.slice(0, 8)}] ${msg}`);
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
    const log = (msg: string) => this.log(job, msg);
    try {
      job.status = 'extracting_document'; await this.store.save(job);
      log('Bắt đầu xử lý...');
      if (this.config.automation.dryRun) {
        await this.delay();
        job.documentTitle = 'Demo HIRA'; job.sourceText = DEMO_TEXT;
        log('DRY RUN — dữ liệu mẫu HIRA');
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
        log('Đang đọc Google Docs...');
        const document = await this.docs.extract(job.documentUrl);
        job.documentTitle = document.title; job.sourceText = document.text;
        log(`Đã lấy nội dung: "${document.title}" (${document.text.length} ký tự, ${document.tabCount} tab)`);
        job.status = 'correcting_text'; await this.store.save(job);

        log('Đang hiệu chỉnh văn bản qua ChatGPT...');
        const session = await this.chatgpt.createSession();
        let attempts = 0;
        let correctedText = '';
        let correctionIssues: ValidationIssue[] = [];

        while (attempts < 3) {
          attempts += 1;
          log(`Hiệu chỉnh lần ${attempts}/3...`);
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
        log(`Hiệu chỉnh xong sau ${attempts} lần (${correctionIssues.filter(i => i.severity === 'error').length} error, ${correctionIssues.filter(i => i.severity === 'warning').length} warning)`);

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

        log('Đang phân vai A/B qua ChatGPT...');
        const dialogueRaw = await this.chatgpt.sendPrompt(session, rolePromptData.rendered);
        job.dialogue = parseDialogueV442(dialogueRaw);
        log(`Phân vai xong: ${job.dialogue.dialogue.length} lượt thoại`);
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
    const log = (msg: string) => this.log(job, msg);
    job.status = 'creating_vbee_project'; await this.store.save(job);
    if (this.config.automation.dryRun) {
      await this.delay(); job.vbeeProjectUrl = 'https://studio.vbee.vn/projects/demo';
      log('DRY RUN — bỏ qua VBEE');
      job.status = 'pasting_vbee_blocks'; await this.store.save(job); await this.delay(); return;
    }
    log('Đang tạo project VBEE...');
    job.vbeeProjectUrl = await this.vbee.createProject(job.documentTitle!, log);
    log(`Project VBEE: ${job.vbeeProjectUrl}`);
    job.status = 'pasting_vbee_blocks'; await this.store.save(job);
    log(`Đang nhập ${job.dialogue!.dialogue.length} block...`);
    await this.vbee.pasteDialogue(job.vbeeProjectUrl, job.dialogue!, log);
    log('Nhập block hoàn tất');
    const verified = await this.vbee.verify(job.vbeeProjectUrl, job.dialogue!);
    if (!verified.ok) throw new Error(verified.issues.join(' '));
  }

  private async generateAndDownload(job: Job): Promise<void> {
    const log = (msg: string) => this.log(job, msg);
    job.status = 'generating_audio'; await this.store.save(job);
    if (this.config.automation.dryRun) {
      await this.delay(); job.status = 'downloading'; await this.store.save(job); await this.delay();
      job.downloadedFile = `${this.config.files.destinationDir}\\${job.documentTitle}.rar`;
      log('DRY RUN — hoàn tất');
      job.status = 'completed'; await this.store.save(job); return;
    }
    log('Đang tạo TTS hàng loạt...');
    await this.vbee.generateAll(job.vbeeProjectUrl!, log);
    job.status = 'downloading'; await this.store.save(job);
    log('Đang tải file âm thanh...');
    const downloaded = await this.vbee.downloadAll(job.vbeeProjectUrl!, log);
    job.downloadedFile = await moveWithoutOverwrite(downloaded, this.config.files.destinationDir);
    log(`Hoàn tất: ${job.downloadedFile}`);
    job.status = 'completed'; await this.store.save(job);
  }

  private async fail(job: Job, error: unknown): Promise<void> {
    job.status = 'failed'; job.error = error instanceof Error ? error.message : String(error); await this.store.save(job);
  }

  private delay(ms = 550): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
}
